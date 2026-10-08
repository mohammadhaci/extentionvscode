import { installedAppToDir } from "./parseSettings";

export interface DiscoveredApp {
  /** App name = directory basename */
  name: string;
  /** Workspace-relative directory, e.g. "blog" ("" for project root) */
  dir: string;
  files: {
    models?: string;
    views?: string;
    urls?: string;
    apps?: string;
    admin?: string;
    init?: string;
  };
  confidence: "high" | "medium" | "low";
  reason: string;
}

const MARKERS = ["models.py", "views.py", "urls.py", "apps.py", "admin.py"] as const;

function dirname(p: string): string {
  const i = p.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function basename(p: string): string {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i < 0 ? n : n.slice(i + 1);
}

/**
 * Pure app discovery from a list of workspace-relative .py paths.
 * No filesystem access; caller supplies the file list + INSTALLED_APPS.
 */
export function discoverApps(
  pyFiles: string[],
  installedApps: string[] = []
): DiscoveredApp[] {
  const norm = pyFiles.map((f) => f.replace(/\\/g, "/"));
  const fileSet = new Set(norm);
  const byDir = new Map<string, Set<string>>();
  for (const f of norm) {
    const d = dirname(f);
    if (!byDir.has(d)) {
      byDir.set(d, new Set());
    }
    byDir.get(d)!.add(basename(f));
  }

  const installedDirs = new Set(installedApps.map(installedAppToDir));
  const apps: DiscoveredApp[] = [];

  for (const [dir, names] of byDir) {
    const markers = MARKERS.filter((m) => names.has(m));
    if (markers.length === 0) {
      continue;
    }
    const base = dir === "" ? "(root)" : dir.split("/").pop()!;
    const hasInit = names.has("__init__.py");
    const markerCount = markers.length;
    // A project config package (settings.py + urls.py, no models/views)
    // is the project, not an app — skip it.
    const hasSettings = [...names].some(
      (n) => n === "settings.py" || /^settings_.*\.py$/.test(n)
    );
    const hasAppCode =
      names.has("models.py") || names.has("views.py") || names.has("apps.py");
    if (hasSettings && !hasAppCode) {
      continue;
    }
    const listed = installedDirs.has(base) || installedDirs.has(dir);

    let confidence: DiscoveredApp["confidence"] | null = null;
    let reason = "";
    if ((hasInit && markerCount >= 1 && listed) || (hasInit && markerCount >= 2)) {
      confidence = "high";
      reason = listed
        ? "listed in INSTALLED_APPS with Django package markers"
        : "package with multiple Django markers";
    } else if (listed || (hasInit && markerCount >= 1)) {
      confidence = "medium";
      reason = listed
        ? "listed in INSTALLED_APPS"
        : "package with a Django marker file";
    } else if (markerCount >= 2 || names.has("apps.py")) {
      confidence = "low";
      reason = "heuristic: Django-like files without package markers";
    }
    if (!confidence) {
      continue;
    }
    const p = (m: string) => (fileSet.has(dir ? `${dir}/${m}` : m) ? dir ? `${dir}/${m}` : m : undefined);
    apps.push({
      name: base,
      dir,
      files: {
        models: p("models.py"),
        views: p("views.py"),
        urls: p("urls.py"),
        apps: p("apps.py"),
        admin: p("admin.py"),
        init: p("__init__.py")
      },
      confidence,
      reason
    });
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

/** Find the project-root urls.py (ROOT_URLCONF or conventional locations). */
export function findRootUrls(
  pyFiles: string[],
  rootUrlconf?: string
): string | undefined {
  const norm = new Set(pyFiles.map((f) => f.replace(/\\/g, "/")));
  if (rootUrlconf) {
    const candidate = rootUrlconf.replace(/\./g, "/") + ".py";
    if (norm.has(candidate)) {
      return candidate;
    }
  }
  for (const c of ["urls.py", "config/urls.py", "project/urls.py", "src/urls.py"]) {
    if (norm.has(c)) {
      return c;
    }
  }
  // Any top-level urls.py (dir depth 0 or 1, not inside an app with models.py)
  const tops = [...norm].filter((f) => f.endsWith("/urls.py") || f === "urls.py");
  tops.sort((a, b) => a.length - b.length);
  return tops[0];
}
