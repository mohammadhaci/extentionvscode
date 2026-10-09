// Django Agent Studio: one extension for building a Django project with coding agents.
//   Home    health score, setup quest, every tool at a glance
//   Map     apps, URLs, views, models and relations (static analysis)
//   Skills  browse, copy and import agent skills
//   Tasks   one-click, ready-made tasks for any agent
//   Scaffold / Context / Guard / Report / Memory: the agent tools, also shipped as a CLI
import * as vscode from "vscode";
import { activateContext } from "./context/ui";
import { activateGuard } from "./guard/ui";
import { activateMap, deactivateMap } from "./map/ui";
import { activateMemory } from "./memory/ui";
import { activateReport } from "./report/ui";
import { activateScaffold } from "./scaffold/ui";
import { activateSkills, deactivateSkills } from "./skillsDashboard/ui";
import { activateTasks } from "./tasks/ui";
import { HOME_VIEW_ID, HomeViewProvider } from "./studio/home";
import { runSetup } from "./studio/setup";

export function activate(context: vscode.ExtensionContext): void {
  const home = new HomeViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HOME_VIEW_ID, home, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("agentStudio.setup", async () => {
      try {
        await runSetup(context);
      } catch (err) {
        void vscode.window.showErrorMessage(`Agent Studio setup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      home.refreshSoon(0);
    }),
    vscode.commands.registerCommand("agentStudio.refreshHome", () => home.refreshSoon(0)),
    vscode.commands.registerCommand("agentStudio.showHome", () => vscode.commands.executeCommand(`${HOME_VIEW_ID}.focus`))
  );

  activateMap(context);
  activateSkills(context);
  activateScaffold(context);
  activateContext(context);
  activateGuard(context);
  activateReport(context);
  activateMemory(context);
  activateTasks(context);

  // Keep Home current while files that affect it change.
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{.agent-studio/**,migrations/*.py,models.py,urls.py,apps.py,*settings*.py,CLAUDE.md,AGENTS.md,copilot-instructions.md,agent-guardrails.yml,SKILL.md}"
  );
  const poke = (): void => home.refreshSoon();
  watcher.onDidChange(poke);
  watcher.onDidCreate(poke);
  watcher.onDidDelete(poke);
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  deactivateMap();
  deactivateSkills();
}
