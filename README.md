# Import Doctor

**Check your Notion import before cleanup.**

Find potential broken links, missing files, leftover Notion IDs, and formatting problems—without changing your vault. Import Doctor flags potential problems for you to review.

Choose your imported folder in Settings → Import Doctor, then run **Scan Notion import** from the Command Palette. Review the report; no files are changed.

## Current scope

This preview supports folders created by Obsidian’s official Notion importer only. Import Doctor reads Markdown notes in the selected folder and indexes other files there to check whether referenced files exist.

The current scanner is desktop-only while incremental scanning, progress, and cancellation are developed for large mobile vaults.

Each scan checks for:

- Broken note links and missing files
- Ambiguous note links that could match more than one note
- Notion ID suffixes in filenames
- Title collisions that would result from removing those IDs
- Properties blocks that may be malformed
- HTML that may be leftover from the import
- Links that leave the selected import folder (review recommended)

Detection is heuristic and may report false positives or miss unsupported patterns. Reports list the first 250 findings and show counts for all findings detected in the scan.

## Pro status

Batch repair is in development and is not currently sold. Pro is planned to add reviewed batch repairs, filename-conflict handling, a change log, and recovery tools. Features may change before release.

## Privacy

Import Doctor reads note contents only from the folder you choose. Scanning and link checks run locally in Obsidian, and note contents are not uploaded.

## Development

```sh
npm install
npm test
npm run build
```

For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/import-doctor/`.
