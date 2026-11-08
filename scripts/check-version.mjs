#!/usr/bin/env node
// Checks that the version is consistent: .claude-plugin/plugin.json is the single source of truth, and
// CHANGELOG.md must have a "## [X.Y.Z] - YYYY-MM-DD" section for it. marketplace.json must not carry a different version.
// Usage: node scripts/check-version.mjs [--tag v1.2.3]   (with --tag the tag must equal v<version>; use it in release CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const errors = [];

const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
const version = plugin.version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
if (!semver.test(version ?? '')) errors.push(`plugin.json: version "${version}" is not valid SemVer (MAJOR.MINOR.PATCH)`);

const market = JSON.parse(read('.claude-plugin/marketplace.json'));
for (const p of market.plugins ?? []) {
  if (p.version && p.version !== version) errors.push(`marketplace.json: plugin "${p.name}" has version ${p.version}, plugin.json has ${version}`);
}

const changelog = read('CHANGELOG.md');
const BS = String.fromCharCode(92);
const esc = String(version).replace(/[.+]/g, (c) => BS + c);
const heading = new RegExp("^## " + BS + "[" + esc + BS + "] - " + BS + "d{4}-" + BS + "d{2}-" + BS + "d{2}" + BS + "s*$", "m");
if (!heading.test(changelog)) {
  errors.push(`CHANGELOG.md: no "## [${version}] - YYYY-MM-DD" section`);
}
if (!/^## \[Unreleased\]\s*$/m.test(changelog)) errors.push('CHANGELOG.md: no "## [Unreleased]" section');

const i = process.argv.indexOf('--tag');
if (i > 0 && process.argv[i + 1] !== `v${version}`) errors.push(`tag "${process.argv[i + 1]}" does not match v${version}`);

if (errors.length) { for (const e of errors) console.error(`check-version: ${e}`); process.exit(1); }
console.log(`check-version: OK (${version})`);
