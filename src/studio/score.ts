// Pure: turns a StudioStatus into the Home view's health score, setup quest,
// level and badges. Kept separate so the fun parts are deterministic and tested.
import { StudioStatus } from "./status";

export interface Quest {
  id: "tool" | "reference" | "rules" | "skills" | "ci" | "green";
  done: boolean;
  /** Command the Home view runs to complete the step. */
  action: string;
}

export interface Badge {
  id: "clean-migrations" | "template-keeper" | "in-sync" | "skilled" | "guarded" | "green-branch" | "elephant" | "all-star";
  earned: boolean;
}

export interface Score {
  /** 0-100 */
  health: number;
  mood: "party" | "happy" | "ok" | "worried" | "sleepy";
  quests: Quest[];
  level: number;
  badges: Badge[];
}

export function questsOf(s: StudioStatus): Quest[] {
  return [
    { id: "tool", done: s.tool.installed && !s.tool.outdated, action: "agentStudio.setup" },
    { id: "reference", done: s.scaffold.state !== "off", action: "agentStudio.setReference" },
    { id: "rules", done: s.context.state !== "off", action: "agentStudio.openRules" },
    { id: "skills", done: s.skills.missing.length === 0, action: "agentStudio.setup" },
    { id: "ci", done: s.ci === "installed", action: "agentStudio.setup" },
    {
      id: "green",
      done: s.guard.state === "pass" && s.context.state === "pass" && s.scaffold.state === "pass" && s.report.verdict === "green",
      action: "agentStudio.showReport",
    },
  ];
}

/**
 * Health: half from the checks (only those that apply), half from setup.
 * A project with no Django code and nothing set up scores 0 and looks sleepy.
 */
export function scoreOf(s: StudioStatus): Score {
  const quests = questsOf(s);
  const setupDone = quests.filter((q) => q.id !== "green" && q.done).length;
  const setup = setupDone / 5;

  const checks: number[] = [];
  if (s.guard.state !== "off") {
    checks.push(s.guard.state === "pass" ? (s.guard.warnings > 0 ? 0.8 : 1) : 0);
  }
  if (s.scaffold.state !== "off") {
    checks.push(s.scaffold.total === 0 ? 1 : s.scaffold.ok / s.scaffold.total);
  }
  if (s.context.state !== "off") {
    checks.push(s.context.state === "pass" ? 1 : 0.3);
  }
  if (s.report.verdict) {
    checks.push(s.report.verdict === "green" ? 1 : s.report.verdict === "yellow" ? 0.6 : 0);
  }
  const checkScore = checks.length > 0 ? checks.reduce((a, b) => a + b, 0) / checks.length : 0;
  const health = !s.django.detected && setupDone === 0 ? 0 : Math.round(50 * setup + 50 * checkScore);

  // Worried only when something actually fails; an unfinished setup is just sleepy.
  const failing =
    s.guard.state === "fail" || s.scaffold.state === "fail" || s.context.state === "fail" || s.report.verdict === "red";
  const mood: Score["mood"] =
    health >= 100 ? "party" : failing ? "worried" : setupDone === 0 ? "sleepy" : health >= 80 ? "happy" : "ok";

  const badges: Badge[] = [
    { id: "clean-migrations", earned: s.guard.state === "pass" && s.guard.warnings === 0 },
    { id: "template-keeper", earned: s.scaffold.state === "pass" && s.scaffold.total > 0 },
    { id: "in-sync", earned: s.context.state === "pass" },
    { id: "skilled", earned: s.skills.missing.length === 0 },
    { id: "guarded", earned: s.ci === "installed" },
    { id: "green-branch", earned: s.report.verdict === "green" && s.report.commits > 0 },
    { id: "elephant", earned: s.memory.active >= 5 },
    { id: "all-star", earned: health >= 100 },
  ];

  return { health, mood, quests, level: quests.filter((q) => q.done).length, badges };
}
