import { Finding } from "./rules";

const ICON = { error: "✖", warning: "⚠", info: "ℹ" } as const;

export function summarize(findings: readonly Finding[]): { errors: number; warnings: number; infos: number; allowed: number } {
  const active = findings.filter((f) => !f.allowedReason);
  return {
    errors: active.filter((f) => f.severity === "error").length,
    warnings: active.filter((f) => f.severity === "warning").length,
    infos: active.filter((f) => f.severity === "info").length,
    allowed: findings.length - active.length,
  };
}

export function formatText(findings: readonly Finding[], scope: string, checked: number): string {
  const out: string[] = [`Migrations Guard: ${scope}, ${checked} migration file(s) in scope.`];
  const active = findings.filter((f) => !f.allowedReason);
  for (const f of active) {
    out.push("", `${ICON[f.severity]} ${f.severity} [${f.rule}] ${f.file}:${f.line}`, `  ${f.message}`, `  → ${f.hint}`);
  }
  const allowed = findings.filter((f) => f.allowedReason);
  if (allowed.length > 0) {
    out.push("", "Allowed by comment:");
    for (const f of allowed) {
      out.push(`  [${f.rule}] ${f.file}:${f.line}: ${f.allowedReason}`);
    }
  }
  const s = summarize(findings);
  out.push("", `${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} note(s)${s.allowed ? `, ${s.allowed} allowed` : ""}.`);
  return out.join("\n");
}
