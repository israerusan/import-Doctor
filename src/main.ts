import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, parseYaml } from "obsidian";
import { auditImport, type AuditFile, type AuditReport } from "./audit";
import { verifyImportDoctorLicense } from "./license";

interface ImportDoctorSettings {
  importFolder: string;
  licenseKey: string;
  isPro: boolean;
  licenseEmail: string;
}

const DEFAULT_SETTINGS: ImportDoctorSettings = { importFolder: "", licenseKey: "", isPro: false, licenseEmail: "" };

export default class ImportDoctorPlugin extends Plugin {
  settings: ImportDoctorSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.refreshLicense(false);
    this.addCommand({ id: "scan-notion-import", name: "Scan Notion import", callback: () => void this.scan() });
    this.addRibbonIcon("stethoscope", "Scan Notion import", () => void this.scan());
    this.addSettingTab(new ImportDoctorSettingTab(this.app, this));
  }

  async scan(): Promise<void> {
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
    const inputs: AuditFile[] = [];
    let skipped = 0;
    for (const file of files) {
      try { inputs.push({ path: file.path, basename: file.basename, extension: file.extension, content: file.extension.toLowerCase() === "md" ? await this.app.vault.cachedRead(file) : undefined }); }
      catch { skipped += 1; inputs.push({ path: file.path, basename: file.basename, extension: file.extension }); }
    }
    const selected = new Set(files.map((file) => file.path));
    const report = auditImport(inputs, { selectedRoot: root, validateFrontmatter: (yaml) => { try { parseYaml(yaml); return true; } catch { return false; } }, resolveWikiLink: (target, source) => {
      const resolved = this.app.metadataCache.getFirstLinkpathDest(target, source);
      if (!resolved) return { status: "unresolved" };
      return selected.has(resolved.path) ? { status: "resolved", path: resolved.path } : { status: "outside", path: resolved.path };
    }});
    if (skipped) new Notice(`${skipped} file(s) changed or could not be read during the scan and were skipped.`);
    new AuditReportModal(this.app, report).open();
  }

  refreshLicense(persist = true): void {
    const result = verifyImportDoctorLicense(this.settings.licenseKey);
    this.settings.isPro = result.valid;
    this.settings.licenseEmail = result.valid ? result.email ?? "" : "";
    if (persist) void this.saveData(this.settings);
  }
}

class AuditReportModal extends Modal {
  constructor(app: App, private readonly report: AuditReport) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("import-doctor-report");
    contentEl.createEl("h2", { text: "Notion import scan report" });
    contentEl.createEl("p", { text: `${this.report.scannedFiles} files scanned · ${this.report.issues.length} potential issues detected` });
    const summary = contentEl.createDiv({ cls: "import-doctor-summary" });
    for (const [kind, count] of Object.entries(this.report.counts)) {
      if (count > 0) summary.createDiv({ text: `${label(kind)}: ${count}` });
    }
    if (this.report.issues.length === 0) contentEl.createEl("p", { text: "No potential issues were detected. The scanner uses pattern matching and may miss unsupported link or formatting patterns." });
    const list = contentEl.createEl("ul", { cls: "import-doctor-issues" });
    for (const issue of this.report.issues.slice(0, 250)) {
      const item = list.createEl("li");
      item.createEl("strong", { text: `${label(issue.kind)} — ` });
      item.appendText(`${issue.path}${issue.line ? `, line ${issue.line}` : ""}${issue.target ? ` — ${issue.target}` : ""}: ${issue.message}`);
    }
    if (this.report.issues.length > 250) contentEl.createEl("p", { text: `Showing the first 250 findings. ${this.report.issues.length - 250} additional findings are included in the totals above.` });
    if (this.report.issues.length > 0) contentEl.createEl("p", { text: "Batch repair is in development. This preview does not change files." });
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
    containerEl.createEl("p", { text: "Planned Pro features: reviewed batch repairs, conflict handling, and recovery tools. Features may change before release." });
  }
}

function label(value: string): string {
  return ({ "broken-link": "Broken note link", "ambiguous-link": "Ambiguous note link", "missing-attachment": "Missing file", "uuid-filename": "Notion ID in filename", "duplicate-title": "Filename collision", "malformed-properties": "Possibly malformed properties", "html-leftover": "Possible leftover HTML", "outside-folder-path": "Link outside import folder" } as Record<string, string>)[value] ?? value;
}

function normalizeFolder(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}
