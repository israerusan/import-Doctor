import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, parseYaml } from "obsidian";
import { auditImport, createAuditIndex, type AuditFile, type AuditReport } from "./audit";

interface ImportDoctorSettings { importFolder: string }

const DEFAULT_SETTINGS: ImportDoctorSettings = { importFolder: "" };
const MAX_MARKDOWN_FILES = 10_000;
const MAX_INDEXED_FILES = 50_000;
const MAX_PATH_CHARACTERS = 5_000_000;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_FRONTMATTER_CHARACTERS = 256 * 1024;

export default class ImportDoctorPlugin extends Plugin {
  settings: ImportDoctorSettings = { ...DEFAULT_SETTINGS };
  private scanGeneration = 0;
  private scanning = false;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addCommand({ id: "scan-notion-import", name: "Scan Notion import", callback: () => void this.scan() });
    this.addCommand({ id: "cancel-notion-import-scan", name: "Cancel active Notion import scan", callback: () => this.cancelScan() });
    this.addRibbonIcon("stethoscope", "Scan Notion import", () => void this.scan());
    this.addSettingTab(new ImportDoctorSettingTab(this.app, this));
  }

  async scan(): Promise<void> {
    if (this.scanning) { new Notice("An Import Doctor scan is already running. Cancel it before starting another."); return; }
    const root = normalizeFolder(this.settings.importFolder);
    if (!root) {
      new Notice("Choose your Notion import folder in Settings → Import Doctor, then run the scan again.");
      return;
    }
    const files = this.app.vault.getFiles().filter((file) => file.path === root || file.path.startsWith(`${root}/`));
    if (files.length === 0) {
      new Notice(`No files were found in “${root}”. Check that the vault-relative folder path is correct.`);
      return;
    }
    const markdownCount = files.filter((file) => file.extension.toLowerCase() === "md").length;
    const pathCharacters = files.reduce((sum, file) => sum + file.path.length, 0);
    const totalBytes = files.filter((file) => file.extension.toLowerCase() === "md").reduce((sum, file) => sum + file.stat.size, 0);
    const oversizedNote = files.find((file) => file.extension.toLowerCase() === "md" && file.stat.size > MAX_NOTE_BYTES);
    if (files.length > MAX_INDEXED_FILES || pathCharacters > MAX_PATH_CHARACTERS || markdownCount > MAX_MARKDOWN_FILES || totalBytes > MAX_IMPORT_BYTES || oversizedNote) {
      new Notice(`This preview limits scans to ${MAX_INDEXED_FILES.toLocaleString()} indexed files, ${MAX_MARKDOWN_FILES.toLocaleString()} Markdown notes, 100 MB of Markdown, and 2 MB per note. Split the import into smaller folders.`);
      return;
    }
    this.scanning = true;
    const generation = ++this.scanGeneration;
    const inventory: AuditFile[] = files.map((file) => ({ path: file.path, basename: file.basename, extension: file.extension }));
    const selected = new Set(files.map((file) => file.path));
    const auditIndex = createAuditIndex(inventory, root);
    const aggregate = auditImport([], { index: auditIndex, inspectContent: false, maxDetailedIssues: 250, maxDetailsPerKind: 32 });
    const skippedPaths: string[] = [];
    let actualContentUnits = 0;
    try {
      new Notice(`Scanning ${markdownCount.toLocaleString()} Markdown notes… Run “Cancel active Notion import scan” from the Command Palette to stop.`);
      for (let index = 0; index < files.length; index++) {
        if (generation !== this.scanGeneration) { new Notice("Import Doctor scan cancelled."); return; }
        const file = files[index];
        if (file.extension.toLowerCase() !== "md") continue;
        let content: string;
        try { content = await this.app.vault.read(file); }
        catch { skippedPaths.push(file.path); await yieldToUi(); continue; }
        if (generation !== this.scanGeneration) { new Notice("Import Doctor scan cancelled."); return; }
        const actualBytes = new TextEncoder().encode(content).byteLength;
        actualContentUnits += actualBytes;
        if (actualBytes > MAX_NOTE_BYTES || actualContentUnits > MAX_IMPORT_BYTES) {
          new Notice("The Markdown content grew beyond this preview’s byte limit during scanning. Split the import into smaller folders.");
          return;
        }
        try {
          const detailBudget = Math.max(0, 250 - aggregate.issues.length);
          const partial = auditImport([{ path: file.path, basename: file.basename, extension: file.extension, content }], {
            index: auditIndex, inspectMetadata: false, maxDetailedIssues: detailBudget, maxDetailsPerKind: 32,
            validateFrontmatter: (yaml) => { if (yaml.length > MAX_FRONTMATTER_CHARACTERS) return false; try { parseYaml(yaml); return true; } catch { return false; } },
            resolveWikiLink: (target, source) => {
              const resolved = this.app.metadataCache.getFirstLinkpathDest(target, source);
              if (!resolved) return { status: "unresolved" };
              return selected.has(resolved.path) ? { status: "resolved", path: resolved.path } : { status: "outside", path: resolved.path };
            }
          });
          mergeReport(aggregate, partial, 250);
        } catch (error) { console.error(`Import Doctor failed while auditing ${file.path}`, error); new Notice(`Import Doctor could not complete the scan while auditing ${file.path}.`); return; }
        await yieldToUi();
      }
      if (generation !== this.scanGeneration) return;
      new AuditReportModal(this.app, aggregate, skippedPaths, markdownCount, files.length).open();
    } finally { this.scanning = false; }
  }

  cancelScan(): void { if (this.scanning) { this.scanGeneration += 1; new Notice("Cancelling Import Doctor scan…"); } else new Notice("No Import Doctor scan is running."); }
  onunload(): void { this.scanGeneration += 1; this.scanning = false; }
}

class AuditReportModal extends Modal {
  constructor(app: App, private readonly report: AuditReport, private readonly skippedPaths: string[], private readonly markdownCount: number, private readonly indexedFiles: number) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("import-doctor-report");
    contentEl.createEl("h2", { text: "Notion import scan report" });
    contentEl.createEl("p", { text: `${this.markdownCount - this.skippedPaths.length} Markdown notes checked · ${this.indexedFiles} files indexed · ${this.report.totalIssues} potential issues detected` });
    if (this.skippedPaths.length) contentEl.createEl("p", { text: `${this.skippedPaths.length} Markdown note(s) could not be read and were excluded from content checks: ${this.skippedPaths.join(", ")}` });
    const summary = contentEl.createDiv({ cls: "import-doctor-summary" });
    for (const [kind, count] of Object.entries(this.report.counts)) {
      if (count > 0) summary.createDiv({ text: `${label(kind)}: ${count}` });
    }
    if (this.report.totalIssues === 0) contentEl.createEl("p", { text: "No potential issues were detected. The scanner uses pattern matching and may miss unsupported link or formatting patterns." });
    const list = contentEl.createEl("ul", { cls: "import-doctor-issues" });
    for (const issue of this.report.issues) {
      const item = list.createEl("li");
      item.createEl("strong", { text: `${label(issue.kind)} — ` });
      item.appendText(`${issue.path}${issue.line ? `, line ${issue.line}` : ""}${issue.target ? ` — ${issue.target}` : ""}: ${issue.message}`);
      const openButton = item.createEl("button", { text: "Open note", attr: { "aria-label": `Open ${issue.path}` } });
      openButton.addEventListener("click", () => { const file = this.app.vault.getAbstractFileByPath(issue.path); if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file); else new Notice(`Could not open ${issue.path}.`); });
    }
    if (this.report.truncated) contentEl.createEl("p", { text: `Showing the first ${this.report.issues.length} findings. ${this.report.totalIssues - this.report.issues.length} additional findings are included in the totals above.` });
    const copyButton = contentEl.createEl("button", { text: "Copy report" });
    copyButton.addEventListener("click", () => { void navigator.clipboard.writeText(formatReport(this.report, this.skippedPaths)).then(() => new Notice("Import Doctor report copied."), () => new Notice("Could not copy the report.")); });
    if (this.report.totalIssues > 0) contentEl.createEl("p", { text: "Review each finding before changing files; links outside the import folder may be intentional." });
  }
}

class ImportDoctorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ImportDoctorPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Import Doctor" });
    containerEl.createEl("p", { text: "This preview supports folders created by Obsidian’s official Notion importer only. Scanning is read-only and does not upload note contents." });
    new Setting(containerEl).setName("Notion import folder").setDesc("Vault-relative path to the imported folder. Limit: 50,000 indexed files, 10,000 Markdown notes, 100 MB of Markdown, and 2 MB per note. Example: Imports/Notion.").addText((text) => {
      text.setPlaceholder("Imports/Notion").setValue(this.plugin.settings.importFolder).onChange((value) => { this.plugin.settings.importFolder = value.trim(); });
      text.inputEl.addEventListener("blur", () => { this.plugin.settings.importFolder = text.getValue().trim(); void this.plugin.saveData({ ...this.plugin.settings }); });
    });
  }
}

function label(value: string): string {
  return ({ "broken-link": "Broken note link", "ambiguous-link": "Ambiguous note link", "missing-attachment": "Missing file", "uuid-filename": "Notion ID in filename", "duplicate-title": "Filename collision", "malformed-properties": "Possibly malformed properties", "html-leftover": "Possible leftover HTML", "outside-folder-path": "Link outside import folder" } as Record<string, string>)[value] ?? value;
}

function normalizeFolder(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function yieldToUi(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 0)); }

function mergeReport(target: AuditReport, source: AuditReport, detailLimit: number): void {
  target.scannedFiles += source.scannedFiles;
  target.totalIssues += source.totalIssues;
  for (const [kind, count] of Object.entries(source.counts)) target.counts[kind as keyof typeof target.counts] += count;
  const retainedByKind = new Map<string, number>();
  for (const issue of target.issues) retainedByKind.set(issue.kind, (retainedByKind.get(issue.kind) ?? 0) + 1);
  for (const issue of source.issues) {
    if (target.issues.length >= detailLimit) break;
    const retained = retainedByKind.get(issue.kind) ?? 0;
    if (retained >= 32) continue;
    target.issues.push(issue);
    retainedByKind.set(issue.kind, retained + 1);
  }
  target.truncated = target.totalIssues > target.issues.length;
}

function formatReport(report: AuditReport, skippedPaths: string[]): string {
  const lines = ["# Import Doctor scan report", "", `Potential issues: ${report.totalIssues}`];
  for (const [kind, count] of Object.entries(report.counts)) if (count) lines.push(`${label(kind)}: ${count}`);
  if (skippedPaths.length) lines.push("", `Unreadable Markdown notes: ${skippedPaths.join(", ")}`);
  lines.push("");
  for (const issue of report.issues) lines.push(`- ${label(issue.kind)} — ${issue.path}${issue.line ? `, line ${issue.line}` : ""}${issue.target ? ` — ${issue.target}` : ""}: ${issue.message}`);
  if (report.truncated) lines.push(`- … ${report.totalIssues - report.issues.length} additional findings are included only in the totals.`);
  return lines.join("\n");
}
