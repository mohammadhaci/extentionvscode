// Pure: a comparable picture of a Django project's structure at one point in time.
import { discoverApps, findRootUrls } from "../vendor/analyzer/appDiscovery";
import { parseModels } from "../vendor/analyzer/parseModels";
import { parseSettings } from "../vendor/analyzer/parseSettings";
import { parseUrls } from "../vendor/analyzer/parseUrls";

export interface SourceText {
  path: string;
  text: string;
}

export interface FieldSnap {
  type: string;
  /** Relation target as written ("users.Profile", "Order"). */
  target?: string;
}

export interface AppSnap {
  dir: string;
  /** model name -> field name -> field */
  models: Record<string, Record<string, FieldSnap>>;
  /** "route|name" keys of the app's own urls.py patterns (includes excluded). */
  urls: string[];
}

export interface ProjectSnap {
  apps: Record<string, AppSnap>;
  /** Root URLconf includes: "route -> module". */
  rootIncludes: string[];
  /** app dir -> other app dirs it depends on (relations + absolute imports). */
  deps: Record<string, string[]>;
}

const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
export const isSettingsPath = (p: string): boolean => /(^|\/)settings(_\w+)?\.py$/.test(p) || /(^|\/)settings\/[^/]+\.py$/.test(p);

export function moduleCandidates(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(i).join("."));
}

function appForModule(module: string, dirs: readonly string[]): string | undefined {
  let best: { dir: string; len: number } | undefined;
  for (const dir of dirs) {
    for (const c of moduleCandidates(dir)) {
      if ((module === c || module.startsWith(`${c}.`)) && (!best || c.length > best.len)) {
        best = { dir, len: c.length };
      }
    }
  }
  return best?.dir;
}

const IMPORT_RES = [/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/, /^\s*import\s+([A-Za-z_][\w.]*)/];

export function snapshot(files: readonly SourceText[]): ProjectSnap {
  const paths = files.map((f) => f.path);
  const text = new Map(files.map((f) => [f.path, f.text]));
  const installed: string[] = [];
  let rootUrlconf: string | undefined;
  for (const s of paths.filter(isSettingsPath).sort()) {
    const info = parseSettings(text.get(s) ?? "");
    installed.push(...info.installedApps);
    rootUrlconf ??= info.rootUrlconf;
  }
  const dirs = discoverApps(paths, installed)
    .filter((a) => a.dir !== "" && a.confidence !== "low")
    .map((a) => a.dir)
    .sort();

  const apps: Record<string, AppSnap> = {};
  const modelOwners = new Map<string, string[]>();
  for (const dir of dirs) {
    const models: AppSnap["models"] = {};
    const modelFiles = paths.filter((p) => p === `${dir}/models.py` || (p.startsWith(`${dir}/models/`) && p.endsWith(".py"))).sort();
    for (const f of modelFiles) {
      for (const m of parseModels(text.get(f) ?? "")) {
        const fields: Record<string, FieldSnap> = {};
        for (const fld of m.fields) {
          fields[fld.name] = fld.relationTarget ? { type: fld.fieldType, target: fld.relationTarget } : { type: fld.fieldType };
        }
        models[m.name] = fields;
        modelOwners.set(m.name, [...(modelOwners.get(m.name) ?? []), dir]);
      }
    }
    const urls = parseUrls(text.get(`${dir}/urls.py`) ?? "")
      .filter((u) => !u.isInclude)
      .map((u) => `${u.route}|${u.name ?? ""}`);
    apps[dir] = { dir, models, urls: [...new Set(urls)].sort() };
  }

  const rootUrls = findRootUrls(paths, rootUrlconf);
  const rootIncludes = rootUrls
    ? parseUrls(text.get(rootUrls) ?? "")
        .filter((u) => u.isInclude && u.includeModule)
        .map((u) => `${u.route} -> ${u.includeModule}`)
    : [];

  const deps: Record<string, string[]> = {};
  for (const dir of dirs) {
    const found = new Set<string>();
    for (const fields of Object.values(apps[dir].models)) {
      for (const f of Object.values(fields)) {
        if (!f.target || f.target === "self") {
          continue;
        }
        const dot = f.target.lastIndexOf(".");
        const owners = dot > 0
          ? dirs.filter((d) => baseOf(d) === f.target!.slice(0, dot) || moduleCandidates(d).includes(f.target!.slice(0, dot)))
          : modelOwners.get(f.target) ?? [];
        if (owners.length === 1) {
          found.add(owners[0]);
        }
      }
    }
    for (const p of paths) {
      if (!p.startsWith(`${dir}/`)) {
        continue;
      }
      for (const line of (text.get(p) ?? "").split(/\r?\n/)) {
        for (const re of IMPORT_RES) {
          const m = re.exec(line);
          const dep = m ? appForModule(m[1], dirs) : undefined;
          if (dep) {
            found.add(dep);
          }
        }
      }
    }
    found.delete(dir);
    deps[dir] = [...found].sort();
  }
  return { apps, rootIncludes: [...new Set(rootIncludes)].sort(), deps };
}
