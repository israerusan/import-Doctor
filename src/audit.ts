export type IssueKind = "broken-link" | "ambiguous-link" | "missing-attachment" | "uuid-filename" | "duplicate-title" | "malformed-properties" | "html-leftover" | "outside-folder-path";

export interface AuditFile { path: string; basename: string; extension: string; content?: string }
export interface AuditIssue { kind: IssueKind; path: string; message: string; target?: string; line?: number }
export interface AuditReport { scannedFiles: number; issues: AuditIssue[]; counts: Record<IssueKind, number>; totalIssues: number; truncated: boolean }
export type WikiResolution = { status: "resolved"; path: string } | { status: "outside"; path: string } | { status: "unresolved" };
export interface AuditOptions { selectedRoot?: string; resolveWikiLink?: (target: string, sourcePath: string) => WikiResolution; validateFrontmatter?: (yaml: string) => boolean; maxDetailedIssues?: number }

const UUID_SUFFIX = /(?:\s|-)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const WIKI_LINK = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const HTML_LEFTOVER = /<(?:div|span|tbody|tr|td|figure|figcaption|mark)\b[^>]*>/i;
const ATTACHMENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "mp3", "mp4", "wav", "mov", "zip", "csv"]);

export function auditImport(files: AuditFile[], options: AuditOptions = {}): AuditReport {
  const issues: AuditIssue[] = [];
  const counts = emptyCounts();
  let totalIssues = 0;
  const detailLimit = Math.max(0, options.maxDetailedIssues ?? Number.POSITIVE_INFINITY);
  const addIssue = (issue: AuditIssue): void => { counts[issue.kind] += 1; totalIssues += 1; if (issues.length < detailLimit) issues.push(issue); };
  const selectedRoot = normalize(options.selectedRoot ?? commonRoot(files.map((file) => file.path)));
  const exactPaths = new Set(files.map((file) => normalize(file.path)));
  const basenameIndex = new Map<string, string[]>();
  for (const file of files) {
    const key = file.basename;
    const values = basenameIndex.get(key) ?? [];
    values.push(file.path);
    basenameIndex.set(key, values);
  }

  const markdown = files.filter((file) => file.extension.toLowerCase() === "md");
  const collisionGroups = new Map<string, AuditFile[]>();
  for (const file of markdown) {
    const cleaned = file.basename.replace(UUID_SUFFIX, "").trim();
    const directory = parentPath(file.path).toLowerCase();
    const collisionKey = `${directory}/${cleaned.toLowerCase()}`;
    const group = collisionGroups.get(collisionKey) ?? [];
    group.push(file);
    collisionGroups.set(collisionKey, group);
    if (UUID_SUFFIX.test(file.basename)) addIssue({ kind: "uuid-filename", path: file.path, message: "A Notion ID suffix remains in this filename." });
    inspectContent(file, exactPaths, basenameIndex, addIssue, options, selectedRoot);
  }

  for (const group of collisionGroups.values()) {
    if (group.length < 2) continue;
    for (const file of group) addIssue({ kind: "duplicate-title", path: file.path, message: `Renaming would collide with ${group.length - 1} note(s) in the same folder.` });
  }

  return { scannedFiles: files.length, issues, counts, totalIssues, truncated: totalIssues > issues.length };
}

type IssueSink = (issue: AuditIssue) => void;

function inspectContent(file: AuditFile, paths: Set<string>, basenames: Map<string, string[]>, addIssue: IssueSink, options: AuditOptions, selectedRoot: string): void {
  const original = file.content ?? "";
  const lineNumberAt = makeLineLocator(original);
  if (hasMalformedFrontmatter(original, options.validateFrontmatter)) addIssue({ kind: "malformed-properties", path: file.path, message: "The properties block may be malformed or unclosed." });
  const content = maskNonRenderedMarkdown(original);
  if (HTML_LEFTOVER.test(content)) addIssue({ kind: "html-leftover", path: file.path, message: "HTML that may be leftover from the import was detected." });

  for (const match of content.matchAll(WIKI_LINK)) {
    const target = match[1].trim();
    const resolved = options.resolveWikiLink?.(target, file.path);
    if (resolved?.status === "outside") { addIssue({ kind: "outside-folder-path", path: file.path, target, line: lineNumberAt(match.index ?? 0), message: "This link leaves the selected import folder; review it to confirm that is intentional." }); continue; }
    if (resolved?.status === "resolved") continue;
    if (!resolved || resolved.status === "unresolved") {
      const fallback = wikiTargetStatus(target, file.path, paths, basenames);
      if (fallback === "exists") continue;
      if (fallback === "ambiguous") { addIssue({ kind: "ambiguous-link", path: file.path, target, line: lineNumberAt(match.index ?? 0), message: "More than one note could match this unqualified link." }); continue; }
    }
    const wikiKind: IssueKind = ATTACHMENT_EXTENSIONS.has(extensionOf(target)) ? "missing-attachment" : "broken-link";
    addIssue({ kind: wikiKind, path: file.path, target, line: lineNumberAt(match.index ?? 0), message: wikiKind === "missing-attachment" ? "The referenced file was not found in the selected folder." : "The linked note was not found in the selected folder." });
  }

  for (const link of markdownLinks(content)) inspectMarkdownTarget(file.path, link.target, link.index, paths, addIssue, selectedRoot, lineNumberAt);
}

function inspectMarkdownTarget(sourcePath: string, rawTarget: string, index: number, paths: Set<string>, addIssue: IssueSink, selectedRoot: string, lineNumberAt: (index: number) => number): void {
  const targetWithoutTitle = stripOptionalTitle(rawTarget.trim());
  const unwrapped = targetWithoutTitle.startsWith("<") && targetWithoutTitle.endsWith(">") ? targetWithoutTitle.slice(1, -1) : targetWithoutTitle;
  const decoded = safeDecode(unwrapped.split("#")[0].split("?")[0]).replace(/\\/g, "/").trim();
  if (!decoded) return;
  if (/^(?:file:|javascript:|[a-z]:\/|\/\/|\\\\)/i.test(decoded)) {
    addIssue({ kind: "outside-folder-path", path: sourcePath, target: rawTarget, line: lineNumberAt(index), message: "This link points outside the selected import folder." });
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return;
  const resolved = resolveRelative(parentPath(sourcePath), decoded);
  if (resolved.escaped || (selectedRoot && resolved.path !== selectedRoot && !resolved.path.startsWith(`${selectedRoot}/`))) {
    addIssue({ kind: "outside-folder-path", path: sourcePath, target: rawTarget, line: lineNumberAt(index), message: "This link resolves outside the selected import folder." });
    return;
  }
  const candidate = normalize(resolved.path);
  const exists = paths.has(candidate) || (!extensionOf(candidate) && paths.has(`${candidate}.md`));
  if (exists) return;
  const kind: IssueKind = ATTACHMENT_EXTENSIONS.has(extensionOf(candidate)) ? "missing-attachment" : "broken-link";
  addIssue({ kind, path: sourcePath, target: rawTarget, line: lineNumberAt(index), message: kind === "missing-attachment" ? "The referenced file was not found in the selected folder." : "The linked note was not found in the selected folder." });
}

function wikiTargetStatus(target: string, sourcePath: string, paths: Set<string>, basenames: Map<string, string[]>): "exists" | "ambiguous" | "missing" {
  const raw = safeDecode(target).replace(/\\/g, "/");
  const targetExtension = extensionOf(raw);
  if (targetExtension && targetExtension !== "md") {
    const relativeFile = normalize(`${parentPath(sourcePath)}/${raw}`);
    const vaultFile = normalize(raw);
    if (paths.has(relativeFile) || paths.has(vaultFile)) return "exists";
    const fileBasename = raw.slice(raw.lastIndexOf("/") + 1, raw.lastIndexOf("."));
    return (basenames.get(fileBasename) ?? []).some((path) => path.endsWith(`.${targetExtension}`)) ? "exists" : "missing";
  }
  const decoded = raw.replace(/\.md$/i, "");
  const relative = normalize(`${parentPath(sourcePath)}/${decoded}.md`);
  const vaultPath = normalize(`${decoded}.md`);
  if (paths.has(relative) || paths.has(vaultPath)) return "exists";
  const basename = decoded.slice(decoded.lastIndexOf("/") + 1);
  const matches = (basenames.get(basename) ?? []).filter((path) => path.endsWith(".md"));
  if (decoded.includes("/")) return "missing";
  return matches.length > 1 ? "ambiguous" : matches.length === 1 ? "exists" : "missing";
}

function markdownLinks(content: string): Array<{ target: string; index: number }> {
  const links: Array<{ target: string; index: number }> = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "]" || content[i + 1] !== "(" || isEscaped(content, i)) continue;
    const opening = findOpeningBracket(content, i);
    if (opening < 0) continue;
    let depth = 1; let escaped = false; let j = i + 2;
    for (; j < content.length; j++) {
      const char = content[j];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === "(") depth += 1;
      if (char === ")" && --depth === 0) break;
    }
    if (depth === 0) { links.push({ target: unescapeMarkdown(content.slice(i + 2, j)), index: opening }); i = j; }
  }
  return links;
}

function stripOptionalTitle(value: string): string {
  if (value.startsWith("<")) { const end = value.indexOf(">"); return end >= 0 ? value.slice(0, end + 1) : value; }
  return value.replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/, "");
}

function maskNonRenderedMarkdown(content: string): string {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/^(?: {4}|\t).*$/gm, (value) => " ".repeat(value.length))
    .replace(/`[^`\r\n]*`/g, (value) => " ".repeat(value.length))
    .replace(/<!--[\s\S]*?-->/g, (value) => value.replace(/[^\r\n]/g, " "));
}

function hasMalformedFrontmatter(content: string, validate?: (yaml: string) => boolean): boolean {
  if (!/^---\r?\n/.test(content)) return false;
  const lines = content.split(/\r?\n/);
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) return true;
  if (validate) return !validate(lines.slice(1, closing + 1).join("\n"));
  return lines.slice(1, closing + 1).some((line) => {
    const trimmed = line.trim();
    return Boolean(trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-") && !/^[-\w .]+:\s*/.test(trimmed) && !/^\s/.test(line));
  });
}

function resolveRelative(base: string, target: string): { path: string; escaped: boolean } {
  const parts = base.split("/").filter(Boolean); let escaped = false;
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length) parts.pop(); else escaped = true; } else parts.push(part);
  }
  return { path: parts.join("/"), escaped };
}
function parentPath(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" }
function findOpeningBracket(content: string, close: number): number { let depth = 0; for (let i = close - 1; i >= 0 && content[i] !== "\n"; i--) { if (isEscaped(content, i)) continue; if (content[i] === "]") depth += 1; if (content[i] === "[") { if (depth === 0) return i; depth -= 1; } } return -1 }
function isEscaped(content: string, index: number): boolean { let slashes = 0; for (let i = index - 1; i >= 0 && content[i] === "\\"; i--) slashes += 1; return slashes % 2 === 1 }
function unescapeMarkdown(value: string): string { return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1") }
function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const directories = paths.map((path) => parentPath(path).split("/").filter(Boolean));
  const common: string[] = [];
  for (let i = 0; i < directories[0].length; i++) {
    const part = directories[0][i];
    if (!directories.every((segments) => segments[i] === part)) break;
    common.push(part);
  }
  return common.join("/");
}
function normalize(path: string): string { return resolveRelative("", path.replace(/\\/g, "/")).path }
function extensionOf(path: string): string { const name = path.slice(path.lastIndexOf("/") + 1); return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "" }
function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value } }
function makeLineLocator(content: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return (index: number): number => { let low = 0; let high = starts.length; while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= index) low = mid + 1; else high = mid; } return low; };
}
function emptyCounts(): Record<IssueKind, number> { return { "broken-link": 0, "ambiguous-link": 0, "missing-attachment": 0, "uuid-filename": 0, "duplicate-title": 0, "malformed-properties": 0, "html-leftover": 0, "outside-folder-path": 0 } }
