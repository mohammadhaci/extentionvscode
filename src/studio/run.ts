// Runs a module CLI's `main` in-process and captures what it prints, so the
// dispatcher, the change report and the Home view share one implementation.

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
}

export type Main = (argv: readonly string[], io: Io) => number;

export interface Captured {
  code: number;
  out: string;
  err: string;
}

export function runCaptured(main: Main, argv: readonly string[], cwd: string): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** Runs a `--json` command and parses its stdout; undefined (with the error text) when that fails. */
export function runJson<T>(main: Main, argv: readonly string[], cwd: string): { json?: T; error?: string } {
  const r = runCaptured(main, argv, cwd);
  try {
    return { json: JSON.parse(r.out) as T };
  } catch {
    return { error: (r.err || r.out || `exit ${r.code}`).trim().split("\n")[0] };
  }
}
