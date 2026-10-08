export { discoverApps, findRootUrls } from "./appDiscovery";
export type { DiscoveredApp } from "./appDiscovery";
export { buildProjectMap } from "./graphBuilder";
export type { MapInputs } from "./graphBuilder";
export { parseModels } from "./parseModels";
export type { ModelInfo, ModelField } from "./parseModels";
export { parseSettings, installedAppToDir } from "./parseSettings";
export type { SettingsInfo } from "./parseSettings";
export { parseUrls, normalizeViewRef } from "./parseUrls";
export type { UrlPattern } from "./parseUrls";
export { parseViews } from "./parseViews";
export type { ViewInfo, TemplateRef, ModelRef } from "./parseViews";
// NOTE: analyzeWorkspace is intentionally NOT re-exported here: it depends
// on the `vscode` API (extension host only). Import it directly from
// "./analyzer/analyzeWorkspace" in extension code. Everything re-exported
// above is pure and runnable/testable in plain Node.
