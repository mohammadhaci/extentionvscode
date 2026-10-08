/**
 * Confinement check for webview-supplied file references.
 *
 * The analyzer produces posix-style workspace-relative paths such as
 * "blog/models.py" or "manage.py". Anything else (absolute paths,
 * Windows drive prefixes, backslashes, empty/dot segments) is rejected
 * so `vscode.Uri.joinPath(folder.uri, ...file.split("/"))` cannot escape
 * the active workspace folder.
 */
export function isSafeWorkspaceRelativePath(file: unknown): file is string {
  if (typeof file !== "string") {
    return false;
  }
  if (file === "" || file.length > 1024) {
    return false;
  }
  if (file.includes("\0") || file.includes("\\")) {
    return false;
  }
  if (file.startsWith("/")) {
    return false;
  }
  if (/^[A-Za-z]:/.test(file)) {
    return false;
  }
  const segments = file.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return false;
    }
  }
  return true;
}
