# Import Doctor

Import Doctor audits folders produced by the official Obsidian Notion importer. The free scanner detects broken note links, missing attachments, Notion UUID filename suffixes, duplicate cleaned titles, malformed frontmatter, HTML leftovers, and unsafe paths.

## Status

Scanner-first development build. It does not mutate vault files yet. Pro licensing is wired using Vault Spotlight's offline Ed25519 verifier with the product ID `import-doctor`. Replace `PURCHASE_URL` in `src/license.ts` when the checkout page is ready.

## Development

```sh
npm install
npm test
npm run build
```

For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/import-doctor/`.
