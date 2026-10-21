import { once } from "node:events";
import { createServer, type Server } from "node:net";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

// Dependency-audit smoke tests — the bumped packages are exercised end
// to end: nodemailer 10 speaks SMTP to a local sink, @fastify/busboy
// parses a real multipart body including the prototype-named part the
// fixed advisories cover (GHSA-v53p, GHSA-prgh, GHSA-xjh9, GHSA-x8mw).

async function startSmtpSink() {
  const messages: string[] = [];
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let inData = false;
    // AUTH LOGIN: 1 = username line expected, 2 = password line expected
    let authStep = 0;
    socket.write("220 sink.test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) {
          return;
        }
        messages.push(buf.subarray(0, end).toString("utf8"));
        buf = buf.subarray(end + 5);
        inData = false;
        socket.write("250 2.0.0 Ok\r\n");
      }
      let lineEnd = buf.indexOf("\r\n");
      while (lineEnd !== -1) {
        const line = buf.subarray(0, lineEnd).toString("utf8");
        buf = buf.subarray(lineEnd + 2);
        const cmd = line.split(" ")[0]?.toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") {
          socket.write("250-sink.test\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n");
        } else if (cmd === "AUTH") {
          authStep = 1;
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (authStep === 1) {
          authStep = 2;
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (authStep === 2) {
          authStep = 0;
          socket.write("235 2.7.0 Accepted\r\n");
        } else if (cmd === "MAIL" || cmd === "RCPT") {
          socket.write("250 2.1.0 Ok\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n");
        } else {
          socket.write("250 2.0.0 Ok\r\n");
        }
        lineEnd = buf.indexOf("\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { server, port, messages };
}

describe("nodemailer 10 (GHSA-v53p-9fqp-m79j, GHSA-prgh-xp8r-p3m5)", () => {
  let sink: { server: Server; port: number; messages: string[] };

  afterEach(async () => {
    if (sink) {
      sink.server.close();
      await once(sink.server, "close");
    }
    for (const key of [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "EMAIL_FROM",
    ]) {
      Reflect.deleteProperty(process.env, key);
    }
    const { resetEnvForTests } = await import("../config/env.js");
    resetEnvForTests();
  });

  it("sendEmail delivers through a real SMTP conversation", async () => {
    sink = await startSmtpSink();
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(sink.port);
    process.env.SMTP_USER = "shop@local.test";
    process.env.SMTP_PASS = "secret-pass";
    process.env.EMAIL_FROM = '"OficinaOS" <noreply@oficinaos.test>';
    const { resetEnvForTests } = await import("../config/env.js");
    resetEnvForTests();
    const { sendEmail } = await import("../lib/email.js");

    await sendEmail({
      to: "cliente@example.test",
      subject: "OS 123 pronta",
      text: "O seu equipamento esta pronto.",
    });

    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0]).toContain("cliente@example.test");
    expect(sink.messages[0]).toContain("O seu equipamento esta pronto");
  });

  it("sendEmail without SMTP config resolves without throwing", async () => {
    const { resetEnvForTests } = await import("../config/env.js");
    resetEnvForTests();
    const { sendEmail } = await import("../lib/email.js");
    await expect(
      sendEmail({ to: "a@b.test", subject: "x", text: "y" })
    ).resolves.toBeUndefined();
  });
});

describe("@fastify/multipart + busboy (GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx)", () => {
  it("parses a file part and survives a __proto__-named field", async () => {
    const app = Fastify();
    await app.register(multipart, {
      limits: { fileSize: 1024 * 1024 },
    });
    app.post("/upload", async (req) => {
      const file = await req.file();
      if (!file) {
        return { ok: false };
      }
      const buf = await file.toBuffer();
      return {
        ok: true,
        filename: file.filename,
        mimetype: file.mimetype,
        size: buf.length,
        body: buf.toString("utf8"),
      };
    });

    const boundary = "----audit-boundary";
    const payload = [
      `--${boundary}`,
      // Prototype-named part — the DoS vector fixed in busboy 3.2.1.
      'Content-Disposition: form-data; name="__proto__"',
      "Content-Type: text/plain",
      "",
      "polluted",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="nota.txt"',
      "Content-Type: text/plain",
      "",
      "conteudo do anexo",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: "/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      filename: "nota.txt",
      mimetype: "text/plain",
      size: "conteudo do anexo".length,
      body: "conteudo do anexo",
    });
    await app.close();
  });
});
