import { createSocket, type Socket } from "node:dgram";
import os from "node:os";
import type { FastifyBaseLogger } from "fastify";

/**
 * Minimal mDNS responder: answers A-record queries for `<hostname>.local`
 * with the machine's primary LAN IPv4. Lets phones/tablets reach the app at
 * a stable name (e.g. http://oficinaos.local:4000) even when the router
 * hands the PC a new IP — Android/iOS/macOS resolve .local natively.
 *
 * Enabled only when MDNS_HOSTNAME is set (the Windows service installer and
 * the portable env generator write it). Off by default so Docker/CI never
 * advertises a meaningless name. Failure is non-fatal: port 5353 may be
 * taken by another responder (Bonjour, Avahi) — we log and move on.
 *
 * Known limitation (Bun node:dgram): a socket with addMembership only
 * receives packets sent to the multicast group — unicast queries to
 * host:5353 (the rare QU-bit form) never arrive. Fine in practice: every
 * mainstream resolver (Windows, iOS, Android, macOS) multicasts.
 */

const MDNS_GROUP = "224.0.0.251";
const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_ANY = 255;
const POINTER_MASK = 0xc0;
const ANSWER_TTL = 120;

export interface MdnsHandle {
  close(): void;
}

// Virtual adapters whose IPs are unreachable from the shop LAN — same
// denylist the Windows env generator uses for APP_URL.
const VIRTUAL_IFACE_RE =
  /loopback|vethernet|wsl|docker|hyper-v|virtualbox|vmware|vpn|tailscale|hamachi/i;

function isLanAddress(info: os.NetworkInterfaceInfo): boolean {
  return (
    info.family === "IPv4" &&
    !info.internal &&
    !info.address.startsWith("169.254.")
  );
}

/** Real-network IPv4s — virtual adapters (WSL/Docker/VPN) excluded. */
export function lanIpv4Addresses(): string[] {
  const real: string[] = [];
  const virtual: string[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (!isLanAddress(info)) {
        continue;
      }
      (VIRTUAL_IFACE_RE.test(name) ? virtual : real).push(info.address);
    }
  }
  return [...real, ...virtual];
}

/** First non-virtual, non-loopback, non-link-local IPv4 on the machine. */
export function primaryLanIpv4(): string | null {
  return lanIpv4Addresses()[0] ?? null;
}

/** Decode a DNS name at `offset`; returns the name and the next offset. */
export function readName(
  packet: Buffer,
  offset: number
): { name: string; next: number } | null {
  const labels: string[] = [];
  let pos = offset;
  let jumped = false;
  let next = offset;
  for (let hops = 0; hops < 32; hops++) {
    if (pos >= packet.length) {
      return null;
    }
    const len = packet[pos];
    if (len === 0) {
      return { name: labels.join("."), next: jumped ? next : pos + 1 };
    }
    if (len >= POINTER_MASK) {
      // Compression pointer: top 2 bits set, offset in the lower 14.
      if (!jumped) {
        next = pos + 2;
      }
      jumped = true;
      pos = packet.readUInt16BE(pos) - 0xc0_00;
      continue;
    }
    if (len > 63 || pos + 1 + len > packet.length) {
      return null;
    }
    labels.push(packet.toString("ascii", pos + 1, pos + 1 + len));
    pos += 1 + len;
    if (!jumped) {
      next = pos;
    }
  }
  return null;
}

/** Build the A-record response for a parsed query (question echoed). */
export function buildResponse(
  query: Buffer,
  questionEnd: number,
  ip: string
): Buffer {
  const question = query.subarray(12, questionEnd);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // same ID
  header.writeUInt16BE(0x84_00, 2); // QR + AA
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(1, 6); // ANCOUNT

  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc0_0c, 0); // name → pointer to question
  answer.writeUInt16BE(TYPE_A, 2);
  answer.writeUInt16BE(0x80_01, 4); // IN + cache-flush
  answer.writeUInt32BE(ANSWER_TTL, 6);
  answer.writeUInt16BE(4, 10);
  for (const [i, octet] of ip.split(".").entries()) {
    answer.writeUInt8(Number(octet), 12 + i);
  }
  return Buffer.concat([header, question, answer]);
}

/**
 * Start the responder. Returns a handle, or null when the socket can't be
 * opened (already logged).
 */
export function startMdnsResponder(
  hostname: string,
  log: FastifyBaseLogger
): MdnsHandle | null {
  const fqdn = `${hostname}.local`;
  const socket: Socket = createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", (err) => {
    log.warn({ err }, "mDNS responder socket error — name lookup may not work");
  });

  socket.on("message", (msg, rinfo) => {
    try {
      // Header: QR bit must be 0 (query), opcode 0, at least 1 question.
      if (msg.length < 12 || msg[2] >= 0x80 || msg.readUInt16BE(4) < 1) {
        return;
      }
      const parsed = readName(msg, 12);
      if (!parsed) {
        return;
      }
      const qtypeOff = parsed.next;
      if (qtypeOff + 4 > msg.length) {
        return;
      }
      const qtype = msg.readUInt16BE(qtypeOff);
      if (
        parsed.name.toLowerCase() !== fqdn ||
        (qtype !== TYPE_A && qtype !== TYPE_ANY)
      ) {
        return;
      }
      const ip = primaryLanIpv4();
      if (!ip) {
        return;
      }
      socket.send(
        buildResponse(msg, qtypeOff + 4, ip),
        rinfo.port,
        rinfo.address
      );
    } catch {
      // Malformed multicast traffic — ignore silently.
    }
  });

  try {
    socket.bind(MDNS_PORT, () => {
      for (const infos of Object.values(os.networkInterfaces())) {
        for (const info of infos ?? []) {
          if (isLanAddress(info)) {
            try {
              socket.addMembership(MDNS_GROUP, info.address);
            } catch {
              // Interface may not support multicast — skip.
            }
          }
        }
      }
      log.info({ ip: primaryLanIpv4() }, `mDNS responder advertising ${fqdn}`);
    });
  } catch (err) {
    log.warn({ err }, "mDNS: nao foi possivel abrir a porta 5353");
    try {
      socket.close();
    } catch {
      // best effort
    }
    return null;
  }

  return { close: () => socket.close() };
}
