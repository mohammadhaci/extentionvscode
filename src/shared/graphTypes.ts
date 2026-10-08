/**
 * Shared graph types for the Django Visual Map extension.
 *
 * These types describe the analyzed project as a graph of nodes and edges.
 * They are produced by the extension host analyzer (pure functions, no Django
 * execution) and consumed by the webview UI via typed message payloads.
 */

export type NodeKind = "app" | "url" | "view" | "model" | "template";

export type RelationKind =
  | "ForeignKey"
  | "OneToOneField"
  | "ManyToManyField";

export type EdgeType =
  | "contains" // app -> url/view/model
  | "routes" // url -> view
  | "uses" // view -> model
  | "renders" // view -> template
  | "rel-fk" // model -> model (ForeignKey)
  | "rel-o2o" // model -> model (OneToOneField)
  | "rel-m2m"; // model -> model (ManyToManyField)

export interface GraphNode {
  /** Stable unique id, e.g. "app:blog", "model:blog:Post", "view:blog:post_list" */
  id: string;
  kind: NodeKind;
  /** Short human-readable label */
  label: string;
  /** Sub-label shown under the main label (e.g. route path, base class) */
  subtitle?: string;
  /** Workspace-relative file path, e.g. "blog/models.py" */
  file?: string;
  /** 1-based source line, when known */
  line?: number;
  /** App this node belongs to (for color grouping / filtering) */
  app?: string;
  /** True when this node was inferred heuristically and may be wrong */
  uncertain?: boolean;
  /** Extra detail lines for the details panel */
  detail?: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  /** Optional short label drawn on the edge (e.g. relation field name) */
  label?: string;
  /** True when this relationship is a heuristic guess */
  uncertain?: boolean;
}

export interface AnalysisWarning {
  message: string;
  file?: string;
  line?: number;
}

export interface MapStats {
  apps: number;
  urls: number;
  views: number;
  models: number;
  templates: number;
  relations: number;
}

export interface ProjectMap {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: AnalysisWarning[];
  stats: MapStats;
  /** Workspace folder name the map was built from */
  workspaceName: string;
  /** True when the folder does not look like a Django project */
  isEmpty: boolean;
  /** Human-readable explanation for empty / error states */
  emptyReason?: string;
  generatedAt: string;
}

export function emptyMap(
  workspaceName: string,
  emptyReason: string
): ProjectMap {
  return {
    nodes: [],
    edges: [],
    warnings: [],
    stats: { apps: 0, urls: 0, views: 0, models: 0, templates: 0, relations: 0 },
    workspaceName,
    isEmpty: true,
    emptyReason,
    generatedAt: new Date().toISOString()
  };
}
