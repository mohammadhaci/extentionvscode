// Pure: turns Python sources into the compact project summary agents read.
import { discoverApps, findRootUrls } from "../analyzer/appDiscovery";
import { parseModels } from "../analyzer/parseModels";
import { parseSettings } from "../analyzer/parseSettings";
import { parseUrls } from "../analyzer/parseUrls";

export interface SourceText {
  /** Project-relative, "/"-separated. */
  path: string;
  text: string;
}

export interface AppSummary {
  dir: string;
  name: string;
  models: string[];
  urlPrefix?: string;
  /** Other apps (by dir) this app references through relations or imports. */
  dependsOn: string[];
}

export interface ProjectSummary {
  isDjango: boolean;
  settings: string[];
  rootUrls?: string;
  apps: AppSummary[];
  referenceApp?: string;
}

const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

export const isSettingsPath = (p: string): boolean => /(^|\/)settings(_\w+)?\.py$/.test(p) || /(^|\/)settings\/[^/]+\.py$/.test(p);

/** Dotted names an app may be imported as: "src/apps/orders" -> ["src.apps.orders", "apps.orders", "orders"]. */
export function moduleCandidates(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(i).join("."));
}

/** The app whose dotted path is the longest prefix of `module`. */
function appForModule(module: string, apps: readonly { dir: string; candidates: string[] }[]): string | undefined {
  let best: { dir: string; len: number } | undefined;
  for (const a of apps) {
    for (const c of a.candidates) {
      if ((module === c || module.startsWith(`${c}.`)) && (!best || c.length > best.len)) {
        best = { dir: a.dir, len: c.length };
      }
    }
  }
  return best?.dir;
}

const IMPORT_RES = [/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/, /^\s*import\s+([A-Za-z_][\w.]*)/];

export function summarizeProject(files: readonly SourceText[], referenceApp?: string): ProjectSummary {
  const paths = files.map((f) => f.path);
  const byPath = new Map(files.map((f) => [f.path, f.text]));

  const settings = paths.filter(isSettingsPath).sort();
  const installed = new Set<string>();
  let rootUrlconf: string | undefined;
  for (const s of settings) {
    const info = parseSettings(byPath.get(s) ?? "");
    info.installedApps.forEach((a) => installed.add(a));
    rootUrlconf ??= info.rootUrlconf;
  }
  const hasManage = paths.some((p) => baseOf(p) === "manage.py");
  const discovered = discoverApps(paths, [...installed]).filter((a) => a.dir !== "" && a.confidence !== "low");
  const isDjango = hasManage || installed.size > 0;
  if (!isDjango) {
    return { isDjango, settings, apps: [], referenceApp };
  }

  const appRefs = discovered.map((a) => ({ dir: a.dir, candidates: moduleCandidates(a.dir) }));
  const modelsByApp = new Map<string, { name: string; targets: string[] }[]>();
  for (const a of discovered) {
    const modelFiles = paths.filter((p) => p === `${a.dir}/models.py` || (p.startsWith(`${a.dir}/models/`) && p.endsWith(".py"))).sort();
    modelsByApp.set(
      a.dir,
      modelFiles.flatMap((f) =>
        parseModels(byPath.get(f) ?? "").map((m) => ({
          name: m.name,
          targets: m.fields.map((x) => x.relationTarget).filter((t): t is string => !!t && t !== "self"),
        }))
      )
    );
  }

  const rootUrls = findRootUrls(paths, rootUrlconf);
  const prefixes = new Map<string, string>();
  if (rootUrls) {
    for (const u of parseUrls(byPath.get(rootUrls) ?? "")) {
      const dir = u.isInclude && u.includeModule ? appForModule(u.includeModule, appRefs) : undefined;
      if (dir && !prefixes.has(dir)) {
        prefixes.set(dir, `/${u.route.replace(/^\^/, "").replace(/\$$/, "")}`);
      }
    }
  }

  const modelOwner = new Map<string, string[]>();
  for (const [dir, models] of modelsByApp) {
    for (const m of models) {
      modelOwner.set(m.name, [...(modelOwner.get(m.name) ?? []), dir]);
    }
  }

  const apps: AppSummary[] = discovered.map((a) => {
    const deps = new Set<string>();
    for (const m of modelsByApp.get(a.dir) ?? []) {
      for (const t of m.targets) {
        const [label, model] = t.includes(".") ? [t.slice(0, t.lastIndexOf(".")), t.slice(t.lastIndexOf(".") + 1)] : [undefined, t];
        const owners = label
          ? discovered.filter((o) => o.name === label || moduleCandidates(o.dir).includes(label)).map((o) => o.dir)
          : modelOwner.get(model) ?? [];
        if (owners.length === 1) {
          deps.add(owners[0]);
        }
      }
    }
    for (const p of paths) {
      if (!p.startsWith(`${a.dir}/`)) {
        continue;
      }
      for (const line of (byPath.get(p) ?? "").split(/\r?\n/)) {
        for (const re of IMPORT_RES) {
          const m = re.exec(line);
          const dep = m ? appForModule(m[1], appRefs) : undefined;
          if (dep) {
            deps.add(dep);
          }
        }
      }
    }
    deps.delete(a.dir);
    return {
      dir: a.dir,
      name: a.name,
      models: (modelsByApp.get(a.dir) ?? []).map((m) => m.name),
      urlPrefix: prefixes.get(a.dir),
      dependsOn: [...deps].sort(),
    };
  });
  apps.sort((x, y) => x.dir.localeCompare(y.dir));
  return { isDjango, settings, rootUrls, apps, referenceApp };
}
