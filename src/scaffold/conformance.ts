import { isExcluded } from "./plan";
import { Renamer } from "./rename";

/**
 * Files an app is expected to have: `requiredFiles` when configured,
 * otherwise the reference app's Python files. Either list is renamed for the
 * app being checked, so "templates/orders/x.html" becomes "templates/invoices/x.html".
 */
export function expectedFiles(
  referenceFiles: readonly string[],
  renamer: Renamer,
  requiredFiles?: readonly string[],
  extraExcludes: readonly string[] = []
): string[] {
  const base = requiredFiles ?? referenceFiles.filter((f) => f.endsWith(".py") && !isExcluded(f, extraExcludes));
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

export function formatConformanceReport(referenceDir: string, source: string, results: readonly AppConformance[]): string {
  const out: string[] = [
    "# Django apps vs. reference",
    "",
    `Reference app: \`${referenceDir}\` · expected files from: ${source}`,
    "",
  ];
  if (results.length === 0) {
    out.push("No other apps found.");
    return out.join("\n") + "\n";
  }
  const clean = results.filter((r) => r.missing.length === 0 && r.registered);
  out.push(`**${clean.length} / ${results.length}** apps match the reference structure.`, "");
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
