import { isExcluded } from "./plan";
import { Renamer } from "./rename";

/** Module names that make up a Django app's structure, as opposed to its feature code. */
const STANDARD_MODULES = new Set([
  "__init__", "admin", "apps", "models", "views", "urls", "forms", "serializers", "services", "selectors",
  "permissions", "signals", "receivers", "handlers", "tasks", "filters", "managers", "querysets", "validators",
  "utils", "constants", "choices", "exceptions", "tests", "factories", "api", "schemas", "mixins", "middleware",
  "decorators", "context_processors", "admin_views", "routers", "viewsets", "types", "enums",
]);

/**
 * The reference app's skeleton: its standard top-level modules (models.py,
 * views.py, ...) and the `__init__.py` of each top-level package (services/,
 * tests/, migrations/, ...). Feature files such as services/change_reviews.py
 * are not part of it, so apps are not expected to copy the reference's features.
 */
export function skeletonFiles(referenceFiles: readonly string[], extraExcludes: readonly string[] = []): string[] {
  return referenceFiles.filter((f) => {
    if (!f.endsWith(".py") || isExcluded(f, extraExcludes)) {
      return false;
    }
    const parts = f.split("/");
    return (parts.length === 1 && STANDARD_MODULES.has(parts[0].slice(0, -3))) || (parts.length === 2 && parts[1] === "__init__.py");
  });
}

/**
 * Files an app is expected to have: `requiredFiles` when configured,
 * otherwise the reference app's skeleton. Either list is renamed for the app
 * being checked, so "templates/orders/x.html" becomes "templates/invoices/x.html".
 */
export function expectedFiles(
  referenceFiles: readonly string[],
  renamer: Renamer,
  requiredFiles?: readonly string[],
  extraExcludes: readonly string[] = []
): string[] {
  const base = requiredFiles ?? skeletonFiles(referenceFiles, extraExcludes);
  return [...new Set(base.map((f) => renamer.apply(f).text))].sort();
}

export function missingFiles(expected: readonly string[], actual: ReadonlySet<string>): string[] {
  return expected.filter((f) => !actual.has(f));
}

export interface AppConformance {
  dir: string;
  missing: string[];
  registered: boolean;
}

export function formatConformanceReport(
  referenceDir: string,
  source: string,
  results: readonly AppConformance[],
  skipped: readonly string[] = []
): string {
  const out: string[] = [
    "# Django apps vs. reference",
    "",
    `Reference app: \`${referenceDir}\` · expected files from: ${source}`,
    "",
  ];
  const skippedNote =
    skipped.length > 0
      ? [`${skipped.length} app(s) that existed before the studio are not checked: ${skipped.map((s) => `\`${s}\``).join(", ")}. Set \`"checkAllApps": true\` in the scaffold settings to include them.`, ""]
      : [];
  if (results.length === 0) {
    out.push("No apps created from the reference yet. Apps made with “New App from Reference” are checked here.", "", ...skippedNote);
    return out.join("\n") + "\n";
  }
  const clean = results.filter((r) => r.missing.length === 0 && r.registered);
  out.push(`**${clean.length} / ${results.length}** apps match the reference structure.`, "", ...skippedNote);
  for (const r of results) {
    const ok = r.missing.length === 0 && r.registered;
    out.push(`## ${ok ? "✅" : "⚠️"} \`${r.dir}\``);
    if (!r.registered) {
      out.push("- Not found in any settings app list (INSTALLED_APPS / *_APPS).");
    }
    for (const m of r.missing) {
      out.push(`- Missing \`${m}\``);
    }
    if (ok) {
      out.push("- Matches the reference.");
    }
    out.push("");
  }
  return out.join("\n");
}
