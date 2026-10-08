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
      return "windows-1252";
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

function decodeFatal(bytes: Uint8Array, label: string, declared: string): string {
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
