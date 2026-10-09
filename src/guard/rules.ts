// Pure: turns parsed migrations (+ which ones are new/changed) into findings.
import { createModelFields, fieldInfo, Operation, parseMigration, ParsedMigration, stringArg } from "./parse";

export type Severity = "error" | "warning" | "info";
export type ChangeStatus = "added" | "modified" | "deleted";

export interface MigrationFile {
  /** Project-relative path, e.g. "apps/orders/migrations/0002_x.py". */
  path: string;
  /** App label (folder name holding migrations/). */
  app: string;
  /** Migration name (file name without .py). */
  name: string;
  text: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  hint: string;
  /** Reason from a `# migrations-guard: allow <rule>: reason` comment. */
  allowedReason?: string;
}

export const RULES: Record<string, { severity: Severity; hint: string }> = {
  "remove-field": {
    severity: "error",
    hint: "Drops the column and its data, and breaks servers still running the old code. Stop using the field in one release, drop it in a later one.",
  },
  "delete-model": {
    severity: "error",
    hint: "Drops the table and its data. Stop using the model in one release, delete it in a later one, and back up first.",
  },
  "add-field-not-null": {
    severity: "error",
    hint: "Fails on tables that already have rows. Add null=True, or a default (makemigrations asks for one), or backfill in steps.",
  },
  "edited-migration": {
    severity: "error",
    hint: "Databases that already applied it will never see the change. Revert the edit and create a new migration instead.",
  },
  "deleted-migration": {
    severity: "error",
    hint: "Other migrations and already-migrated databases still reference it. Restore the file; squash instead of deleting.",
  },
  "conflicting-leaves": {
    severity: "error",
    hint: "Two branches added migrations to the same app. Run `python manage.py makemigrations --merge` (or renumber the unmerged one).",
  },
  "missing-dependency": {
    severity: "error",
    hint: "Points at a migration that does not exist in this app. Fix the dependency name.",
  },
  "direct-model-import": {
    severity: "error",
    hint: "Migrations must use historical models: `Model = apps.get_model(\"app\", \"Model\")` inside the RunPython function.",
  },
  "rename-field": {
    severity: "warning",
    hint: "Servers still running the old code break during a rolling deploy. Prefer add-new + copy + remove-old across releases, or deploy with downtime.",
  },
  "rename-model": {
    severity: "warning",
    hint: "Renames the table; servers still running the old code break during a rolling deploy.",
  },
  "alter-field-not-null": {
    severity: "warning",
    hint: "Existing NULL rows make this fail. Backfill them in a data migration first, or give the field a default.",
  },
  "run-python-irreversible": {
    severity: "warning",
    hint: "Without reverse_code the migration cannot be rolled back. Pass reverse_code (migrations.RunPython.noop if nothing to undo).",
  },
  "run-sql-irreversible": {
    severity: "warning",
    hint: "Without reverse_sql the migration cannot be rolled back. Pass reverse_sql (migrations.RunSQL.noop if nothing to undo).",
  },
  "blocking-index": {
    severity: "info",
    hint: "Locks writes on large PostgreSQL tables. Consider AddIndexConcurrently / AddConstraintNotValid in a migration with atomic = False.",
  },
};

const finding = (rule: string, file: string, line: number, message: string): Finding => ({
  rule,
  severity: RULES[rule].severity,
  file,
  line,
  message,
  hint: RULES[rule].hint,
});

const lower = (s: string | undefined): string | undefined => s?.toLowerCase();

/** Per app: field nullability as seen so far, keyed "model.field". */
type FieldState = Map<string, boolean>;

function applyToState(state: FieldState, op: Operation): void {
  const model = lower(stringArg(op, "model_name", 0));
  const name = stringArg(op, "name", 1);
  switch (op.kind) {
    case "CreateModel": {
      const m = lower(stringArg(op, "name", 0));
      for (const f of createModelFields(op)) {
        const info = fieldInfo(f.field);
        if (m && info) {
          state.set(`${m}.${f.name}`, info.nullable);
        }
      }
      break;
    }
    case "AddField":
    case "AlterField": {
      const info = fieldInfo(op.kwargs.get("field") ?? op.args[2]);
      if (model && name && info) {
        state.set(`${model}.${name}`, info.nullable);
      }
      break;
    }
    case "RemoveField":
      if (model && name) {
        state.delete(`${model}.${name}`);
      }
      break;
    case "RenameField": {
      const from = stringArg(op, "old_name", 1);
      const to = stringArg(op, "new_name", 2);
      if (model && from && to && state.has(`${model}.${from}`)) {
        state.set(`${model}.${to}`, state.get(`${model}.${from}`)!);
        state.delete(`${model}.${from}`);
      }
      break;
    }
    case "RenameModel": {
      const from = lower(stringArg(op, "old_name", 0));
      const to = lower(stringArg(op, "new_name", 1));
      for (const [k, v] of [...state]) {
        if (from && to && k.startsWith(`${from}.`)) {
          state.set(`${to}.${k.slice(from.length + 1)}`, v);
          state.delete(k);
        }
      }
      break;
    }
  }
}

function operationFindings(file: MigrationFile, parsed: ParsedMigration, state: FieldState): Finding[] {
  const out: Finding[] = [];
  for (const op of parsed.operations) {
    const model = stringArg(op, "model_name", 0) ?? "?";
    const name = stringArg(op, "name", 1) ?? "?";
    switch (op.kind) {
      case "RemoveField":
        out.push(finding("remove-field", file.path, op.line, `RemoveField drops ${model}.${name}.`));
        break;
      case "DeleteModel":
        out.push(finding("delete-model", file.path, op.line, `DeleteModel drops ${stringArg(op, "name", 0) ?? "?"}.`));
        break;
      case "AddField": {
        const info = fieldInfo(op.kwargs.get("field") ?? op.args[2]);
        if (info && !info.nullable && !info.hasDefault && info.type !== "ManyToManyField") {
          out.push(finding("add-field-not-null", file.path, op.line, `AddField ${model}.${name} is NOT NULL without a default.`));
        }
        break;
      }
      case "AlterField": {
        const info = fieldInfo(op.kwargs.get("field") ?? op.args[2]);
        const before = state.get(`${model.toLowerCase()}.${name}`);
        if (info && before === true && !info.nullable && !info.hasDefault && info.type !== "ManyToManyField") {
          out.push(finding("alter-field-not-null", file.path, op.line, `AlterField makes ${model}.${name} NOT NULL without a default.`));
        }
        break;
      }
      case "RenameField":
        out.push(finding("rename-field", file.path, op.line, `RenameField ${model}.${stringArg(op, "old_name", 1) ?? "?"} -> ${stringArg(op, "new_name", 2) ?? "?"}.`));
        break;
      case "RenameModel":
        out.push(finding("rename-model", file.path, op.line, `RenameModel ${stringArg(op, "old_name", 0) ?? "?"} -> ${stringArg(op, "new_name", 1) ?? "?"}.`));
        break;
      case "RunPython":
        if (!op.kwargs.has("reverse_code") && op.args.length < 2) {
          out.push(finding("run-python-irreversible", file.path, op.line, "RunPython has no reverse_code."));
        }
        break;
      case "RunSQL":
        if (!op.kwargs.has("reverse_sql") && op.args.length < 2) {
          out.push(finding("run-sql-irreversible", file.path, op.line, "RunSQL has no reverse_sql."));
        }
        break;
      case "AddIndex":
      case "AddConstraint":
      case "AlterUniqueTogether":
      case "AlterIndexTogether":
        out.push(finding("blocking-index", file.path, op.line, `${op.kind} on ${model} builds an index while holding a lock.`));
        break;
    }
    applyToState(state, op);
  }
  for (const imp of parsed.modelImports) {
    out.push(finding("direct-model-import", file.path, imp.line, `Imports ${imp.module} directly.`));
  }
  return out;
}

/** Applies `# migrations-guard: allow <rule>: reason` comments of each file. */
function applyAllows(findings: Finding[], allowsByFile: Map<string, Map<string, string>>): Finding[] {
  return findings.map((f) => {
    const reason = allowsByFile.get(f.file)?.get(f.rule);
    if (reason === undefined) {
      return f;
    }
    if (!reason) {
      return { ...f, message: `${f.message} (allow comment found, but it needs a reason)` };
    }
    return { ...f, allowedReason: reason };
  });
}

export interface AnalyzeInput {
  migrations: readonly MigrationFile[];
  /** Changes vs the base; undefined checks every migration's operations. */
  changes?: ReadonlyMap<string, ChangeStatus>;
}

export function analyze(input: AnalyzeInput): Finding[] {
  const parsedByPath = new Map(input.migrations.map((m) => [m.path, parseMigration(m.text)]));
  const inScope = (m: MigrationFile): boolean => !input.changes || input.changes.has(m.path);
  const findings: Finding[] = [];

  const byApp = new Map<string, MigrationFile[]>();
  for (const m of input.migrations) {
    byApp.set(m.app, [...(byApp.get(m.app) ?? []), m]);
  }

  for (const [app, files] of byApp) {
    files.sort((a, b) => a.name.localeCompare(b.name));
    const state: FieldState = new Map();
    for (const m of files) {
      const parsed = parsedByPath.get(m.path)!;
      if (inScope(m)) {
        findings.push(...operationFindings(m, parsed, state));
      } else {
        parsed.operations.forEach((op) => applyToState(state, op));
      }
    }

    // Graph: a squashed migration stands in for the ones it replaces.
    const names = new Set(files.map((f) => f.name));
    const replacedBy = new Map<string, string>();
    for (const m of files) {
      for (const r of parsedByPath.get(m.path)!.replaces) {
        if (r.app === app) {
          replacedBy.set(r.name, m.name);
        }
      }
    }
    const resolve = (n: string): string => replacedBy.get(n) ?? n;
    const dependedOn = new Set<string>();
    for (const m of files) {
      const parsed = parsedByPath.get(m.path)!;
      for (const d of parsed.dependencies) {
        if (d.app !== app || d.name === "__first__" || d.name === "__latest__") {
          continue;
        }
        if (!names.has(d.name) && !replacedBy.has(d.name)) {
          const line = m.text.split(/\r?\n/).findIndex((l) => l.includes(d.name)) + 1;
          findings.push(finding("missing-dependency", m.path, line || 1, `Depends on ${app}.${d.name}, which does not exist.`));
        }
        dependedOn.add(resolve(d.name));
      }
    }
    const leaves = files.filter((f) => !replacedBy.has(f.name) && !dependedOn.has(f.name));
    if (leaves.length > 1) {
      for (const leaf of leaves) {
        const others = leaves.filter((l) => l !== leaf).map((l) => l.name).join(", ");
        findings.push(finding("conflicting-leaves", leaf.path, 1, `${app} has ${leaves.length} latest migrations: ${leaf.name} conflicts with ${others}.`));
      }
    }
  }

  for (const [path, status] of input.changes ?? []) {
    if (status === "modified") {
      findings.push(finding("edited-migration", path, 1, "An existing migration was edited."));
    } else if (status === "deleted") {
      findings.push(finding("deleted-migration", path, 1, "An existing migration was deleted."));
    }
  }

  const allows = new Map([...parsedByPath].map(([p, parsed]) => [p, parsed.allows]));
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return applyAllows(findings, allows).sort(
    (a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line
  );
}
