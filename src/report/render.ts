// Pure: report data -> Markdown (GitHub and the VS Code preview both render it).
import { FieldSnap } from "./snapshot";
import { isEmptyDiff, StructureDiff } from "./diff";
import { ChangedFile, Risk } from "./risks";
import { ToolResult } from "./tools";

export type Verdict = "red" | "yellow" | "green";

export interface Report {
  branch: string;
  base: string;
  mergeBase: string;
  commits: { sha: string; subject: string }[];
  files: ChangedFile[];
  diff: StructureDiff;
  risks: Risk[];
  tools: ToolResult[];
  verdict: Verdict;
}

/** Turns a project path (and optional line) into Markdown; the CLI and VS Code differ. */
export type LinkFn = (path: string, line?: number) => string;

export const plainLink: LinkFn = (p, line) => "`" + (line ? `${p}:${line}` : p) + "`";

export function verdictOf(risks: readonly Risk[], tools: readonly ToolResult[]): Verdict {
  const problems = tools.flatMap((t) => t.problems);
  if (risks.some((r) => r.level === "red") || problems.some((p) => p.level === "red")) {
    return "red";
  }
  if (risks.length > 0 || problems.length > 0 || tools.some((t) => t.state === "fail" || t.state === "broken")) {
    return "yellow";
  }
  return "green";
}

const VERDICT_TEXT: Record<Verdict, string> = {
  red: "🔴 **Needs changes before merging**",
  yellow: "🟡 **Review the flagged items**",
  green: "🟢 **No problems found**",
};
const ICON = { red: "🔴", yellow: "🟡" } as const;
const TOOL_ICON = { pass: "✅", fail: "❌", broken: "⚠️", missing: "➖" } as const;

const short = (s: string): string => s.slice(0, 7);
const leaf = (dir: string): string => dir.slice(dir.lastIndexOf("/") + 1);
const field = (f: FieldSnap): string => (f.target ? `${f.type} → ${f.target}` : f.type);
const esc = (s: string): string => s.replace(/\|/g, "\\|");

export function renderReport(r: Report, link: LinkFn = plainLink): string {
  const added = r.files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = r.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const problems = r.tools.flatMap((t) => t.problems);
  const reds = r.risks.filter((x) => x.level === "red").length + problems.filter((p) => p.level === "red").length;
  const yellows = r.risks.filter((x) => x.level === "yellow").length + problems.filter((p) => p.level === "yellow").length;
  const out: string[] = [
    "# Agent change report",
    "",
    `${VERDICT_TEXT[r.verdict]}${reds + yellows > 0 ? ` (${reds} blocking, ${yellows} to review)` : ""}`,
    "",
    `\`${r.branch}\` vs \`${r.base}\` (merge base \`${short(r.mergeBase)}\`) · ${r.commits.length} commit(s) · ${r.files.length} file(s) · +${added} −${removed}`,
    "",
  ];

  if (r.risks.length + problems.length > 0) {
    out.push("## Needs attention", "");
    for (const p of [...problems].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1))) {
      out.push(`- ${ICON[p.level]} ${p.text}${p.file ? ` (${link(p.file, p.line)})` : ""}`);
    }
    for (const risk of [...r.risks].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1))) {
      const files = risk.files.slice(0, 8).map((f) => link(f)).join(", ") + (risk.files.length > 8 ? ` +${risk.files.length - 8} more` : "");
      out.push(`- ${ICON[risk.level]} **${risk.title}**: ${files}. ${risk.why}`);
    }
    out.push("");
  }

  out.push("## What changed in the project", "");
  const d = r.diff;
  if (isEmptyDiff(d)) {
    out.push("No changes to apps, models, URLs or app dependencies.", "");
  } else {
    if (d.apps.added.length + d.apps.removed.length > 0) {
      out.push("**Apps**", "");
      d.apps.added.forEach((a) => out.push(`- ➕ ${link(a)}`));
      d.apps.removed.forEach((a) => out.push(`- ➖ ${link(a)}`));
      out.push("");
    }
    if (d.models.length > 0) {
      out.push("**Models**", "", "| App | Model | Change |", "| --- | --- | --- |");
      for (const m of d.models) {
        let change: string;
        if (m.kind === "added") {
          change = `➕ new: ${m.fields.map((f) => `${f.name} (${field(f.to!)})`).join(", ") || "no fields"}`;
        } else if (m.kind === "removed") {
          change = `➖ removed (${m.fields.length} field(s))`;
        } else {
          change = m.fields
            .map((f) => (!f.from ? `➕ ${f.name} (${field(f.to!)})` : !f.to ? `➖ ${f.name} (${field(f.from)})` : `✏️ ${f.name}: ${field(f.from)} → ${field(f.to)}`))
            .join("<br>");
        }
        out.push(`| ${leaf(m.app)} | ${m.model} | ${esc(change)} |`);
      }
      out.push("");
    }
    const urlLines: string[] = [];
    d.rootIncludes.added.forEach((u) => urlLines.push(`- ➕ \`/${u.replace(" -> ", "\` → \`")}\``));
    d.rootIncludes.removed.forEach((u) => urlLines.push(`- ➖ \`/${u.replace(" -> ", "\` → \`")}\``));
    for (const [app, delta] of Object.entries(d.appUrls)) {
      const fmt = (k: string): string => {
        const [route, name] = k.split("|");
        return `\`${route || "(empty)"}\`${name ? ` (${name})` : ""}`;
      };
      delta.added.forEach((k) => urlLines.push(`- ➕ ${leaf(app)}: ${fmt(k)}`));
      delta.removed.forEach((k) => urlLines.push(`- ➖ ${leaf(app)}: ${fmt(k)}`));
    }
    if (urlLines.length > 0) {
      out.push("**URLs**", "", ...urlLines, "");
    }
    if (d.deps.added.length + d.deps.removed.length > 0) {
      out.push("**App dependencies**", "");
      const fmt = (e: string): string => e.split(" -> ").map(leaf).join(" → ");
      d.deps.added.forEach((e) => out.push(`- ➕ ${fmt(e)}`));
      d.deps.removed.forEach((e) => out.push(`- ➖ ${fmt(e)}`));
      out.push("");
    }
  }
  const migrations = r.files.filter((f) => f.status === "added" && /(^|\/)migrations\/(?!__init__\.py$)[^/]+\.py$/.test(f.path));
  if (migrations.length > 0) {
    out.push("**New migrations**", "", ...migrations.map((f) => `- ${link(f.path)}`), "");
  }

  if (r.tools.length > 0) {
    out.push("## Guardrails", "", "| Check | Result |", "| --- | --- |");
    for (const t of r.tools) {
      out.push(`| ${t.name} | ${TOOL_ICON[t.state]} ${esc(t.summary)} |`);
    }
    out.push("");
  }

  out.push(`<details><summary>Files (${r.files.length})</summary>`, "", "| File | Status | +/− |", "| --- | --- | --- |");
  for (const f of r.files) {
    const lines = f.added === undefined ? "binary" : `+${f.added} −${f.removed ?? 0}`;
    out.push(`| ${link(f.path)} | ${f.status} | ${lines} |`);
  }
  out.push("", "</details>", "");
  if (r.commits.length > 0) {
    out.push(`<details><summary>Commits (${r.commits.length})</summary>`, "", ...r.commits.map((c) => `- \`${c.sha}\` ${c.subject}`), "", "</details>", "");
  }
  out.push("<sub>Generated by Agent Change Report from static analysis; it never runs project code.</sub>");
  return out.join("\n") + "\n";
}
