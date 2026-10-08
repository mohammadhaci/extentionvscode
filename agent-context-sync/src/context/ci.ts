import * as fs from "fs";
import * as path from "path";
import { CI_WORKFLOW } from "../vendor/ciTemplate";

export const CI_WORKFLOW_PATH = ".github/workflows/agent-guardrails.yml";

export type CiInstallStatus = "created" | "updated" | "unchanged" | "exists";

/**
 * Writes the guardrails workflow. An existing, different file is only
 * replaced with `force` (it may have been customised).
 */
export function installCiWorkflow(root: string, force = false): CiInstallStatus {
  const file = path.join(root, ...CI_WORKFLOW_PATH.split("/"));
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`${CI_WORKFLOW_PATH} is a symlink; not touched.`);
    }
    if (fs.readFileSync(file, "utf8") === CI_WORKFLOW) {
      return "unchanged";
    }
    if (!force) {
      return "exists";
    }
    fs.writeFileSync(file, CI_WORKFLOW);
    return "updated";
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, CI_WORKFLOW);
  return "created";
}
