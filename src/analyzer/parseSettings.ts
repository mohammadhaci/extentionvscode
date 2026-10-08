export interface SettingsInfo {
  /** Raw entries of INSTALLED_APPS, e.g. ["django.contrib.admin", "blog.apps.BlogConfig"] */
  installedApps: string[];
  rootUrlconf?: string;
  looksLikeDjango: boolean;
}

const INSTALLED_APPS_RE = /INSTALLED_APPS\s*=\s*\[/;
const QUOTED_RE = /["']([^"']+)["']/g;
const ROOT_URLCONF_RE = /ROOT_URLCONF\s*=\s*["']([^"']+)["']/;

/**
 * Heuristically parse settings.py content (no code execution).
 * Extracts INSTALLED_APPS string literals and ROOT_URLCONF.
 */
export function parseSettings(text: string): SettingsInfo {
  const installedApps: string[] = [];
  const m = text.match(INSTALLED_APPS_RE);
  if (m && m.index !== undefined) {
    // Bracket-match from the opening `[`
    const start = text.indexOf("[", m.index);
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "[") {
        depth++;
      } else if (text[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > start) {
      const block = text.slice(start, end + 1);
      // Strip comments to avoid picking up quoted strings in comments
      const code = block
        .split("\n")
        .map((l) => l.split("#")[0])
        .join("\n");
      QUOTED_RE.lastIndex = 0;
      let q: RegExpExecArray | null;
      while ((q = QUOTED_RE.exec(code)) !== null) {
        installedApps.push(q[1]);
      }
    }
  }
  const root = text.match(ROOT_URLCONF_RE);
  const looksLikeDjango =
    installedApps.length > 0 ||
    /django/i.test(text) && /INSTALLED_APPS|MIDDLEWARE/.test(text);
  return {
    installedApps,
    rootUrlconf: root ? root[1] : undefined,
    looksLikeDjango
  };
}

/** Map an INSTALLED_APPS entry to a probable directory path, e.g. "blog.apps.BlogConfig" -> "blog". */
export function installedAppToDir(entry: string): string {
  const first = entry.split(".")[0];
  return first;
}
