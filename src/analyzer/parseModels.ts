import { toLines, TOP_CLASS_RE, extractRelationTarget } from "./pythonHeuristics";
import type { RelationKind } from "../shared/graphTypes";

export interface ModelField {
  name: string;
  fieldType: string;
  line: number;
  relation?: RelationKind;
  /** Raw target as written, e.g. "blog.Author", "Author", "self" */
  relationTarget?: string;
}

export interface ModelInfo {
  name: string;
  base: string;
  line: number;
  fields: ModelField[];
  isModel: boolean;
}

const FIELD_RE = /^\s+(\w+)\s*=\s*models\.(\w+)\s*\(/;
const RELATION_TYPES: Record<string, RelationKind> = {
  ForeignKey: "ForeignKey",
  OneToOneField: "OneToOneField",
  ManyToManyField: "ManyToManyField"
};

/**
 * Heuristically parse models.py content. Never executes code.
 * A class counts as a model when its base list mentions "Model".
 */
export function parseModels(text: string): ModelInfo[] {
  const lines = toLines(text);
  const out: ModelInfo[] = [];
  let current: ModelInfo | null = null;

  for (const { no, text: raw } of lines) {
    const m = raw.match(TOP_CLASS_RE);
    if (m && !raw.startsWith(" ") && !raw.startsWith("\t")) {
      if (current) {
        out.push(current);
      }
      const base = (m[2] ?? "").trim();
      current = {
        name: m[1],
        base,
        line: no,
        fields: [],
        isModel: /Model\b/.test(base)
      };
      continue;
    }
    if (current) {
      const f = raw.match(FIELD_RE);
      if (f) {
        const [, name, fieldType] = f;
        const afterParen = raw.slice(raw.indexOf(fieldType) + fieldType.length + 1);
        const relation = RELATION_TYPES[fieldType];
        current.fields.push({
          name,
          fieldType,
          line: no,
          relation,
          relationTarget: relation ? extractRelationTarget(afterParen) : undefined
        });
      }
    }
  }
  if (current) {
    out.push(current);
  }
  return out.filter((c) => c.isModel);
}
