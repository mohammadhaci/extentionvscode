import { toLines, TOP_CLASS_RE, TOP_DEF_RE, unquote } from "./pythonHeuristics";

export interface TemplateRef {
  name: string;
  line: number;
}

export interface ModelRef {
  name: string;
  line: number;
  /** false only for explicit `model = X` / `X.objects` / `get_object_or_404(X` */
  certain: boolean;
}

export interface ViewInfo {
  name: string;
  kind: "function" | "class";
  base: string;
  line: number;
  templates: TemplateRef[];
  models: ModelRef[];
}

const CBV_BASE_RE =
  /(View|ViewSet|TemplateView|ListView|DetailView|CreateView|UpdateView|DeleteView|FormView|APIView|GenericAPIView|ModelViewSet|ReadOnlyModelViewSet)/;
const TEMPLATE_STR_RE = /["']([^"']*\.html?[^"']*)["']/g;
const TEMPLATE_NAME_RE = /template_name\s*=\s*[r]?["']([^"']+)["']/;
const MODEL_EQ_RE = /\bmodel\s*=\s*(\w+)/;
const QUERYSET_RE = /\bqueryset\s*=\s*(\w+)\s*\.\s*objects/;
const OBJECTS_RE = /(\w+)\s*\.\s*objects\b/g;
const GET_OBJECT_RE = /get_object_or_404\s*\(\s*(\w+)/g;
const RENDER_RE = /\brender\s*\(/;
const IMPORT_RE = /^from\s+([.\w]+)\s+import\s+(.+)$/;

function collectTemplates(body: string[], baseLine: number): TemplateRef[] {
  const out: TemplateRef[] = [];
  const seen = new Set<string>();
  body.forEach((text, i) => {
    TEMPLATE_STR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Only treat .html strings as templates when near a render/template hint
    const hint =
      RENDER_RE.test(text) ||
      text.includes("template_name") ||
      text.includes("TemplateResponse");
    if (!hint) {
      return;
    }
    while ((m = TEMPLATE_STR_RE.exec(text)) !== null) {
      const name = unquote(m[0].trim());
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ name, line: baseLine + i });
      }
    }
  });
  return out;
}

function collectModels(
  body: string[],
  baseLine: number,
  headerLine: number
): ModelRef[] {
  const out: ModelRef[] = [];
  const seen = new Set<string>();
  const push = (name: string, line: number, certain: boolean) => {
    if (!/^[A-Z]\w*$/.test(name)) {
      return;
    }
    if (["request", "self", "True", "False", "None"].includes(name)) {
      return;
    }
    const key = `${name}@${certain}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ name, line, certain });
  };
  body.forEach((text, i) => {
    const line = baseLine + i;
    const me = text.match(MODEL_EQ_RE);
    if (me) {
      push(me[1], line, true);
    }
    const qs = text.match(QUERYSET_RE);
    if (qs) {
      push(qs[1], line, true);
    }
    OBJECTS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OBJECTS_RE.exec(text)) !== null) {
      push(m[1], line, true);
    }
    GET_OBJECT_RE.lastIndex = 0;
    while ((m = GET_OBJECT_RE.exec(text)) !== null) {
      push(m[1], line, true);
    }
  });
  // Keep header line info available for future use; no-op to satisfy lint.
  void headerLine;
  return out;
}

/**
 * Heuristically parse views.py content (function + class-based views).
 * Never executes code. Template/model links are best-effort guesses.
 */
export function parseViews(text: string): ViewInfo[] {
  const lines = toLines(text);
  const out: ViewInfo[] = [];

  interface Block {
    name: string;
    kind: "function" | "class";
    base: string;
    line: number;
    body: string[];
    bodyStart: number;
  }
  let current: Block | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const templates =
      current.kind === "class"
        ? extractClassTemplates(current)
        : collectTemplates(current.body, current.bodyStart);
    const models = collectModels(current.body, current.bodyStart, current.line);
    out.push({
      name: current.name,
      kind: current.kind,
      base: current.base,
      line: current.line,
      templates,
      models
    });
    current = null;
  };

  for (const { no, text: raw } of lines) {
    const isTop = raw !== "" && !raw.startsWith(" ") && !raw.startsWith("\t");
    if (isTop) {
      const cm = raw.match(TOP_CLASS_RE);
      if (cm) {
        flush();
        const base = (cm[2] ?? "").trim();
        if (CBV_BASE_RE.test(base)) {
          current = {
            name: cm[1],
            kind: "class",
            base,
            line: no,
            body: [],
            bodyStart: no + 1
          };
        } else {
          current = null; // non-view class (e.g. forms); ignore
        }
        continue;
      }
      const dm = raw.match(TOP_DEF_RE);
      if (dm) {
        flush();
        const args = (dm[2] ?? "").trim();
        if (/^\s*request\b/.test(args)) {
          current = {
            name: dm[1],
            kind: "function",
            base: "function",
            line: no,
            body: [],
            bodyStart: no + 1
          };
        } else {
          current = null; // helper, not a view
        }
        continue;
      }
      // Other top-level statement (imports etc.): record imports? end block body.
      if (/^(from|import)\b/.test(raw)) {
        const im = raw.match(IMPORT_RE);
        void im;
      }
    }
    if (current) {
      current.body.push(raw);
    }
  }
  flush();
  return out;
}

function extractClassTemplates(block: {
  body: string[];
  bodyStart: number;
}): TemplateRef[] {
  const out: TemplateRef[] = [];
  const seen = new Set<string>();
  block.body.forEach((text, i) => {
    const m = text.match(TEMPLATE_NAME_RE);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ name: m[1], line: block.bodyStart + i });
    }
  });
  // Fallback: render(...) calls inside methods
  for (const t of collectTemplates(block.body, block.bodyStart)) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}
