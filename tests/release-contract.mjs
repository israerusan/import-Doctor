import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

assert.equal(packageJson.version, manifest.version, "package and manifest versions must match");
assert.equal(versions[manifest.version], manifest.minAppVersion, "versions.json must contain the release version");
await Promise.all(["main.js", "manifest.json", "styles.css"].map((path) => access(path)));
console.log(`Release contract ${manifest.version}: versions consistent; artifacts present.`);
