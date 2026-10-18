const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};

const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50];

export function validateMagicBytes(buffer: Buffer, mime: string): boolean {
  const expected = MAGIC_BYTES[mime];
  if (!expected) {
    return false;
  }
  const headerMatch = expected.every((byte, i) => buffer[i] === byte);
  if (!headerMatch) {
    return false;
  }
  if (mime === "image/webp") {
    const offset = 8;
    return WEBP_MARKER.every((byte, i) => buffer[offset + i] === byte);
  }
  return true;
}

export interface ImageDimensions {
  height: number;
  width: number;
}

function pngDimensions(buffer: Buffer): ImageDimensions | null {
  // PNG signature (8B) + IHDR length (4B) + "IHDR" (4B) → width/height BE u32.
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function jpegDimensions(buffer: Buffer): ImageDimensions | null {
  // Scan markers until a Start-Of-Frame segment (C0–CF except C4/C8/CC).
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill bytes before a real marker
      continue;
    }
    const isSof =
      marker !== undefined &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

function webpDimensions(buffer: Buffer): ImageDimensions | null {
  // RIFF header (12B) then the first chunk decides the layout.
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    // Extended: canvas size stored as 24-bit little-endian minus one.
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    // Lossless: 14-bit width/height packed in 4 bytes after the 0x2F marker.
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits % 16_384) + 1,
      height: (Math.floor(bits / 16_384) % 16_384) + 1,
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    // Lossy bitstream: dimensions sit in the frame header, low 14 bits each.
    return {
      width: buffer.readUInt16LE(26) % 16_384,
      height: buffer.readUInt16LE(28) % 16_384,
    };
  }
  return null;
}

// Logo mínimo útil — abaixo disto a montra e o tracking público mostram um
// quadrado minúsculo em vez da marca da loja.
const LOGO_MIN_PX = 24;
const LOGO_MAX_PX = 4096;
const LOGO_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;

/**
 * Validates a shop logo data URL (format, magic bytes, pixel bounds).
 * Returns a `validations.*` key for localized errors, or null when valid.
 */
export function logoDataUrlError(logo: string): string | null {
  const match = LOGO_DATA_URL_RE.exec(logo);
  const dims =
    match && imageDimensions(Buffer.from(match[2], "base64"), match[1]);
  if (!dims) {
    return "logo_unreadable";
  }
  if (dims.width < LOGO_MIN_PX || dims.height < LOGO_MIN_PX) {
    return "logo_too_small";
  }
  if (dims.width > LOGO_MAX_PX || dims.height > LOGO_MAX_PX) {
    return "logo_bad_size";
  }
  return null;
}

/**
 * Pixel dimensions of a decoded image, parsed from its own headers.
 * Returns null for corrupt/truncated buffers or unrecognized layouts.
 */
export function imageDimensions(
  buffer: Buffer,
  mime: string
): ImageDimensions | null {
  if (!validateMagicBytes(buffer, mime)) {
    return null;
  }
  switch (mime) {
    case "image/jpeg":
      return jpegDimensions(buffer);
    case "image/png":
      return pngDimensions(buffer);
    case "image/webp":
      return webpDimensions(buffer);
    default:
      return null;
  }
}
