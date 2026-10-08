// Filesystem side: scans the project, renders the block and updates the targets.
// Shared by the CLI and the VS Code extension (which runs in Node as well).
import * as fs from "fs";
import * as path from "path";
import { decodePythonSource } from "../vendor/analyzer/decodePythonSource";
import { CONFIG_FILE, ContextConfig, DEFAULT_CONFIG, parseContextConfig, RULES_FILE, RULES_TEMPLATE, SCAFFOLD_CONFIG } from "./config";
import { upsertBlock } from "./managedBlock";
import { ProjectSummary, SourceText, summarizeProject } from "./projectMap";
import { renderBlock } from "./render";

const SKIP_DIRS = new Set(["node_modules", "venv", "env", "site-packages", "__pycache__", "migrations", "dist", "build", "staticfiles", "media"]);
const MAX_PY_FILES = 20_000;
const MAX_PY_BYTES = 1024 * 1024;

export type TargetStatus = "created" | "updated" | "unchanged" | "stale" | "error";

export interface TargetResult {
  path: string;
  status: TargetStatus;
  error?: string;
}

export interface SyncResult {
  results: TargetResult[];
  warnings: string[];
  summary?: ProjectSummary;
  block: string;
}

/** Python sources of the project, skipping hidden, dependency, build and migration folders and symlinks. */
export function scanPython(root: string, warnings: string[] = []): SourceText[] {
  const out: SourceText[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 25) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      warnings.push(`Could not read folder ${rel || "."}.`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          walk(child, depth + 1);
        }
      } else if (e.isFile() && e.name.endsWith(".py")) {
        if (out.length >= MAX_PY_FILES) {
          warnings.push(`Stopped after ${MAX_PY_FILES} Python files; the project map may be incomplete.`);
          return;
        }
        const full = path.join(root, child);
        if (fs.statSync(full).size > MAX_PY_BYTES) {
          warnings.push(`Skipped ${child} (larger than 1 MB).`);
          continue;
        }
        try {
          out.push({ path: child, text: decodePythonSource(fs.readFileSync(full)).text });
        } catch {
          warnings.push(`Skipped ${child} (could not decode).`);
        }
      }
    }
  };
  walk("", 0);
  return out;
}

function readIfExists(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

export function loadConfig(root: string, warnings: string[]): ContextConfig {
  const text = readIfExists(path.join(root, CONFIG_FILE));
  if (text === undefined) {
    return { ...DEFAULT_CONFIG };
  }
  const { config, errors } = parseContextConfig(text);
  warnings.push(...errors.map((e) => `${e} Using defaults for that key.`));
  return config;
}

/** Reference app from the Django App Scaffolder config, when the project uses it. */
function scaffoldReference(root: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(readIfExists(path.join(root, SCAFFOLD_CONFIG)) ?? "null");
    const ref = (raw as { referenceApp?: unknown } | null)?.referenceApp;
    return typeof ref === "string" ? ref.replace(/^\.\//, "").replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the rules file from the template. Returns false when it already exists. */
export function initRules(root: string): boolean {
  const file = path.join(root, RULES_FILE);
  if (fs.existsSync(file)) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, RULES_TEMPLATE);
  return true;
}

/** Renders the block and updates every target, or only reports drift when `check` is set. */
export function syncProject(root: string, options: { check?: boolean } = {}): SyncResult {
  const warnings: string[] = [];
  const config = loadConfig(root, warnings);
  const rules = readIfExists(path.join(root, RULES_FILE));
  if (rules === undefined) {
    warnings.push(`${RULES_FILE} not found; only the project map is synced. Run "init" to create it.`);
  }
  const summary = config.projectMap ? summarizeProject(scanPython(root, warnings), scaffoldReference(root)) : undefined;
  const block = renderBlock(rules, summary, { maxModelsPerApp: config.maxModelsPerApp });

  const results: TargetResult[] = config.targets.map((target) => {
    const file = path.join(root, target);
    try {
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
        return { path: target, status: "error", error: "is a symlink; not touched" };
      }
      const existing = readIfExists(file);
      const next = upsertBlock(existing, block);
      if (next === existing) {
        return { path: target, status: "unchanged" };
      }
      if (options.check) {
        return { path: target, status: "stale" };
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
      return { path: target, status: existing === undefined ? "created" : "updated" };
    } catch (err) {
      return { path: target, status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  });
  return { results, warnings, summary, block };
}
