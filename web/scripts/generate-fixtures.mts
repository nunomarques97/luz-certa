// Writes the deterministic synthetic fixtures to fixtures/synthetic/ (repository root).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFixtureSet, fixtureReadme } from '../src/testing/synthetic-fixtures.ts';

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/synthetic');
mkdirSync(outputDir, { recursive: true });

const files = buildFixtureSet();
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(outputDir, name), bytes);
  console.log(`${name} (${bytes.length} bytes)`);
}
writeFileSync(join(outputDir, 'README.md'), fixtureReadme());
console.log(`Wrote ${Object.keys(files).length} fixtures to ${outputDir}`);
