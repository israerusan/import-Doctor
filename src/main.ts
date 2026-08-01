import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { auditImport, type AuditFile, type AuditReport } from "./audit";
import { PURCHASE_URL, verifyImportDoctorLicense } from "./license";

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
    const root = this.settings.importFolder.replace(/^\/+|\/+$/g, "");
    if (!root) {
      new Notice("Choose the imported folder in Import Doctor settings first.");
      return;
    }
    const files = this.app.vault.getFiles().filter((file) => file.path === root || file.path.startsWith(`${root}/`));
    if (files.length === 0) {
      new Notice(`No files found under “${root}”.`);
      return;
    }
    const inputs: AuditFile[] = await Promise.all(files.map(async (file) => ({
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      content: file.extension.toLowerCase() === "md" ? await this.app.vault.cachedRead(file) : undefined
    })));
    new AuditReportModal(this.app, auditImport(inputs), this.settings.isPro).open();
  }

  refreshLicense(persist = true): void {
    const result = verifyImportDoctorLicense(this.settings.licenseKey);
    this.settings.isPro = result.valid;
    this.settings.licenseEmail = result.valid ? result.email ?? "" : "";
    if (persist) void this.saveData(this.settings);
  }
}

class AuditReportModal extends Modal {
  constructor(app: App, private readonly report: AuditReport, private readonly isPro: boolean) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("import-doctor-report");
    contentEl.createEl("h2", { text: "Notion import health report" });
    contentEl.createEl("p", { text: `${this.report.scannedFiles} files scanned · ${this.report.issues.length} issues found` });
    const summary = contentEl.createDiv({ cls: "import-doctor-summary" });
    for (const [kind, count] of Object.entries(this.report.counts)) {
      if (count > 0) summary.createDiv({ text: `${label(kind)}: ${count}` });
    }
    if (this.report.issues.length === 0) contentEl.createEl("p", { text: "No known Notion import problems found in this folder." });
    const list = contentEl.createEl("ul", { cls: "import-doctor-issues" });
    for (const issue of this.report.issues.slice(0, 250)) {
      const item = list.createEl("li");
      item.createEl("strong", { text: `${label(issue.kind)} — ` });
      item.appendText(`${issue.path}: ${issue.message}`);
    }
    if (this.report.issues.length > 250) contentEl.createEl("p", { text: `${this.report.issues.length - 250} more issues omitted from this preview.` });
    const action = contentEl.createEl("button", { text: this.isPro ? "Build repair plan (coming next)" : "Unlock batch repair" });
    action.addEventListener("click", () => this.isPro ? new Notice("Mutation is intentionally disabled in this scanner-first build.") : window.open(PURCHASE_URL));
  }
}

class ImportDoctorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ImportDoctorPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Import Doctor" });
    new Setting(containerEl).setName("Imported folder").setDesc("Vault-relative folder created by the official Notion import.").addText((text) => text.setPlaceholder("Notion import").setValue(this.plugin.settings.importFolder).onChange(async (value) => {
      this.plugin.settings.importFolder = value.trim(); await this.plugin.saveData(this.plugin.settings);
    }));
    new Setting(containerEl).setName("Pro license key").setDesc(this.plugin.settings.isPro ? `Active${this.plugin.settings.licenseEmail ? ` for ${this.plugin.settings.licenseEmail}` : ""}.` : "Offline Ed25519 verification; no account or server required.").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(this.plugin.settings.licenseKey).onChange((value) => { this.plugin.settings.licenseKey = value.trim(); this.plugin.refreshLicense(); });
    });
    new Setting(containerEl).setName("Import Doctor Pro").setDesc("Batch repair, collision handling, previews, transaction log, rollback, and resumable processing.").addButton((button) => button.setButtonText("Purchase Pro").onClick(() => window.open(PURCHASE_URL)));
  }
}

function label(value: string): string {
  return value.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}
