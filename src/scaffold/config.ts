import { SCAFFOLD_CONFIG } from "../studio/paths";

/** Optional per-project settings stored in `.agent-studio/scaffold.json`. */
export interface ScaffoldConfig {
  /** Workspace-relative folder of the approved reference app, e.g. "apps/orders". */
  referenceApp?: string;
  /** Singular entity name used inside the reference app, e.g. "Order". Guessed when omitted. */
  referenceEntity?: string;
  /** Extra globs (relative to the reference app) that are never copied. */
  exclude?: string[];
  /** Files every app must contain; used by the conformance check instead of the reference file list. */
  requiredFiles?: string[];
  /** Add the new app to INSTALLED_APPS-style lists. Default true. */
  registerInSettings?: boolean;
  /** Duplicate the reference app's URL include. Default true. */
  registerInUrls?: boolean;
}

export const CONFIG_FILE = SCAFFOLD_CONFIG;

/** Rejects absolute paths, drive letters, backslashes and `..` segments. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\")) {
    return false;
  }
  return p.split("/").every((seg) => seg !== ".." && seg !== "");
}

const stripSlashes = (p: string): string => p.replace(/^\.\//, "").replace(/\/+$/, "");

export function parseConfig(text: string): { config: ScaffoldConfig; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { config: {}, errors: [`${CONFIG_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: {}, errors: [`${CONFIG_FILE} must contain a JSON object.`] };
  }
  const obj = raw as Record<string, unknown>;
  const config: ScaffoldConfig = {};

  const str = (key: keyof ScaffoldConfig): string | undefined => {
    const v = obj[key];
    if (v === undefined) {
      return undefined;
    }
    if (typeof v !== "string" || !v.trim()) {
      errors.push(`"${key}" must be a non-empty string.`);
      return undefined;
    }
    return v.trim();
  };
  const strList = (key: keyof ScaffoldConfig): string[] | undefined => {
    const v = obj[key];
    if (v === undefined) {
      return undefined;
    }
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim())) {
      errors.push(`"${key}" must be an array of non-empty strings.`);
      return undefined;
    }
    const list = v.map((x: string) => stripSlashes(x.trim()));
    const bad = list.filter((x) => !isSafeRelativePath(x));
    if (bad.length > 0) {
      errors.push(`"${key}" has unsafe paths: ${bad.join(", ")}`);
      return undefined;
    }
    return list;
  };
  const bool = (key: keyof ScaffoldConfig): boolean | undefined => {
    const v = obj[key];
    if (v === undefined) {
      return undefined;
    }
    if (typeof v !== "boolean") {
      errors.push(`"${key}" must be true or false.`);
      return undefined;
    }
    return v;
  };

  const ref = str("referenceApp");
  if (ref !== undefined) {
    const clean = stripSlashes(ref);
    if (isSafeRelativePath(clean)) {
      config.referenceApp = clean;
    } else {
      errors.push(`"referenceApp" must be a workspace-relative folder without "..".`);
    }
  }
  config.referenceEntity = str("referenceEntity");
  config.exclude = strList("exclude");
  config.requiredFiles = strList("requiredFiles");
  config.registerInSettings = bool("registerInSettings");
  config.registerInUrls = bool("registerInUrls");
  for (const key of Object.keys(config) as (keyof ScaffoldConfig)[]) {
    if (config[key] === undefined) {
      delete config[key];
    }
  }
  return { config, errors };
}

/** Returns the config file text with `referenceApp` set, keeping every other key. */
export function withReferenceApp(existingText: string | undefined, referenceApp: string): string {
  let obj: Record<string, unknown> = {};
  if (existingText !== undefined && existingText.trim()) {
    const parsed: unknown = JSON.parse(existingText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${CONFIG_FILE} must contain a JSON object.`);
    }
    obj = parsed as Record<string, unknown>;
  }
  obj.referenceApp = referenceApp;
  return JSON.stringify(obj, null, 2) + "\n";
}
