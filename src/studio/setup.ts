import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CI_WORKFLOW_PATH } from "../context/ci";
import { isSafeRelativePath } from "../context/config";
import { syncProject } from "../context/sync";
import { CI_WORKFLOW } from "../generated/ciTemplate";
import { setUpProject } from "./install";
import { RULES_FILE, SCAFFOLD_CONFIG, SKILL_ROOTS, STUDIO_DIR } from "./paths";

export function localFolder(): vscode.WorkspaceFolder | undefined {
  return (vscode.workspace.workspaceFolders ?? []).find((f) => f.uri.scheme === "file");
}

/**
 * One-click setup: CLI, skills, rules, CI workflow and the first sync, with a
 * prompt for the reference app when none is set.
 */
export async function runSetup(context: vscode.ExtensionContext): Promise<boolean> {
  const folder = localFolder();
  if (!folder) {
    void vscode.window.showErrorMessage("Open your Django project folder first (File → Open Folder).");
    return false;
  }
  const root = folder.uri.fsPath;
  const ciFile = path.join(root, ...CI_WORKFLOW_PATH.split("/"));
  const ciCustomised = fs.existsSync(ciFile) && fs.readFileSync(ciFile, "utf8") !== CI_WORKFLOW;

  const choice = await vscode.window.showInformationMessage(
    "Set up Django Agent Studio in this project?",
    {
      modal: true,
      detail:
        `• ${STUDIO_DIR}/tool/: the CLI agents and CI run\n` +
        `• Skills for Claude Code, Codex and Copilot in ${SKILL_ROOTS.join(", ")}\n` +
        `• ${RULES_FILE}: one rules file for every agent (kept if it exists)\n` +
        `• ${CI_WORKFLOW_PATH}: guardrails on every pull request` +
        (ciCustomised ? " (yours differs from the template and is kept)" : "") +
        "\n\nNothing outside these paths and the agent instruction files is touched.",
    },
    "Set Up"
  );
  if (choice !== "Set Up") {
    return false;
  }

  const result = setUpProject(context.extensionPath, root, {
    ci: ciCustomised ? "write" : "force",
    skillRoots: (vscode.workspace.getConfiguration("agentStudio").get<string[]>("installSkillsTo") ?? SKILL_ROOTS).filter(isSafeRelativePath),
  });
  const sync = syncProject(root);

  if (!fs.existsSync(path.join(root, ...SCAFFOLD_CONFIG.split("/")))) {
    const pick = await vscode.window.showInformationMessage(
      "Last step: which app is your approved reference template?",
      { detail: "New apps are cloned from it. You can set it later from the Home view." },
      "Pick Reference App",
      "Later"
    );
    if (pick === "Pick Reference App") {
      await vscode.commands.executeCommand("agentStudio.setReference");
    }
  }

  const synced = sync.results.filter((r) => r.status === "created" || r.status === "updated").length;
  void vscode.window.showInformationMessage(
    `🎉 Agent Studio is set up: ${result.toolFiles} tool files, ${result.skills.length} skill files, ${synced} instruction file(s) synced` +
      (result.ci === "exists" ? ", CI workflow kept as is" : result.ci === "unchanged" ? "" : `, CI workflow ${result.ci}`) +
      `. Commit ${STUDIO_DIR}/ and the generated files.`
  );
  return true;
}
