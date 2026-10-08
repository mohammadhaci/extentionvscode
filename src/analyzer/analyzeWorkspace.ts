import * as vscode from "vscode";
import { discoverApps, findRootUrls } from "./appDiscovery";
import { buildProjectMap } from "./graphBuilder";
import { parseModels } from "./parseModels";
import { parseSettings } from "./parseSettings";
import { parseUrls } from "./parseUrls";
import { parseViews } from "./parseViews";
import { emptyMap, type AnalysisWarning, type ProjectMap } from "../shared/graphTypes";
import {
  MAX_FILE_BYTES,
  MAX_PY_FILES,
  fileCountCapWarning,
  largeFileWarning
} from "./analysisLimits";
import { decodePythonSource, PythonDecodeError } from "./decodePythonSource";

const EXCLUDE_GLOBS = [
  "**/{.venv,venv,env,.env,node_modules,.git,.tox,dist,build,out}/**",
  "**/{__pycache__,.mypy_cache,.pytest_cache}/**",
  "**/{migrations}/**",
  "**/site-packages/**"
];


/**
 * Analyze the currently opened workspace folder without executing any
 * project code. Reads .py files as text and applies heuristic parsers.
 */
export async function analyzeWorkspace(
  folder: vscode.WorkspaceFolder,
  onProgress?: (message: string) => void
): Promise<ProjectMap> {
  const report = (m: string) => onProgress?.(m);
  report("Discovering Python files…");

  const found = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.py"),
    `{${EXCLUDE_GLOBS.join(",")}}`,
    MAX_PY_FILES
  );

  if (found.length === 0) {
    return emptyMap(
      folder.name,
      "No Python files found in this workspace. Open a folder containing a Django project (manage.py / settings.py / app folders)."
    );
  }

  const warnings: AnalysisWarning[] = [];
  const capWarning = fileCountCapWarning(found.length, MAX_PY_FILES);
  if (capWarning) {
    warnings.push(capWarning);
  }

  const rel = (u: vscode.Uri) =>
    vscode.workspace.asRelativePath(u, false);

  const pyFiles = found.map((u) => rel(u).replace(/\\/g, "/"));
  const settingsFiles = pyFiles.filter((f) => /(^|\/)settings(_\w+)?\.py$/.test(f));
  const hasManagePy = pyFiles.some((f) => /(^|\/)manage\.py$/.test(f));

  report("Parsing settings…");
  let installedApps: string[] = [];
  let rootUrlconf: string | undefined;
  let settingsDjango = false;
  const contents = new Map<string, string>();

  const readText = async (file: string): Promise<string | undefined> => {
    try {
      const uri = vscode.Uri.joinPath(folder.uri, ...file.split("/"));
      const stat = await vscode.workspace.fs.stat(uri);
      const skipped = largeFileWarning(file, stat.size, MAX_FILE_BYTES);
      if (skipped) {
        warnings.push(skipped);
        return undefined;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      try {
        return decodePythonSource(bytes).text;
      } catch (err) {
        const reason = err instanceof PythonDecodeError ? err.message : String(err);
        warnings.push({ message: `Skipped ${file}: ${reason}.`, file });
        return undefined;
      }
    } catch (err) {
      warnings.push({
        message: `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
        file
      });
      return undefined;
    }
  };

  // Read settings + detect Django
  for (const s of settingsFiles.slice(0, 3)) {
    const text = await readText(s);
    if (!text) {
      continue;
    }
    contents.set(s, text);
    const info = parseSettings(text);
    installedApps.push(...info.installedApps);
    rootUrlconf = rootUrlconf ?? info.rootUrlconf;
    settingsDjango = settingsDjango || info.looksLikeDjango;
  }

  const apps = discoverApps(pyFiles, installedApps);
  const rootUrlsFile = findRootUrls(pyFiles, rootUrlconf);
  const looksLikeDjango =
    settingsDjango || hasManagePy || apps.length > 0 || rootUrlsFile !== undefined;

  if (!looksLikeDjango) {
    return {
      ...emptyMap(
        folder.name,
        "This folder does not look like a Django project. Expected manage.py, settings.py with INSTALLED_APPS, or app folders with models.py / views.py / urls.py. Heuristic scan found none of these."
      ),
      warnings
    };
  }
  if (apps.length === 0) {
    warnings.push({
      message:
        "Django markers found (manage.py/settings/urls) but no app folders matched the discovery heuristic. Showing URL and view data without app grouping."
    });
  }

  report("Parsing models, views and URLs…");
  const modelsByFile = new Map();
  const viewsByFile = new Map();
  const urlsByFile = new Map();

  const targets = new Set<string>();
  for (const a of apps) {
    if (a.files.models) {
      targets.add(a.files.models);
    }
    if (a.files.views) {
      targets.add(a.files.views);
    }
    if (a.files.urls) {
      targets.add(a.files.urls);
    }
  }
  if (rootUrlsFile) {
    targets.add(rootUrlsFile);
  }
  // Also scan any other urls.py / views.py / models.py not attributed to an app
  for (const f of pyFiles) {
    if (/((^|\/)(models|views|urls)\.py$)/.test(f)) {
      targets.add(f);
    }
  }

  for (const file of [...targets].sort()) {
    let text = contents.get(file);
    if (text === undefined) {
      const t = await readText(file);
      if (t === undefined) {
        continue;
      }
      text = t;
      contents.set(file, t);
    }
    try {
      if (file.endsWith("models.py")) {
        modelsByFile.set(file, parseModels(text));
      } else if (file.endsWith("views.py")) {
        viewsByFile.set(file, parseViews(text));
      } else if (file.endsWith("urls.py")) {
        urlsByFile.set(file, parseUrls(text));
      }
    } catch (err) {
      warnings.push({
        message: `Failed to parse ${file} heuristically: ${err instanceof Error ? err.message : String(err)}`,
        file
      });
    }
  }

  report("Building map…");
  const map = buildProjectMap({
    workspaceName: folder.name,
    apps,
    modelsByFile: modelsByFile as Map<string, never>,
    viewsByFile: viewsByFile as Map<string, never>,
    urlsByFile: urlsByFile as Map<string, never>,
    rootUrlsFile,
    warnings
  });
  return map;
}
