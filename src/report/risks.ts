// Pure: flags changed files a reviewer should look at, whatever the code says.

export type FileStatus = "added" | "modified" | "deleted";

export interface ChangedFile {
  path: string;
  status: FileStatus;
  /** Lines added/removed; undefined for binary files. */
  added?: number;
  removed?: number;
}

export type Level = "red" | "yellow";

export interface Risk {
  level: Level;
  title: string;
  why: string;
  files: string[];
}

interface Rule {
  level: Level;
  title: string;
  why: string;
  match: (p: string, f: ChangedFile) => boolean;
}

const RULES: Rule[] = [
  {
    level: "red",
    title: "Agent guardrails or tooling changed",
    why: "Agents must not edit the tools, skills, CI or settings that check their own work. Confirm a human asked for this.",
    match: (p) =>
      /^\.agent-studio\//.test(p) ||
      /^\.(claude|agents|github)\/skills\//.test(p) ||
      /^\.github\/workflows\//.test(p),
  },
  {
    level: "red",
    title: "Secrets or environment files changed",
    why: "May leak credentials or change production behaviour.",
    match: (p) => /(^|\/)\.env(\.|$)/.test(p) || /(^|\/)(secrets?|credentials?)(\.[\w]+)?$/i.test(p) || /\.(pem|key|p12)$/i.test(p),
  },
  {
    level: "red",
    title: "Committed migrations deleted",
    why: "Databases that applied them still reference them. Restore, or squash instead.",
    match: (p, f) => f.status === "deleted" && /(^|\/)migrations\/(?!__init__\.py$)[^/]+\.py$/.test(p),
  },
  {
    level: "yellow",
    title: "Settings changed",
    why: "Affects every environment: check installed apps, middleware, security and database settings.",
    match: (p) => /(^|\/)settings(_\w+)?\.py$/.test(p) || /(^|\/)settings\/[^/]+\.py$/.test(p),
  },
  {
    level: "yellow",
    title: "Dependencies changed",
    why: "New or upgraded packages: check licences, versions and what they pull in.",
    // Hidden folders (agent tool installs, editor config) do not hold project dependencies.
    match: (p) =>
      !/(^|\/)\./.test(p) &&
      /(^|\/)(requirements[^/]*\.(txt|in)|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|uv\.lock|setup\.(py|cfg)|package(-lock)?\.json)$/.test(p),
  },
  {
    level: "yellow",
    title: "Security-sensitive code changed",
    why: "Authentication, permissions or middleware: a mistake here exposes data.",
    match: (p) => /(^|\/)(permissions|authentication|backends|middleware|decorators)\.py$/.test(p) || /(^|\/)(auth|accounts|permissions)\//.test(p),
  },
  {
    level: "yellow",
    title: "Deployment files changed",
    why: "Changes how the app is built or deployed.",
    match: (p) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|Procfile|\.gitlab-ci\.yml|nginx[^/]*\.conf)$/.test(p),
  },
  {
    level: "yellow",
    title: "Tests deleted",
    why: "Removing tests hides regressions. Check each one was obsolete.",
    match: (p, f) => f.status === "deleted" && isTestPath(p),
  },
];

export const isTestPath = (p: string): boolean => /(^|\/)(tests?\.py|tests?\/|test_[^/]*\.py$|[^/]*_tests?\.py$|conftest\.py$)/.test(p);
const isMigration = (p: string): boolean => /(^|\/)migrations\//.test(p);

export function findRisks(files: readonly ChangedFile[], appDirs: readonly string[]): Risk[] {
  const risks: Risk[] = [];
  for (const rule of RULES) {
    const hits = files.filter((f) => rule.match(f.path, f)).map((f) => f.path).sort();
    if (hits.length > 0) {
      risks.push({ level: rule.level, title: rule.title, why: rule.why, files: hits });
    }
  }
  // Apps whose code changed while none of their tests did.
  const untested: string[] = [];
  for (const dir of [...appDirs].sort((a, b) => b.length - a.length)) {
    const inApp = files.filter(
      (f) => f.path.startsWith(`${dir}/`) && !appDirs.some((d) => d !== dir && d.startsWith(`${dir}/`) && f.path.startsWith(`${d}/`))
    );
    const code = inApp.filter((f) => f.status !== "deleted" && f.path.endsWith(".py") && !isTestPath(f.path) && !isMigration(f.path));
    if (code.length > 0 && !inApp.some((f) => isTestPath(f.path) && f.status !== "deleted")) {
      untested.push(dir);
    }
  }
  if (untested.length > 0) {
    risks.push({
      level: "yellow",
      title: "Code changed without test changes",
      why: "These apps' code changed but none of their tests did. Ask for tests or confirm existing ones cover it.",
      files: untested.sort(),
    });
  }
  return risks;
}
