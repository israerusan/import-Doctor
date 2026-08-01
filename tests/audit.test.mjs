import assert from "node:assert/strict";
import test from "node:test";
import { auditImport, createAuditIndex } from "../src/audit.ts";

test("detects common Notion import damage", () => {
  const report = auditImport([
    { path: "Import/Project aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", basename: "Project aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", extension: "md", content: "---\nbad property\n---\n<div>Hi</div>\n[[Missing]]\n![](files/lost.png)" },
    { path: "Import/Project bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md", basename: "Project bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", extension: "md", content: "[unsafe](../secret.md)" }
  ]);
  assert.equal(report.counts["uuid-filename"], 2);
  assert.equal(report.counts["duplicate-title"], 2);
  assert.equal(report.counts["broken-link"], 1);
  assert.equal(report.counts["missing-attachment"], 1);
  assert.equal(report.counts["malformed-properties"], 1);
  assert.equal(report.counts["html-leftover"], 1);
  assert.equal(report.counts["outside-folder-path"], 1);
});

test("handles cross-folder wikilinks and Markdown destination syntax", () => {
  const report = auditImport([
    { path: "Import/A/Home.md", basename: "Home", extension: "md", content: "[[Child]]\n[x](../B/Child.md \"title\")\n![image](<../files/a b.png>)" },
    { path: "Import/B/Child.md", basename: "Child", extension: "md", content: "" },
    { path: "Import/files/a b.png", basename: "a b", extension: "png" }
  ]);
  assert.equal(report.counts["broken-link"], 0);
  assert.equal(report.counts["missing-attachment"], 0);
  assert.equal(report.counts["outside-folder-path"], 0);
});

test("ignores links and HTML inside non-rendered Markdown", () => {
  const report = auditImport([{ path: "Import/Code.md", basename: "Code", extension: "md", content: "---\nexample: '[[Missing]]'\n---\n```md\n[[Missing]]\n<div>x</div>\n```\n`[[Also Missing]]`\n<!-- [[Hidden]] -->" }]);
  assert.equal(report.counts["broken-link"], 0);
  assert.equal(report.counts["html-leftover"], 0);
});

test("reports exact line numbers and only same-folder rename collisions", () => {
  const report = auditImport([
    { path: "Import/A/Project aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", basename: "Project aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", extension: "md", content: "first\nsecond\n[[Missing]]" },
    { path: "Import/B/Project bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md", basename: "Project bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", extension: "md", content: "" }
  ]);
  assert.equal(report.counts["duplicate-title"], 0);
  assert.equal(report.issues.find((issue) => issue.kind === "broken-link")?.line, 3);
});

test("does not flag links to present files", () => {
  const report = auditImport([
    { path: "Import/Home.md", basename: "Home", extension: "md", content: "[[Child]]\n![](files/image.png)" },
    { path: "Import/Child.md", basename: "Child", extension: "md", content: "" },
    { path: "Import/files/image.png", basename: "image", extension: "png" }
  ]);
  assert.equal(report.counts["broken-link"], 0);
  assert.equal(report.counts["missing-attachment"], 0);
});

test("uses the configured import root instead of inferring it from files", () => {
  const report = auditImport([{ path: "Import/A/Home.md", basename: "Home", extension: "md", content: "[x](../missing.md)" }], { selectedRoot: "Import" });
  assert.equal(report.counts["outside-folder-path"], 0);
  assert.equal(report.counts["broken-link"], 1);
});

test("preserves wiki links resolved outside the selected folder", () => {
  const report = auditImport([
    { path: "Import/Home.md", basename: "Home", extension: "md", content: "[[Foo]]" },
    { path: "Import/Foo.md", basename: "Foo", extension: "md", content: "" }
  ], { selectedRoot: "Import", resolveWikiLink: () => ({ status: "outside", path: "Archive/Foo.md" }) });
  assert.equal(report.counts["outside-folder-path"], 1);
  assert.equal(report.counts["broken-link"], 0);
});

test("flags ambiguous unqualified wiki links and ignores stray link punctuation", () => {
  const report = auditImport([
    { path: "Import/Home.md", basename: "Home", extension: "md", content: "](​NotALink.md)\n[[Foo]]" },
    { path: "Import/A/Foo.md", basename: "Foo", extension: "md", content: "" },
    { path: "Import/B/Foo.md", basename: "Foo", extension: "md", content: "" }
  ], { selectedRoot: "Import" });
  assert.equal(report.counts["ambiguous-link"], 1);
  assert.equal(report.counts["broken-link"], 0);
});

test("resolves wiki attachment embeds and classifies missing ones as files", () => {
  const report = auditImport([
    { path: "Import/Home.md", basename: "Home", extension: "md", content: "![[files/image.png|300]]\n![[missing.pdf#page=2]]" },
    { path: "Import/files/image.png", basename: "image", extension: "png" }
  ], { selectedRoot: "Import" });
  assert.equal(report.counts["broken-link"], 0);
  assert.equal(report.counts["missing-attachment"], 1);
});

test("trusts the supplied YAML validator for valid quoted keys", () => {
  const report = auditImport([{ path: "Import/Home.md", basename: "Home", extension: "md", content: "---\n\"Notion ID\": abc\n---\n" }], { selectedRoot: "Import", validateFrontmatter: () => true });
  assert.equal(report.counts["malformed-properties"], 0);
});

test("caps retained findings while preserving exact totals", () => {
  const content = Array.from({ length: 1000 }, (_, index) => `[[Missing ${index}]]`).join("\n");
  const report = auditImport([{ path: "Import/Home.md", basename: "Home", extension: "md", content }], { selectedRoot: "Import", maxDetailedIssues: 25 });
  assert.equal(report.issues.length, 25);
  assert.equal(report.totalIssues, 1000);
  assert.equal(report.counts["broken-link"], 1000);
  assert.equal(report.truncated, true);
});

test("supports metadata indexing and one-note-at-a-time content audits", () => {
  const inventory = [
    { path: "Import/Home aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", basename: "Home aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", extension: "md" },
    { path: "Import/Child.md", basename: "Child", extension: "md" }
  ];
  const index = createAuditIndex(inventory, "Import");
  const metadata = auditImport([], { index, inspectContent: false });
  const content = auditImport([{ ...inventory[0], content: "[[Child]]\n[[Missing]]" }], { index, inspectMetadata: false });
  assert.equal(metadata.counts["uuid-filename"], 1);
  assert.equal(content.counts["broken-link"], 1);
  assert.equal(content.counts["uuid-filename"], 0);
});

test("recovers from unmatched Markdown destinations without rescanning suffixes", () => {
  const content = "[x](".repeat(50_000);
  const started = performance.now();
  const report = auditImport([{ path: "Import/Home.md", basename: "Home", extension: "md", content }], { selectedRoot: "Import", maxDetailedIssues: 25 });
  assert.equal(report.totalIssues, 0);
  assert.ok(performance.now() - started < 1000, "unmatched destinations should be processed linearly");
});

test("balances retained details across issue categories", () => {
  const report = auditImport(Array.from({ length: 100 }, (_, index) => ({
    path: `Import/Note ${index} aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md`,
    basename: `Note ${index} aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    extension: "md",
    content: `[[Missing ${index}]]`
  })), { selectedRoot: "Import", maxDetailedIssues: 64, maxDetailsPerKind: 16 });
  assert.equal(report.counts["uuid-filename"], 100);
  assert.equal(report.counts["broken-link"], 100);
  assert.equal(report.issues.filter((issue) => issue.kind === "uuid-filename").length, 16);
  assert.equal(report.issues.filter((issue) => issue.kind === "broken-link").length, 16);
});
