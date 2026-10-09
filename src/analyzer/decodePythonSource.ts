import { TextDecoder } from "node:util";

export interface DecodedPythonSource {
  text: string;
  /** Effective decoding used (TextDecoder label), e.g. "utf-8", "windows-1252". */
  encoding: string;
}

export class PythonDecodeError extends Error {}

/** PEP 263: `coding[:=] <codec>` on a `#` comment within the first two lines. */
const CODING_RE = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/;

/** First-two-lines scan window; declarations must appear before any code. */
const SCAN_BYTES = 1024;

/** Map common Python codec names to WHATWG TextDecoder labels. */
function decoderLabelForCodec(codec: string): string | undefined {
  const name = codec.toLowerCase().replace(/_/g, "-");
  switch (name) {
    case "utf-8":
    case "utf8":
    case "utf-8-sig":
    case "utf8-sig":
      return "utf-8";
    case "ascii":
    case "us-ascii":
      return "utf-8";
    case "latin-1":
    case "latin1":
    case "iso-8859-1":
    case "iso8859-1":
      // Python's latin-1 is strict ISO-8859-1 (every byte maps to U+00xx), unlike
      // WHATWG, which treats the label as windows-1252.
      return "iso-8859-1";
    case "cp1252":
    case "windows-1252":
    case "windows1252":
      return "windows-1252";
    case "utf-16-le":
    case "utf16-le":
      return "utf-16le";
    case "utf-16-be":
    case "utf16-be":
      return "utf-16be";
    case "utf-16":
    case "utf16":
      return "utf-16";
    default:
      try {
        // Accept any other codec the runtime decoder knows (e.g. windows-1250).
        return new TextDecoder(name).encoding;
      } catch {
        return undefined;
      }
  }
}

/** Declared codec from the first two lines, or undefined when absent. */
export function declaredEncoding(bytes: Uint8Array): string | undefined {
  const head = bytes.subarray(0, Math.min(bytes.length, SCAN_BYTES));
  // Lossless 1:1 byte->char mapping is enough: the cookie pattern is ASCII.
  let text = "";
  for (let i = 0; i < head.length; i++) {
    text += head[i] === 0x0a ? "\n" : String.fromCharCode(head[i]);
  }
  const lines = text.split("\n");
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    const m = lines[i].match(CODING_RE);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

// windows-1252 code points for bytes 0x80-0x9F (0 = undefined in cp1252).
// Some Node releases decode "windows-1252" as ISO-8859-1, turning e.g. 0x93
// into the control character U+0093 instead of “, so map these explicitly.
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function decodeCp1252(bytes: Uint8Array, declared: string): string {
  let out = "";
  for (const b of bytes) {
    if (b >= 0x80 && b <= 0x9f) {
      const cp = CP1252_HIGH[b - 0x80];
      if (!cp) {
        throw new PythonDecodeError(`cannot decode as "${declared}"`);
      }
      out += String.fromCharCode(cp);
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function decodeFatal(bytes: Uint8Array, label: string, declared: string): string {
  if (label === "windows-1252") {
    return decodeCp1252(bytes, declared);
  }
  if (label === "iso-8859-1") {
    let out = "";
    for (const b of bytes) {
      out += String.fromCharCode(b);
    }
    return out;
  }
  try {
    const text = new TextDecoder(label, { fatal: true }).decode(bytes);
    // Strip a stray leading BOM character (U+FEFF, written here literally).
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new PythonDecodeError(`cannot decode as "${declared}"`);
  }
}

/**
 * Decode Python source bytes honoring BOMs and PEP 263 declarations.
 * Throws PythonDecodeError for unsupported declarations, undecodable bytes
 * (e.g. UTF-32, which the runtime decoder cannot handle), or fatal decoding
 * failures — callers should warn and skip the file instead of parsing
 * corrupted text.
 */
export function decodePythonSource(bytes: Uint8Array): DecodedPythonSource {
  // UTF-8 BOM.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeFatal(bytes.subarray(3), "utf-8", "utf-8-sig"), encoding: "utf-8-sig" };
  }
  // UTF-32 has no runtime decoder: refuse rather than mis-decode as UTF-16.
  if (
    (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) ||
    (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00)
  ) {
    throw new PythonDecodeError('unsupported encoding "utf-32"');
  }
  // UTF-16 BOMs.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeFatal(bytes.subarray(2), "utf-16be", "utf-16"), encoding: "utf-16be" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeFatal(bytes.subarray(2), "utf-16le", "utf-16"), encoding: "utf-16le" };
  }

  const declared = declaredEncoding(bytes);
  if (!declared) {
    return { text: decodeFatal(bytes, "utf-8", "utf-8"), encoding: "utf-8" };
  }
  const label = decoderLabelForCodec(declared);
  if (!label) {
    throw new PythonDecodeError(`unsupported encoding "${declared}"`);
  }
  if (label === "utf-16") {
    // Declared UTF-16 without a BOM: assume little-endian (CPython requires
    // a BOM for "utf-16", but LE is the only sane fallback for analysis).
    return { text: decodeFatal(bytes, "utf-16le", declared), encoding: "utf-16le" };
  }
  return { text: decodeFatal(bytes, label, declared), encoding: label };
}
