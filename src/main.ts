import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, parseYaml } from "obsidian";
import { auditImport, type AuditFile, type AuditReport } from "./audit";

interface ImportDoctorSettings { importFolder: string }

const DEFAULT_SETTINGS: ImportDoctorSettings = { importFolder: "" };
const MAX_MARKDOWN_FILES = 10_000;
const MAX_IMPORT_BYTES = 150 * 1024 * 1024;
const MAX_NOTE_BYTES = 10 * 1024 * 1024;

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
    const totalBytes = files.reduce((sum, file) => sum + file.stat.size, 0);
    const oversizedNote = files.find((file) => file.extension.toLowerCase() === "md" && file.stat.size > MAX_NOTE_BYTES);
    if (markdownCount > MAX_MARKDOWN_FILES || totalBytes > MAX_IMPORT_BYTES || oversizedNote) {
      new Notice(`This preview limits scans to ${MAX_MARKDOWN_FILES.toLocaleString()} Markdown notes, 150 MB total, and 10 MB per note. Split the import into smaller folders.`);
      return;
    }
    this.scanning = true;
    const generation = ++this.scanGeneration;
    const inputs: AuditFile[] = [];
    let skipped = 0;
    try {
      new Notice(`Scanning ${markdownCount.toLocaleString()} Markdown notes…`);
      for (let index = 0; index < files.length; index++) {
        if (generation !== this.scanGeneration) { new Notice("Import Doctor scan cancelled."); return; }
        const file = files[index];
        try { inputs.push({ path: file.path, basename: file.basename, extension: file.extension, content: file.extension.toLowerCase() === "md" ? await this.app.vault.cachedRead(file) : undefined }); }
        catch { skipped += 1; inputs.push({ path: file.path, basename: file.basename, extension: file.extension }); }
        if (index % 25 === 24) await yieldToUi();
      }
      const selected = new Set(files.map((file) => file.path));
      const report = auditImport(inputs, { selectedRoot: root, maxDetailedIssues: 250, validateFrontmatter: (yaml) => { try { parseYaml(yaml); return true; } catch { return false; } }, resolveWikiLink: (target, source) => {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(target, source);
        if (!resolved) return { status: "unresolved" };
        return selected.has(resolved.path) ? { status: "resolved", path: resolved.path } : { status: "outside", path: resolved.path };
      }});
      if (generation !== this.scanGeneration) return;
      new AuditReportModal(this.app, report, skipped, markdownCount, files.length).open();
    } finally { if (generation === this.scanGeneration) this.scanning = false; }
  }

  cancelScan(): void { if (this.scanning) { this.scanGeneration += 1; this.scanning = false; } else new Notice("No Import Doctor scan is running."); }
  onunload(): void { this.scanGeneration += 1; this.scanning = false; }
}

class AuditReportModal extends Modal {
  constructor(app: App, private readonly report: AuditReport, private readonly skipped: number, private readonly markdownCount: number, private readonly indexedFiles: number) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("import-doctor-report");
    contentEl.createEl("h2", { text: "Notion import scan report" });
    contentEl.createEl("p", { text: `${this.markdownCount - this.skipped} Markdown notes checked · ${this.indexedFiles} files indexed · ${this.report.totalIssues} potential issues detected` });
    if (this.skipped) contentEl.createEl("p", { text: `${this.skipped} file(s) could not be read and were excluded from content checks.` });
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
    }
    if (this.report.truncated) contentEl.createEl("p", { text: `Showing the first ${this.report.issues.length} findings. ${this.report.totalIssues - this.report.issues.length} additional findings are included in the totals above.` });
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
    new Setting(containerEl).setName("Notion import folder").setDesc("Vault-relative path to the imported folder. Markdown notes and referenced files in all subfolders are included. Example: Imports/Notion.").addText((text) => {
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
