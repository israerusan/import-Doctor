# Import Doctor

**Check your Notion import before cleanup.**

Find potential broken links, missing files, leftover Notion IDs, and formatting problems—without changing your vault. Import Doctor flags potential problems for you to review.

Choose your imported folder in Settings → Import Doctor, then run **Scan Notion import** from the Command Palette. Review the report; no files are changed.

## Why Import Doctor?

Obsidian’s importer brings Notion content into your vault. Import Doctor performs a read-only post-import check for unresolved links, missing files, leftover Notion IDs, filename conflicts, malformed properties, and residual HTML.

## Requirements

Requires Obsidian 1.5.0 or later on desktop. Mobile is not currently supported.

## Current scope

This preview supports folders created by Obsidian’s official Notion importer only. Import Doctor reads Markdown notes in the selected folder and indexes other files there to check whether referenced files exist.

Notes are audited one at a time on desktop, and an active scan can be cancelled from the Command Palette.

Each scan checks for:

- Broken note links and missing files
- Ambiguous note links that could match more than one note
- Notion ID suffixes in filenames
- Title collisions that would result from removing those IDs
- Properties blocks that may be malformed
- HTML that may be leftover from the import
- Links that leave the selected import folder (review recommended)

Detection is heuristic and may report false positives or miss unsupported patterns. Reports list the first 250 findings and show counts for all findings detected in the scan.

The preview limits a scan to 50,000 indexed files, 10,000 Markdown notes, 100 MB of Markdown content, and 2 MB per note. Split larger imports into smaller folders. Only one scan runs at a time, and it can be cancelled from the Command Palette.

## Privacy

Import Doctor reads note contents only from the folder you choose. Scanning and link checks run locally in Obsidian, and note contents are not uploaded.

## Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the [0.1.1 release](https://github.com/israerusan/import-Doctor/releases/tag/0.1.1). Place them in `<vault>/.obsidian/plugins/import-doctor/`, reload Obsidian, and enable Import Doctor under Community plugins.

## Build from source

```sh
npm install
npm test
npm run build
```

## Support and feedback

Report bugs, scan failures, or false positives in [GitHub Issues](https://github.com/israerusan/import-Doctor/issues). Include the Import Doctor version and Obsidian version. Do not attach private note contents; use a minimal redacted example.

## Roadmap

Batch repair is planned but is not currently sold. Planned features may change before release.
