export type IssueKind =
  | "broken-link"
  | "missing-attachment"
  | "uuid-filename"
  | "duplicate-title"
  | "malformed-properties"
  | "html-leftover"
  | "suspicious-path";

export interface AuditFile {
  path: string;
  basename: string;
  extension: string;
  content?: string;
}

export interface AuditIssue {
  kind: IssueKind;
  path: string;
  message: string;
  target?: string;
  line?: number;
}

export interface AuditReport {
  scannedFiles: number;
  issues: AuditIssue[];
  counts: Record<IssueKind, number>;
}

const UUID_SUFFIX = /(?:\s|-)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const WIKI_LINK = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
const HTML_LEFTOVER = /<(?:div|span|table|tbody|tr|td|details|summary|figure|figcaption|mark)\b[^>]*>/i;
const ATTACHMENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "mp3", "mp4", "wav", "mov"]);

export function auditImport(files: AuditFile[]): AuditReport {
  const issues: AuditIssue[] = [];
  const paths = new Set(files.map((file) => normalize(file.path)));
  const markdown = files.filter((file) => file.extension.toLowerCase() === "md");
  const titleGroups = new Map<string, AuditFile[]>();

  for (const file of markdown) {
    const cleanTitle = file.basename.replace(UUID_SUFFIX, "").trim().toLowerCase();
    const group = titleGroups.get(cleanTitle) ?? [];
    group.push(file);
    titleGroups.set(cleanTitle, group);
    if (UUID_SUFFIX.test(file.basename)) {
      issues.push({ kind: "uuid-filename", path: file.path, message: "Notion UUID suffix remains in the filename." });
    }
    inspectContent(file, paths, issues);
  }

  for (const group of titleGroups.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      issues.push({ kind: "duplicate-title", path: file.path, message: `Title collides with ${group.length - 1} other imported note(s).` });
    }
  }

  const counts = emptyCounts();
  for (const issue of issues) counts[issue.kind] += 1;
  return { scannedFiles: files.length, issues, counts };
}

function inspectContent(file: AuditFile, paths: Set<string>, issues: AuditIssue[]): void {
  const content = file.content ?? "";
  if (hasMalformedFrontmatter(content)) {
    issues.push({ kind: "malformed-properties", path: file.path, message: "Frontmatter is unclosed or contains a malformed property line." });
  }
  if (HTML_LEFTOVER.test(content)) {
    issues.push({ kind: "html-leftover", path: file.path, message: "Notion-style HTML remains in the note body." });
  }

  for (const match of content.matchAll(WIKI_LINK)) inspectTarget(file.path, match[1], match.index ?? 0, paths, issues);
  for (const match of content.matchAll(MARKDOWN_LINK)) inspectTarget(file.path, match[1], match.index ?? 0, paths, issues);
}

function inspectTarget(sourcePath: string, rawTarget: string, index: number, paths: Set<string>, issues: AuditIssue[]): void {
  const decoded = safeDecode(rawTarget.split("#")[0].split("?")[0]).replace(/\\/g, "/").trim();
  if (!decoded || /^(?:https?:|mailto:|obsidian:|data:)/i.test(decoded)) return;
  if (/^(?:[a-z]:\/|\/)|(?:^|\/)\.\.(?:\/|$)/i.test(decoded)) {
    issues.push({ kind: "suspicious-path", path: sourcePath, target: rawTarget, line: lineAt(sourcePath, index), message: "Link uses an absolute or parent-traversing path." });
    return;
  }

  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
  const target = normalize(sourceDir + decoded);
  const candidates = decoded.toLowerCase().endsWith(".md") ? [target] : [target, `${target}.md`];
  const exists = candidates.some((candidate) => paths.has(candidate)) || [...paths].some((path) => path.endsWith(`/${normalize(decoded)}`));
  if (exists) return;

  const extension = decoded.includes(".") ? decoded.slice(decoded.lastIndexOf(".") + 1).toLowerCase() : "";
  const kind: IssueKind = ATTACHMENT_EXTENSIONS.has(extension) ? "missing-attachment" : "broken-link";
  issues.push({ kind, path: sourcePath, target: rawTarget, message: kind === "missing-attachment" ? "Referenced attachment was not found." : "Linked note was not found." });
}

function hasMalformedFrontmatter(content: string): boolean {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return false;
  const lines = content.split(/\r?\n/);
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) return true;
  return lines.slice(1, closing + 1).some((line) => line.trim() && !/^\s|#|[-?]|[^:]+:\s*/.test(line));
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function lineAt(_path: string, _index: number): number | undefined {
  return undefined;
}

function emptyCounts(): Record<IssueKind, number> {
  return { "broken-link": 0, "missing-attachment": 0, "uuid-filename": 0, "duplicate-title": 0, "malformed-properties": 0, "html-leftover": 0, "suspicious-path": 0 };
}
