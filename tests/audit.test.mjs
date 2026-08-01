import assert from "node:assert/strict";
import test from "node:test";
import { auditImport } from "../src/audit.ts";

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
  assert.equal(report.counts["suspicious-path"], 1);
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
