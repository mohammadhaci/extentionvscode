import type {
  AnalysisWarning,
  GraphEdge,
  GraphNode,
  ProjectMap
} from "../shared/graphTypes";
import type { DiscoveredApp } from "./appDiscovery";
import type { ModelInfo } from "./parseModels";
import type { ViewInfo } from "./parseViews";
import { normalizeViewRef, type UrlPattern } from "./parseUrls";
import { targetToModelName } from "./pythonHeuristics";

export interface MapInputs {
  workspaceName: string;
  apps: DiscoveredApp[];
  /** workspace-relative file -> parsed models */
  modelsByFile: Map<string, ModelInfo[]>;
  viewsByFile: Map<string, ViewInfo[]>;
  urlsByFile: Map<string, UrlPattern[]>;
  rootUrlsFile?: string;
  warnings: AnalysisWarning[];
}

let edgeSeq = 0;
function edge(from: string, to: string, type: GraphEdge["type"], extra?: Partial<GraphEdge>): GraphEdge {
  edgeSeq += 1;
  return { id: `e${edgeSeq}`, from, to, type, ...extra };
}

function appOfFile(file: string, apps: DiscoveredApp[]): DiscoveredApp | undefined {
  const norm = file.replace(/\\/g, "/");
  // Longest dir prefix wins
  let best: DiscoveredApp | undefined;
  for (const a of apps) {
    if (a.dir === "" ? true : norm === a.dir || norm.startsWith(a.dir + "/")) {
      if (!best || a.dir.length > best.dir.length) {
        best = a;
      }
    }
  }
  return best;
}

/**
 * Split a view/model identifier into lowercase tokens on case, digit and
 * separator boundaries: "PostListView" -> ["post","list","view"],
 * "post_detail" -> ["post","detail"], "post2detail" -> ["post","2","detail"].
 */
export function splitNameTokens(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Token/boundary fallback for view -> model linking, used only when a view
 * has no explicit model reference. A model matches when its lowercased name
 * equals a single view-name token or a run of adjacent tokens, so
 * "PostListView"/"post_detail" still match "post" (and "BlogPostListView"
 * matches "blogpost") while "UserPostsView"/"PosterView" no longer
 * spuriously link to "post".
 */
export function viewNameMentionsModel(viewName: string, modelKeyLower: string): boolean {
  const key = modelKeyLower.toLowerCase();
  if (key.length < 3) {
    return false;
  }
  const tokens = splitNameTokens(viewName);
  for (let i = 0; i < tokens.length; i++) {
    let run = "";
    for (let j = i; j < tokens.length; j++) {
      run += tokens[j];
      if (run === key) {
        return true;
      }
      if (run.length >= key.length) {
        break;
      }
    }
  }
  return false;
}

/**
 * Build the visual graph from parsed analyzer outputs. Pure + testable.
 * Resolution strategy (explicit about uncertainty):
 *  - url -> view: match normalized view ref against discovered view names
 *    (same app first, then any app). Unmatched refs become placeholder
 *    view nodes flagged uncertain (external/admin views).
 *  - view -> model: match explicit model refs by class name (same app first).
 *    Unmatched names are kept as detail text + warning, not phantom nodes.
 *    Additionally, a same-name heuristic (PostListView ~ Post) adds an
 *    uncertain edge when no explicit model was found.
 *  - model -> model: resolve relation targets by class name; "self" links to
 *    the same model. Unresolvable targets produce uncertain edges to a
 *    synthetic label so the relation is still visible.
 */
export function buildProjectMap(inputs: MapInputs): ProjectMap {
  edgeSeq = 0;
  const { workspaceName, apps, modelsByFile, viewsByFile, urlsByFile } = inputs;
  const warnings: AnalysisWarning[] = [...inputs.warnings];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };

  // Index models + views by name
  const modelsByName = new Map<string, { app: string; info: ModelInfo; file: string }[]>();
  const modelNodeId = new Map<ModelInfo, string>();
  for (const [file, models] of modelsByFile) {
    const app = appOfFile(file, apps);
    for (const m of models) {
      const id = `model:${app?.name ?? "?"}:${m.name}`;
      const node: GraphNode = {
        id,
        kind: "model",
        label: m.name,
        subtitle: `${m.fields.length} field${m.fields.length === 1 ? "" : "s"}`,
        file,
        line: m.line,
        app: app?.name,
        detail: [
          `Model ${m.name} (${m.base})`,
          ...m.fields.map((f) =>
            f.relation
              ? `${f.name}: ${f.relation} → ${f.relationTarget ?? "?"}`
              : `${f.name}: ${f.fieldType}`
          )
        ]
      };
      addNode(node);
      modelNodeId.set(m, node.id);
      const key = m.name.toLowerCase();
      if (!modelsByName.has(key)) {
        modelsByName.set(key, []);
      }
      modelsByName.get(key)!.push({ app: app?.name ?? "", info: m, file });
    }
  }

  const viewsByName = new Map<string, { app: string; info: ViewInfo; file: string; nodeId: string }[]>();
  const viewNodeByObject = new Map<ViewInfo, string>();

  // App nodes first
  for (const a of apps) {
    addNode({
      id: `app:${a.name}`,
      kind: "app",
      label: a.name,
      subtitle: a.dir || "(project root)",
      file: a.files.models ?? a.files.views ?? a.files.urls ?? a.files.apps,
      app: a.name,
      uncertain: a.confidence === "low",
      detail: [
        `Django app candidate (${a.confidence} confidence)`,
        `Directory: ${a.dir || "."}`,
        `Why: ${a.reason}`
      ]
    });
  }

  // View nodes
  for (const [file, views] of viewsByFile) {
    const app = appOfFile(file, apps);
    for (const v of views) {
      const id = `view:${app?.name ?? "?"}:${v.name}`;
      const node: GraphNode = {
        id,
        kind: "view",
        label: v.name,
        subtitle: v.kind === "class" ? v.base : "function view",
        file,
        line: v.line,
        app: app?.name,
        detail: [
          v.kind === "class" ? `Class-based view (${v.base})` : "Function-based view",
          ...(v.models.length
            ? [`Models: ${v.models.map((m) => m.name).join(", ")}`]
            : ["Models: none detected (heuristic may miss dynamic queries)"]),
          ...(v.templates.length
            ? [`Templates: ${v.templates.map((t) => t.name).join(", ")}`]
            : [])
        ]
      };
      addNode(node);
      viewNodeByObject.set(v, id);
      const key = v.name.toLowerCase();
      if (!viewsByName.has(key)) {
        viewsByName.set(key, []);
      }
      viewsByName.get(key)!.push({ app: app?.name ?? "", info: v, file, nodeId: id });
      if (app) {
        edges.push(edge(`app:${app.name}`, id, "contains"));
      }
    }
  }

  // Model containment edges (after views so ids exist)
  for (const [file, models] of modelsByFile) {
    const app = appOfFile(file, apps);
    if (!app) {
      continue;
    }
    for (const m of models) {
      edges.push(edge(`app:${app.name}`, modelNodeId.get(m)!, "contains"));
    }
  }

  // Template nodes (dedup by template name)
  const templateNodeId = new Map<string, string>();
  const ensureTemplate = (name: string): string => {
    if (!templateNodeId.has(name)) {
      const id = `template:${name}`;
      templateNodeId.set(name, id);
      addNode({ id, kind: "template", label: name.split("/").pop() ?? name, subtitle: name });
    }
    return templateNodeId.get(name)!;
  };

  // view -> model + view -> template edges
  for (const [, views] of viewsByFile) {
    for (const v of views) {
      const vid = viewNodeByObject.get(v)!;
      for (const t of v.templates) {
        const tid = ensureTemplate(t.name);
        edges.push(edge(vid, tid, "renders", { label: t.name.split("/").pop() }));
      }
      let linked = 0;
      for (const ref of v.models) {
        const candidates = modelsByName.get(ref.name.toLowerCase()) ?? [];
        if (candidates.length === 0) {
          warnings.push({
            message: `View "${v.name}" references unknown model "${ref.name}" (heuristic; may be external or mis-parsed).`,
            file: undefined
          });
          continue;
        }
        // Prefer same app
        const viewApp = nodes.find((n) => n.id === vid)?.app ?? "";
        const same = candidates.find((c) => c.app === viewApp) ?? candidates[0];
        const mid = modelNodeId.get(same.info)!;
        edges.push(
          edge(vid, mid, "uses", {
            uncertain: !ref.certain || candidates.length > 1,
            label: candidates.length > 1 && same !== candidates[0] ? "heuristic" : undefined
          })
        );
        linked++;
      }
      if (linked === 0) {
        // Same-name heuristic: PostListView / post_detail -> Post
        const viewApp = nodes.find((n) => n.id === vid)?.app ?? "";
        for (const [key, cands] of modelsByName) {
          if (viewNameMentionsModel(v.name, key)) {
            const same = cands.find((c) => c.app === viewApp) ?? cands[0];
            edges.push(
              edge(vid, modelNodeId.get(same.info)!, "uses", {
                uncertain: true,
                label: "name heuristic"
              })
            );
            linked++;
            break;
          }
        }
      }
    }
  }

  // URL nodes + url -> view edges
  const urlNodeIds: string[] = [];
  for (const [file, patterns] of urlsByFile) {
    const app = appOfFile(file, apps);
    const isRoot = file === inputs.rootUrlsFile;
    for (const p of patterns) {
      const owner = isRoot ? "root" : app?.name ?? "?";
      const slug = (p.name || normalizeViewRef(p.viewRef) || p.route || "unnamed")
        .replace(/[^A-Za-z0-9_:-]+/g, "-")
        .slice(0, 40);
      const id = `url:${owner}:${slug}:${p.line}`;
      addNode({
        id,
        kind: "url",
        label: p.route === "" ? "/" : p.route,
        subtitle: p.isInclude
          ? `include → ${p.includeModule}`
          : p.name
            ? `→ ${normalizeViewRef(p.viewRef)} · name="${p.name}"`
            : `→ ${normalizeViewRef(p.viewRef)}`,
        file,
        line: p.line,
        app: app?.name,
        uncertain: p.isInclude ? false : undefined,
        detail: p.isInclude
          ? [`Includes URLconf ${p.includeModule}`, `Route prefix: /${p.route}`]
          : [`Route: /${p.route}`, `View ref: ${p.viewRef}`, ...(p.name ? [`Name: ${p.name}`] : [])]
      });
      urlNodeIds.push(id);
      if (app && !isRoot) {
        edges.push(edge(`app:${app.name}`, id, "contains"));
      } else if (isRoot && apps.length > 0) {
        // Root urls belong to no single app; link to apps it includes (below).
      }

      if (p.isInclude) {
        // Link include -> target app when the module path matches an app dir
        const mod = (p.includeModule ?? "").split(".")[0];
        const target = apps.find((a) => a.name === mod);
        if (target) {
          const targetUrls = urlsByFile.get(target.files.urls ?? "");
          if (targetUrls) {
            // edge from include node to app node (navigation aid)
            edges.push(edge(id, `app:${target.name}`, "routes", { label: "include" }));
          } else {
            edges.push(edge(id, `app:${target.name}`, "routes", { label: "include", uncertain: true }));
          }
        } else {
          warnings.push({
            message: `include("${p.includeModule}") does not match a discovered app; link may be missing.`,
            file,
            line: p.line
          });
        }
        continue;
      }

      const refName = normalizeViewRef(p.viewRef).toLowerCase();
      if (!refName) {
        warnings.push({ message: `Could not parse view reference at ${file}:${p.line}.`, file, line: p.line });
        continue;
      }
      const candidates = viewsByName.get(refName) ?? [];
      if (candidates.length === 0) {
        // Placeholder uncertain node (admin views, DRF routers, auth views, ...)
        const pid = `view:?:${p.viewRef.replace(/[^A-Za-z0-9_]/g, "_")}:${p.line}`;
        addNode({
          id: pid,
          kind: "view",
          label: normalizeViewRef(p.viewRef) || p.viewRef,
          subtitle: "unresolved (external?)",
          file,
          line: p.line,
          uncertain: true,
          detail: [
            `Referenced as "${p.viewRef}" but no matching view was found in scanned views.py files.`,
            "Common causes: django.contrib.admin, django.contrib.auth views, DRF routers, or string references."
          ]
        });
        edges.push(edge(id, pid, "routes", { uncertain: true }));
        continue;
      }
      const urlApp = app?.name ?? "";
      const same = candidates.find((c) => c.app === urlApp) ?? candidates[0];
      edges.push(
        edge(id, same.nodeId, "routes", {
          uncertain: candidates.length > 1 && same !== candidates[0]
        })
      );
    }
  }

  // Model relation edges
  let relations = 0;
  for (const [, models] of modelsByFile) {
    for (const m of models) {
      const fromId = modelNodeId.get(m)!;
      const fromApp = nodes.find((n) => n.id === fromId)?.app ?? "";
      for (const f of m.fields) {
        if (!f.relation) {
          continue;
        }
        const edgeType =
          f.relation === "ForeignKey" ? "rel-fk" : f.relation === "OneToOneField" ? "rel-o2o" : "rel-m2m";
        if (f.relationTarget === "self") {
          edges.push(edge(fromId, fromId, edgeType, { label: f.name }));
          relations++;
          continue;
        }
        const targetName = targetToModelName(f.relationTarget);
        const candidates = targetName ? modelsByName.get(targetName.toLowerCase()) ?? [] : [];
        if (candidates.length > 0) {
          const same = candidates.find((c) => c.app === fromApp) ?? candidates[0];
          edges.push(
            edge(fromId, modelNodeId.get(same.info)!, edgeType, {
              label: f.name,
              uncertain: candidates.length > 1
            })
          );
          relations++;
        } else {
          // Keep the relation visible as an uncertain self-loop label edge to a synthetic target?
          // Better: warn + record in node detail only (avoid phantom model nodes).
          warnings.push({
            message: `Model "${m.name}.${f.name}" targets unknown model "${f.relationTarget ?? "?"}".`,
            file: undefined
          });
          relations++;
        }
      }
    }
  }

  const stats = {
    apps: apps.length,
    urls: nodes.filter((n) => n.kind === "url").length,
    views: nodes.filter((n) => n.kind === "view").length,
    models: nodes.filter((n) => n.kind === "model").length,
    templates: nodes.filter((n) => n.kind === "template").length,
    relations
  };

  const looksEmpty = apps.length === 0 && nodes.length === 0;
  return {
    nodes,
    edges,
    warnings: dedupeWarnings(warnings),
    stats,
    workspaceName,
    isEmpty: looksEmpty,
    emptyReason: looksEmpty
      ? "No Django apps detected. Open a folder containing a Django project (manage.py / settings.py with INSTALLED_APPS, or app folders with models.py / views.py / urls.py)."
      : undefined,
    generatedAt: new Date().toISOString()
  };
}

function dedupeWarnings(w: AnalysisWarning[]): AnalysisWarning[] {
  const seen = new Set<string>();
  const out: AnalysisWarning[] = [];
  for (const x of w) {
    const k = `${x.message}|${x.file ?? ""}|${x.line ?? ""}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out.slice(0, 50);
}
