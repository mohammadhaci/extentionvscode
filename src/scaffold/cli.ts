// Non-interactive CLI for coding agents (Claude Code, Codex, Copilot) and scripts.
// Same core as the VS Code commands; no dependencies beyond Node's standard library.
import * as fs from "fs";
import * as path from "path";
import { CONFIG_FILE, parseConfig, ScaffoldConfig, withReferenceApp, withScaffoldedApp } from "./config";
import { formatConformanceReport } from "./conformance";
import { guessSingular, validateAppName } from "./names";
import { planFiles, SourceFile } from "./plan";
import { formatPreview } from "./preview";
import { applyEdits } from "./registration";
import { CLI } from "../studio/paths";
import {
  baseOf, checkConformance, FileText, isSettingsFile, isUrlsFile, joinPath, newAppRenamer, parentOf, planRegistrations, referenceEntity,
} from "./workflow";

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `Django App Scaffolder CLI

Usage (run from anywhere inside the Django project):
  ${CLI} scaffold new <app_name> [--entity <Singular>] [--reference <dir>] [--dry-run] [--json]
  ${CLI} scaffold check [--reference <dir>] [--json]
  ${CLI} scaffold apps [--json]
  ${CLI} scaffold reference <app_dir>

Commands:
  new        Clone the reference app into a sibling folder named <app_name>, renaming the app
             and its singular entity everywhere, and register it in settings and urls.
             --dry-run prints the full plan without writing anything.
  check      List apps missing reference files or settings registration (exit 1 if any).
  apps       List Django apps (folders with apps.py) and the configured reference app.
  reference  Save <app_dir> as "referenceApp" in ${CONFIG_FILE}.

Exit codes: 0 success, 1 failure or check issues, 2 usage error.`;

const SKIP_DIRS = new Set(["node_modules", "venv", "env", "site-packages", "__pycache__"]);
const MAX_PROJECT_FILES = 100_000;
const MAX_APP_FILES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

class UsageError extends Error {}

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(["dry-run", "json", "help"]);

function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      flags.set("help", true);
    } else if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, true);
      } else if (inline !== undefined) {
        flags.set(key, inline);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags.set(key, argv[++i]);
      } else {
        throw new UsageError(`--${key} needs a value.`);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flag(p: Parsed, key: string): string | undefined {
  const v = p.flags.get(key);
  return typeof v === "string" ? v : undefined;
}

/** Nearest ancestor holding the config file or manage.py; falls back to `cwd`. */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE)) || fs.existsSync(path.join(dir, "manage.py"))) {
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      return path.resolve(cwd);
    }
    dir = up;
  }
}

/** Project-relative file paths, skipping hidden, virtualenv and dependency folders and all symlinks. */
function listFiles(root: string, sub: string, limit: number, skipped: string[] = []): string[] {
  const files: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 20) {
      skipped.push(`${rel} (too deep)`);
      return;
    }
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const child = joinPath(rel, e.name);
      if (e.isSymbolicLink()) {
        skipped.push(`${child} (symlink)`);
      } else if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          walk(child, depth + 1);
        }
      } else if (e.isFile()) {
        if (files.length >= limit) {
          throw new Error(`More than ${limit} files under "${sub || "."}".`);
        }
        files.push(child);
      }
    }
  };
  walk(sub, 0);
  return files;
}

function readText(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function loadConfig(root: string, io: Io): ScaffoldConfig {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    return {};
  }
  const { config, errors } = parseConfig(fs.readFileSync(file, "utf8"));
  for (const e of errors) {
    io.err(`warning: ${CONFIG_FILE}: ${e}`);
  }
  return config;
}

function appDirs(projectFiles: readonly string[]): string[] {
  return [...new Set(projectFiles.filter((f) => baseOf(f) === "apps.py").map(parentOf))].filter(Boolean).sort();
}

function resolveReference(root: string, p: Parsed, config: ScaffoldConfig): string {
  const ref = (flag(p, "reference") ?? config.referenceApp)?.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!ref) {
    throw new Error(`No reference app. Ask a human which approved app to clone, then run "reference <app_dir>" or pass --reference.`);
  }
  if (ref.split("/").includes("..") || path.isAbsolute(ref) || !fs.existsSync(path.join(root, ref, "apps.py"))) {
    throw new Error(`Reference app "${ref}" not found (expected ${ref}/apps.py inside ${root}).`);
  }
  return ref;
}

function readSources(root: string, refDir: string): { files: SourceFile[]; skipped: string[] } {
  const skipped: string[] = [];
  let total = 0;
  const files: SourceFile[] = [];
  for (const f of listFiles(root, refDir, MAX_APP_FILES, skipped)) {
    const relPath = f.slice(refDir.length + 1);
    const bytes = fs.readFileSync(path.join(root, f));
    if (bytes.length > MAX_FILE_BYTES) {
      skipped.push(`${relPath} (larger than 2 MB)`);
      continue;
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("Reference app is larger than 30 MB.");
    }
    files.push({ relPath, bytes: new Uint8Array(bytes) });
  }
  return { files, skipped: skipped.map((s) => s.slice(refDir.length + 1)) };
}

function cmdNew(root: string, p: Parsed, io: Io): number {
  const appName = p.positional[1];
  if (!appName || p.positional.length > 2) {
    throw new UsageError("Usage: new <app_name> [--entity <Singular>] [--reference <dir>] [--dry-run] [--json]");
  }
  const config = loadConfig(root, io);
  const refDir = resolveReference(root, p, config);
  const parent = parentOf(refDir);
  const siblings = new Set(fs.readdirSync(path.join(root, parent)));
  const invalid = validateAppName(appName, siblings);
  if (invalid) {
    throw new Error(invalid);
  }
  const entity = flag(p, "entity");
  if (entity !== undefined && !/^[A-Za-z][A-Za-z0-9_ -]*$/.test(entity)) {
    throw new Error("--entity: letters, digits, spaces, _ or - only.");
  }
  const renamer = newAppRenamer(refDir, appName, config, entity);
  const targetDir = joinPath(parent, appName);

  const sources = readSources(root, refDir);
  const plan = planFiles(sources.files, renamer, config.exclude);
  plan.skipped.push(...sources.skipped);
  const projectFiles = listFiles(root, "", MAX_PROJECT_FILES);
  const read = (files: string[]): FileText[] => files.map((f) => ({ path: f, text: readText(root, f) }));
  const reg = planRegistrations(read(projectFiles.filter(isSettingsFile)), read(projectFiles.filter(isUrlsFile)), refDir, targetDir, renamer, config);
  const dryRun = p.flags.has("dry-run");
  const refEntity = referenceEntity(refDir, config);
  const summary = {
    dryRun,
    reference: refDir,
    target: targetDir,
    entity: refEntity ? { from: refEntity, to: entity ?? guessSingular(appName) } : undefined,
    renames: renamer.pairs,
    files: plan.files.map((f) => ({ path: joinPath(targetDir, f.targetRel), replacements: f.replacements, binary: f.binary })),
    skipped: plan.skipped,
    registrations: reg.descriptions,
    needsAttention: [...plan.errors, ...reg.notes],
  };

  if (plan.errors.length > 0) {
    io.out(p.flags.has("json") ? JSON.stringify({ ...summary, ok: false }, null, 2) : formatPreview({ referenceDir: refDir, targetDir, pairs: renamer.pairs, plan, registrations: reg.descriptions, notes: reg.notes }));
    io.err("error: cannot create the app; see “Needs attention”.");
    return 1;
  }
  if (dryRun) {
    io.out(p.flags.has("json") ? JSON.stringify({ ...summary, ok: true }, null, 2) : formatPreview({ referenceDir: refDir, targetDir, pairs: renamer.pairs, plan, registrations: reg.descriptions, notes: reg.notes }));
    return 0;
  }

  if (fs.existsSync(path.join(root, targetDir))) {
    throw new Error(`"${targetDir}" already exists; nothing was written.`);
  }
  for (const f of plan.files) {
    const dest = path.join(root, targetDir, f.targetRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.bytes, { flag: "wx" });
  }
  for (const [file, { text, edits }] of reg.byFile) {
    fs.writeFileSync(path.join(root, file), applyEdits(text, edits));
  }
  // Remember the app so the structure check covers it.
  const configFile = path.join(root, ...CONFIG_FILE.split("/"));
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, withScaffoldedApp(fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : undefined, targetDir));

  if (p.flags.has("json")) {
    io.out(JSON.stringify({ ...summary, ok: true }, null, 2));
    return 0;
  }
  io.out(`Created ${targetDir}/ from ${refDir}/ (${plan.files.length} files).`);
  for (const r of reg.descriptions) {
    io.out(`Registered: ${r}`);
  }
  for (const n of reg.notes) {
    io.out(`Needs attention: ${n}`);
  }
  io.out(`Next: python manage.py makemigrations ${appName} && python manage.py check`);
  return 0;
}

function cmdCheck(root: string, p: Parsed, io: Io): number {
  const config = loadConfig(root, io);
  const refDir = resolveReference(root, p, config);
  const projectFiles = listFiles(root, "", MAX_PROJECT_FILES);
  const filesUnder = (dir: string): Set<string> =>
    new Set(projectFiles.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)));
  const refFiles = [...filesUnder(refDir)];
  const apps = appDirs(projectFiles).map((dir) => ({ dir, files: filesUnder(dir) }));
  const settingsTexts = projectFiles.filter(isSettingsFile).map((f) => readText(root, f));
  const { results, skipped } = checkConformance(refDir, refFiles, apps, settingsTexts, config);
  const failing = results.filter((r) => r.missing.length > 0 || !r.registered);
  if (p.flags.has("json")) {
    io.out(JSON.stringify({ reference: refDir, ok: failing.length === 0, apps: results, skipped }, null, 2));
  } else {
    const source = config.requiredFiles ? `\`requiredFiles\` in ${CONFIG_FILE}` : "the reference app's skeleton (standard modules and packages)";
    io.out(formatConformanceReport(refDir, source, results, skipped));
  }
  return failing.length === 0 ? 0 : 1;
}

function cmdApps(root: string, p: Parsed, io: Io): number {
  const config = loadConfig(root, io);
  const apps = appDirs(listFiles(root, "", MAX_PROJECT_FILES));
  if (p.flags.has("json")) {
    io.out(JSON.stringify({ reference: config.referenceApp ?? null, apps }, null, 2));
  } else {
    io.out(`Reference app: ${config.referenceApp ?? "(not set)"}`);
    for (const a of apps) {
      io.out(`${a === config.referenceApp ? "* " : "  "}${a}`);
    }
  }
  return 0;
}

function cmdReference(root: string, p: Parsed, io: Io): number {
  const dir = p.positional[1]?.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!dir || p.positional.length > 2) {
    throw new UsageError("Usage: reference <app_dir>");
  }
  resolveReference(root, { positional: [], flags: new Map([["reference", dir]]) }, {});
  const file = path.join(root, CONFIG_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, withReferenceApp(existing, dir));
  io.out(`Reference app set to ${dir} in ${CONFIG_FILE}.`);
  return 0;
}

export function main(argv: readonly string[], io: Io): number {
  try {
    const p = parseArgs(argv);
    const cmd = p.positional[0];
    if (!cmd || p.flags.has("help") || cmd === "help") {
      io.out(USAGE);
      return cmd || p.flags.has("help") ? 0 : 2;
    }
    const root = findProjectRoot(io.cwd);
    switch (cmd) {
      case "new":
        return cmdNew(root, p, io);
      case "check":
        return cmdCheck(root, p, io);
      case "apps":
        return cmdApps(root, p, io);
      case "reference":
        return cmdReference(root, p, io);
      default:
        throw new UsageError(`Unknown command "${cmd}". Run with --help.`);
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof UsageError ? 2 : 1;
  }
}
