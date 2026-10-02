// Validates catalogue/*.yaml and writes web/public/data/catalogue.json.
//   node scripts/catalogue/catalogue-cli.mts check   validate, and fail if catalogue.json is stale
//   node scripts/catalogue/catalogue-cli.mts build   validate, then write catalogue.json
// Options: --catalogue <dir>, --out <file>, --today <YYYY-MM-DD> (defaults suit the repository).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadCatalogue, serializeCatalogue } from './catalogue-files.mts';
import { validateCatalogue } from './validate-catalogue.mts';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    catalogue: { type: 'string', default: resolve(webDir, '../catalogue') },
    out: { type: 'string', default: resolve(webDir, 'public/data/catalogue.json') },
    today: { type: 'string', default: new Date().toISOString().slice(0, 10) },
  },
});
const command = positionals[0];

if (command !== 'check' && command !== 'build') {
  console.error('Usage: catalogue-cli.mts check|build [--catalogue <dir>] [--out <file>]');
  process.exit(2);
}

const loaded = await loadCatalogue(values.catalogue);
const result = validateCatalogue(loaded.input, { today: values.today });
const errors = [...loaded.errors, ...result.errors];
if (errors.length > 0 || result.catalogue === null) {
  console.error(
    `Catalogue is invalid (${errors.length} problem${errors.length === 1 ? '' : 's'}):`,
  );
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const catalogue = result.catalogue;
const json = serializeCatalogue(catalogue);
const outLabel = relative(process.cwd(), values.out) || values.out;
const fixed = catalogue.offers.filter((offer) => offer.pricing === 'fixed').length;
const summary =
  `catalogue ${catalogue.catalogue_version}: ${fixed} fixed + ${catalogue.offers.length - fixed} ` +
  `indexed offers, ${catalogue.access_tariffs.length} TAR periods`;

if (command === 'build') {
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, json);
  console.log(`Wrote ${outLabel} (${summary})`);
} else {
  let current: string | null = null;
  try {
    current = (await readFile(values.out, 'utf8')).replace(/\r\n/g, '\n');
  } catch {
    current = null;
  }
  if (current !== json) {
    console.error(`${outLabel} is missing or out of date: run npm run catalogue:build`);
    process.exit(1);
  }
  console.log(`OK ${summary}; ${outLabel} is up to date`);
}
