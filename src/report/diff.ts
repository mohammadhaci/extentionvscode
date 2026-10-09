// Pure: what changed between two project snapshots.
import { FieldSnap, ProjectSnap } from "./snapshot";

export interface FieldDelta {
  name: string;
  from?: FieldSnap;
  to?: FieldSnap;
}

export interface ModelDelta {
  app: string;
  model: string;
  kind: "added" | "removed" | "changed";
  fields: FieldDelta[];
}

export interface ListDelta {
  added: string[];
  removed: string[];
}

export interface StructureDiff {
  apps: ListDelta;
  models: ModelDelta[];
  rootIncludes: ListDelta;
  /** app dir -> "route|name" pattern changes in that app's urls.py */
  appUrls: Record<string, ListDelta>;
  /** "from -> to" app dependency edges */
  deps: ListDelta;
}

function listDelta(before: readonly string[], after: readonly string[]): ListDelta {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((x) => !b.has(x)).sort(), removed: [...b].filter((x) => !a.has(x)).sort() };
}

const sameField = (x: FieldSnap, y: FieldSnap): boolean => x.type === y.type && (x.target ?? "") === (y.target ?? "");

export function diffSnapshots(base: ProjectSnap, head: ProjectSnap): StructureDiff {
  const models: ModelDelta[] = [];
  const appDirs = [...new Set([...Object.keys(base.apps), ...Object.keys(head.apps)])].sort();
  const appUrls: Record<string, ListDelta> = {};
  for (const app of appDirs) {
    const bm = base.apps[app]?.models ?? {};
    const hm = head.apps[app]?.models ?? {};
    for (const model of [...new Set([...Object.keys(bm), ...Object.keys(hm)])].sort()) {
      const before = bm[model];
      const after = hm[model];
      if (!before) {
        models.push({ app, model, kind: "added", fields: Object.entries(after).map(([name, to]) => ({ name, to })) });
      } else if (!after) {
        models.push({ app, model, kind: "removed", fields: Object.entries(before).map(([name, from]) => ({ name, from })) });
      } else {
        const fields: FieldDelta[] = [];
        for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
          const from = before[name];
          const to = after[name];
          if (!from || !to || !sameField(from, to)) {
            fields.push({ name, from, to });
          }
        }
        if (fields.length > 0) {
          models.push({ app, model, kind: "changed", fields });
        }
      }
    }
    const urls = listDelta(base.apps[app]?.urls ?? [], head.apps[app]?.urls ?? []);
    if (urls.added.length + urls.removed.length > 0) {
      appUrls[app] = urls;
    }
  }
  const edges = (s: ProjectSnap): string[] => Object.entries(s.deps).flatMap(([from, tos]) => tos.map((to) => `${from} -> ${to}`));
  return {
    apps: listDelta(Object.keys(base.apps), Object.keys(head.apps)),
    models,
    rootIncludes: listDelta(base.rootIncludes, head.rootIncludes),
    appUrls,
    deps: listDelta(edges(base), edges(head)),
  };
}

export function isEmptyDiff(d: StructureDiff): boolean {
  return (
    d.apps.added.length + d.apps.removed.length + d.models.length + d.rootIncludes.added.length +
      d.rootIncludes.removed.length + Object.keys(d.appUrls).length + d.deps.added.length + d.deps.removed.length ===
    0
  );
}
