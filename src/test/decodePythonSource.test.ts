import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodePythonSource,
  declaredEncoding,
  PythonDecodeError
} from "../analyzer/decodePythonSource";

const enc = (s: string): Uint8Array => Buffer.from(s, "utf8");
const concat = (...parts: Uint8Array[]): Uint8Array => Buffer.concat(parts.map((p) => Buffer.from(p)));

function throwsDecode(bytes: Uint8Array): string {
  try {
    decodePythonSource(bytes);
  } catch (err) {
    assert.ok(err instanceof PythonDecodeError, `expected PythonDecodeError, got ${err}`);
    return (err as Error).message;
  }
  assert.fail("expected decodePythonSource to throw");
}

describe("decodePythonSource", () => {
  it("decodes plain UTF-8", () => {
    const r = decodePythonSource(enc("class Post(models.Model):\n    name = 'café'\n"));
    assert.equal(r.encoding, "utf-8");
    assert.ok(r.text.includes("café"));
  });

  it("strips a UTF-8 BOM", () => {
    const r = decodePythonSource(concat(new Uint8Array([0xef, 0xbb, 0xbf]), enc("x = 1\n")));
    assert.equal(r.encoding, "utf-8-sig");
    assert.equal(r.text, "x = 1\n");
  });

  it("honors a declared latin-1 encoding", () => {
    const bytes = concat(enc("# -*- coding: latin-1 -*-\nname = 'caf"), new Uint8Array([0xe9]), enc("'\n"));
    assert.equal(declaredEncoding(bytes), "latin-1");
    const r = decodePythonSource(bytes);
    assert.ok(r.text.includes("café"), JSON.stringify(r.text));
  });

  it("honors a declared cp1252 encoding (coding= form)", () => {
    const bytes = concat(enc("# coding=cp1252\ns = '"), new Uint8Array([0x93]), enc("hi'\n"));
    assert.equal(declaredEncoding(bytes), "cp1252");
    const r = decodePythonSource(bytes);
    assert.ok(r.text.includes("“hi"), JSON.stringify(r.text));
  });

  it("honors a declaration on the second line", () => {
    const bytes = concat(enc("#!/usr/bin/env python\n# coding: latin-1\nname = 'caf"), new Uint8Array([0xe9]), enc("'\n"));
    const r = decodePythonSource(bytes);
    assert.ok(r.text.includes("café"));
  });

  it("decodes a UTF-16 BOM file", () => {
    const body = Buffer.from("x = 1\n", "utf16le");
    const r = decodePythonSource(concat(new Uint8Array([0xff, 0xfe]), new Uint8Array(body)));
    assert.equal(r.text, "x = 1\n");
  });

  it("rejects invalid bytes instead of parsing corrupted text", () => {
    const msg = throwsDecode(concat(enc("x = '"), new Uint8Array([0xff]), enc("'\n")));
    assert.match(msg, /cannot decode as "utf-8"/);
  });

  it("rejects a declared ascii violation", () => {
    const bytes = concat(enc("# coding: ascii\nname = 'caf"), new Uint8Array([0xe9]), enc("'\n"));
    assert.match(throwsDecode(bytes), /cannot decode as "ascii"/);
  });

  it("rejects an unsupported declared encoding", () => {
    const msg = throwsDecode(enc("# -*- coding: unknown-xyz -*-\npass\n"));
    assert.match(msg, /unsupported encoding "unknown-xyz"/);
  });

  it("ignores coding: outside a leading comment", () => {
    // A string literal mentioning an encoding must not select it: the lone
    // 0xE9 byte is invalid UTF-8, so decoding must fail as UTF-8.
    const bytes = concat(enc('x = "coding: latin-1"\nname = \'caf'), new Uint8Array([0xe9]), enc("'\n"));
    assert.equal(declaredEncoding(bytes), undefined);
    assert.match(throwsDecode(bytes), /cannot decode as "utf-8"/);
  });

  it("refuses UTF-32 rather than mis-decoding it", () => {
    const ascii = Buffer.from("x = 1\n", "ascii");
    const utf32le = Buffer.alloc(ascii.length * 4);
    for (let i = 0; i < ascii.length; i++) {
      utf32le[i * 4] = ascii[i];
    }
    const msg = throwsDecode(concat(new Uint8Array([0xff, 0xfe, 0x00, 0x00]), new Uint8Array(utf32le)));
    assert.match(msg, /unsupported encoding "utf-32"/);
  });
});
