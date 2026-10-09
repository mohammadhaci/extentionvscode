// Host-independent orchestration shared by the VS Code commands and the CLI.
import { ScaffoldConfig } from "./config";
import { AppConformance, expectedFiles, missingFiles } from "./conformance";
import { guessSingular, splitWords } from "./names";
import { isRegistered, planSettingsRegistration, planUrlsRegistration, RegistrationEdit } from "./registration";
import { buildRenamePairs, createRenamer, Renamer } from "./rename";

export interface FileText {
  path: string;
  text: string;
}

export const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
export const parentOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/** Settings modules: any *settings*.py file or a module inside a settings/ package. */
export const isSettingsFile = (p: string): boolean => /settings[^/]*\.py$/.test(baseOf(p)) || /(^|\/)settings\/[^/]+\.py$/.test(p);
export const isUrlsFile = (p: string): boolean => baseOf(p) === "urls.py";

/** Reference entity name; undefined when it equals the app name (nothing extra to rename). */
export function referenceEntity(refDir: string, config: ScaffoldConfig): string | undefined {
  const refName = baseOf(refDir);
  const entity = config.referenceEntity ?? guessSingular(refName);
  return splitWords(entity).join("_") === refName ? undefined : entity;
}

export function newAppRenamer(refDir: string, appName: string, config: ScaffoldConfig, newEntity?: string): Renamer {
  const refEntity = referenceEntity(refDir, config);
  const entity = refEntity ? (newEntity ?? guessSingular(appName)) : undefined;
  return createRenamer(buildRenamePairs(baseOf(refDir), appName, entity ? refEntity : undefined, entity));
}

export interface RegistrationPlan {
  byFile: Map<string, { text: string; edits: RegistrationEdit[] }>;
  notes: string[];
  descriptions: string[];
}

export function planRegistrations(
  settings: readonly FileText[],
  urls: readonly FileText[],
  refDir: string,
  targetDir: string,
  renamer: Renamer,
  config: ScaffoldConfig
): RegistrationPlan {
  const byFile = new Map<string, { text: string; edits: RegistrationEdit[] }>();
  const notes: string[] = [];
  const collect = (files: readonly FileText[], planner: typeof planSettingsRegistration): void => {
    for (const f of files) {
      if (f.path.startsWith(`${refDir}/`)) {
        continue;
      }
      const r = planner(f.text, refDir, renamer, f.path);
      notes.push(...r.notes);
      if (r.edits.length > 0) {
        const entry = byFile.get(f.path) ?? { text: f.text, edits: [] };
        entry.edits.push(...r.edits);
        byFile.set(f.path, entry);
      }
    }
  };
  if (config.registerInSettings !== false) {
    collect(settings, planSettingsRegistration);
    if (byFile.size === 0 && notes.length === 0) {
      notes.push(`Add "${targetDir.replace(/\//g, ".")}" to INSTALLED_APPS manually (reference entry not found).`);
    }
  }
  if (config.registerInUrls !== false) {
    collect(urls, planUrlsRegistration);
  }
  const descriptions = [...byFile.values()].flatMap((e) => e.edits.map((x) => x.description));
  return { byFile, notes, descriptions };
}

export function checkConformance(
  refDir: string,
  refFiles: readonly string[],
  apps: readonly { dir: string; files: ReadonlySet<string> }[],
  settingsTexts: readonly string[],
  config: ScaffoldConfig
): { results: AppConformance[]; skipped: string[] } {
  const refName = baseOf(refDir);
  const refEntity = config.referenceEntity ?? guessSingular(refName);
  const others = apps.filter((a) => a.dir !== refDir && !a.dir.startsWith(`${refDir}/`));
  // By default only apps created from the reference are held to its structure.
  const created = new Set(config.apps ?? []);
  const checked = config.checkAllApps ? others : others.filter((a) => created.has(a.dir));
  const skipped = others.filter((a) => !checked.includes(a)).map((a) => a.dir);
  const results = checked
    .map((a) => {
      const name = baseOf(a.dir);
      const renamer = createRenamer(buildRenamePairs(refName, name, refEntity, guessSingular(name)));
      const expected = expectedFiles(refFiles, renamer, config.requiredFiles, config.exclude);
      return { dir: a.dir, missing: missingFiles(expected, a.files), registered: isRegistered(settingsTexts, a.dir) };
    });
  return { results, skipped };
}
