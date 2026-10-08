import { FilePlan } from "./plan";
import { RenamePair } from "./rename";

export interface PreviewInput {
  referenceDir: string;
  targetDir: string;
  pairs: readonly RenamePair[];
  plan: FilePlan;
  registrations: readonly string[];
  notes: readonly string[];
}

const code = (s: string): string => "`" + s.replace(/`/g, "'") + "`";

/** Markdown shown before anything is written, so the user can review every change. */
export function formatPreview(p: PreviewInput): string {
  const out: string[] = [
    `# New Django app: ${code(p.targetDir)}`,
    "",
    `Cloned from reference ${code(p.referenceDir)}. Nothing is written until you confirm.`,
    "",
    "## Renames",
    "",
    "| From | To |",
    "| --- | --- |",
    ...p.pairs.map((r) => `| ${code(r.from)} | ${code(r.to)} |`),
    "",
    `## Files (${p.plan.files.length})`,
    "",
    ...p.plan.files.map((f) => {
      const tag = f.binary ? "binary, copied as-is" : `${f.replacements} replacement${f.replacements === 1 ? "" : "s"}`;
      return `- ${code(f.targetRel)} — ${tag}`;
    }),
    "",
  ];
  if (p.plan.skipped.length > 0) {
    out.push(`## Skipped (${p.plan.skipped.length})`, "", ...p.plan.skipped.map((s) => `- ${code(s)}`), "");
  }
  out.push("## Registration", "");
  out.push(...(p.registrations.length > 0 ? p.registrations.map((r) => `- ${r}`) : ["- No automatic registration edits."]));
  out.push("");
  if (p.notes.length > 0 || p.plan.errors.length > 0) {
    out.push("## Needs attention", "", ...p.plan.errors.map((e) => `- ❌ ${e}`), ...p.notes.map((n) => `- ${n}`), "");
  }
  out.push(
    "## After creating",
    "",
    "1. Review the new files and the unsaved registration edits, then save.",
    `2. Run ${code("python manage.py makemigrations")} for the new app.`,
    "3. Run the tests.",
    ""
  );
  return out.join("\n");
}
