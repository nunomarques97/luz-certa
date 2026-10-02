import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  loadCatalogue,
  parseUnverified,
  parseYaml,
  serializeCatalogue,
} from './catalogue-files.mts';
import { validateCatalogue, type CatalogueInput } from './validate-catalogue.mts';

const here = dirname(fileURLToPath(import.meta.url));
const catalogueDir = resolve(here, '../../../catalogue');
const cliPath = resolve(here, 'catalogue-cli.mts');
const TODAY = '2026-10-02';
const run = promisify(execFile);

/** Parsed YAML, edited freely by the tests below. */
type Yaml = any;
interface EditableInput extends CatalogueInput {
  manifest: Yaml;
  sections: Yaml;
}

/** Fresh deep copy of the repository catalogue, so each test can break one thing. */
async function repositoryInput(): Promise<EditableInput> {
  const loaded = await loadCatalogue(catalogueDir);
  assert.deepEqual(loaded.errors, []);
  return {
    manifest: structuredClone(loaded.input.manifest),
    sections: structuredClone(loaded.input.sections),
    unverified: loaded.input.unverified,
  };
}

function errorsOf(input: CatalogueInput): string[] {
  const result = validateCatalogue(input, { today: TODAY });
  assert.equal(result.catalogue, null, 'an invalid catalogue must not be emitted');
  assert.ok(result.errors.length > 0);
  return result.errors;
}

function assertError(errors: string[], pattern: RegExp): void {
  assert.ok(
    errors.some((error) => pattern.test(error)),
    `expected an error matching ${pattern}, got:\n${errors.join('\n')}`,
  );
}

function offerIndex(input: EditableInput, id: string): number {
  const index = input.sections['offers'].offers.findIndex((offer: Yaml) => offer.id === id);
  assert.ok(index >= 0, `offer ${id} exists`);
  return index;
}

describe('repository catalogue', () => {
  it('is valid with 6 fixed (simple and bi-hourly) and 4 indexed offers', async () => {
    const result = validateCatalogue(await repositoryInput(), { today: TODAY });
    assert.deepEqual(result.errors, []);
    const catalogue = result.catalogue!;
    const fixed = catalogue.offers.filter((offer) => offer.pricing === 'fixed');
    const indexed = catalogue.offers.filter((offer) => offer.pricing === 'omie_indexed');
    assert.equal(fixed.length, 6);
    assert.equal(indexed.length, 4);
    assert.ok(fixed.filter((offer) => offer.tariff_type === 'simple').length >= 2);
    assert.ok(fixed.filter((offer) => offer.tariff_type === 'bi_hourly').length >= 2);
    for (const offer of catalogue.offers) {
      if (offer.tariff_type === 'bi_hourly')
        assert.ok(offer.cycle === 'daily' || offer.cycle === 'weekly');
      for (const kva of [3.45, 6.9, 10.35])
        assert.ok(offer.prices.some((price) => price.kva === kva));
    }
    const coopernico = indexed.find((offer) => offer.supplier === 'Coopérnico');
    assert.equal(coopernico?.formula?.k_eur_mwh, 9);
    assert.equal(coopernico?.formula?.multiplier, 1);
    assert.equal(coopernico?.formula?.includes_tar, true);
  });

  it('has TAR periods covering 2024, 2025 and 2026 and the required taxes and fees', async () => {
    const catalogue = validateCatalogue(await repositoryInput(), { today: TODAY }).catalogue!;
    const years = new Set(
      catalogue.access_tariffs.flatMap((p) => [p.valid_from.slice(0, 4), p.valid_to.slice(0, 4)]),
    );
    assert.deepEqual([...years].sort(), ['2024', '2025', '2026']);
    assert.deepEqual(catalogue.taxes.fees.map((fee) => fee.id).sort(), [
      'audiovisual_contribution',
      'dgeg',
      'iec',
    ]);
    assert.ok(catalogue.taxes.vat.rules.some((rule) => rule.kwh_per_30_days !== null));
  });

  it('matches the committed web/public/data/catalogue.json', async () => {
    const catalogue = validateCatalogue(await repositoryInput(), { today: TODAY }).catalogue!;
    const committed = await readFile(resolve(here, '../../public/data/catalogue.json'), 'utf8');
    assert.equal(committed.replace(/\r\n/g, '\n'), serializeCatalogue(catalogue));
  });
});

describe('validateCatalogue rejects', () => {
  it('an offer without source_url', async () => {
    const input = await repositoryInput();
    const i = offerIndex(input, 'edp-eletricidade-simple');
    delete input.sections['offers'].offers[i].source_url;
    assertError(
      errorsOf(input),
      new RegExp(`^offers\\.yaml\\.offers\\[${i}\\]\\.source_url: is required$`),
    );
  });

  it('a TAR period without source_url', async () => {
    const input = await repositoryInput();
    delete input.sections['access_tariffs'].periods[1].source_url;
    assertError(errorsOf(input), /^access-tariffs\.yaml\.periods\[1\]\.source_url: is required$/);
  });

  it('a source_url that is not an absolute https URL', async () => {
    for (const bad of ['http://www.erse.pt/x', 'erse.pt/tarifas', 'https://user:pw@erse.pt/', '']) {
      const input = await repositoryInput();
      input.sections['taxes'].fees[0].source_url = bad;
      assertError(errorsOf(input), /^taxes\.yaml\.fees\[0\]\.source_url: /);
    }
  });

  it('a bad verified_on date', async () => {
    for (const bad of ['2026-02-30', '02/10/2026', '2026-10-2', 20261002, null]) {
      const input = await repositoryInput();
      input.sections['offers'].offers[0].verified_on = bad;
      assertError(errorsOf(input), /^offers\.yaml\.offers\[0\]\.verified_on: must be an ISO date/);
    }
  });

  it('a verified_on date in the future', async () => {
    const input = await repositoryInput();
    input.sections['cycles'].verified_on = '2026-10-03';
    assertError(errorsOf(input), /^cycles\.yaml\.verified_on: must not be later than today/);
  });

  it('a bad TAR validity date', async () => {
    const input = await repositoryInput();
    input.sections['access_tariffs'].periods[0].valid_to = '2024-06-31';
    assertError(
      errorsOf(input),
      /^access-tariffs\.yaml\.periods\[0\]\.valid_to: must be an ISO date/,
    );
  });

  it('an overlapping TAR period', async () => {
    const input = await repositoryInput();
    const periods = input.sections['access_tariffs'].periods;
    periods[1].valid_from = '2024-05-15';
    assertError(
      errorsOf(input),
      new RegExp(`TAR period ${periods[1].id} overlaps ${periods[0].id}`),
    );
  });

  it('a duplicated TAR period covering the same dates', async () => {
    const input = await repositoryInput();
    const periods = input.sections['access_tariffs'].periods;
    periods.push({ ...structuredClone(periods.at(-1)), id: 'tar-copy' });
    assertError(errorsOf(input), /TAR period tar-copy overlaps/);
  });

  it('a gap between TAR periods', async () => {
    const input = await repositoryInput();
    input.sections['access_tariffs'].periods[1].valid_from = '2024-06-02';
    assertError(errorsOf(input), /gap between TAR periods/);
  });

  it('zero, negative or unit-mistaken prices', async () => {
    for (const bad of [0, -0.1, 167.1, '0.1671']) {
      const input = await repositoryInput();
      const i = offerIndex(input, 'edp-eletricidade-simple');
      input.sections['offers'].offers[i].prices[2].energy_eur_kwh.simple = bad;
      assertError(errorsOf(input), /prices\[2\]\.energy_eur_kwh\.simple: must be/);
    }
    const input = await repositoryInput();
    input.sections['access_tariffs'].periods[0].power_eur_day[0].eur_day = -1;
    assertError(
      errorsOf(input),
      /periods\[0\]\.power_eur_day\[0\]\.eur_day: must be greater than 0/,
    );
  });

  it('a price list without a required contracted power', async () => {
    const input = await repositoryInput();
    const prices = input.sections['offers'].offers[0].prices;
    prices.splice(
      prices.findIndex((price: Yaml) => price.kva === 6.9),
      1,
    );
    assertError(errorsOf(input), /^offers\.yaml\.offers\[0\]\.prices: must include 6\.9 kVA$/);
  });

  it('a wrong number of fixed or indexed offers', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers.splice(offerIndex(input, 'meo-energia-fixa-dd-fe-simple'), 1);
    const errors = errorsOf(input);
    assertError(errors, /must have exactly 6 fixed offers, found 5/);

    const extra = await repositoryInput();
    const offers = extra.sections['offers'].offers;
    offers.push({
      ...structuredClone(offers[offerIndex(extra, 'goldenergy-index-04-25-simple')]),
      id: 'zz-extra',
    });
    assertError(errorsOf(extra), /must have exactly 4 indexed offers, found 5/);
  });

  it('a bi-hourly offer without an ERSE cycle', async () => {
    const input = await repositoryInput();
    const i = offerIndex(input, 'ezu-premium-bi-hourly');
    delete input.sections['offers'].offers[i].cycle;
    assertError(
      errorsOf(input),
      new RegExp(`offers\\[${i}\\]\\.cycle: must be one of daily, weekly`),
    );
  });

  it('sponsorship, affiliate and ranking fields', async () => {
    for (const key of ['sponsored', 'affiliate_url', 'rank']) {
      const input = await repositoryInput();
      input.sections['offers'].offers[0][key] = true;
      assertError(errorsOf(input), new RegExp(`offers\\[0\\]\\.${key}: is not allowed`));
    }
  });

  it('offers out of id order, so list order can never act as a ranking', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers.reverse();
    assertError(errorsOf(input), /offers must be sorted by id/);
  });

  it('an indexed formula written as an expression string', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers[0].formula = '(OMIE + 9) * 1.15 + TAR';
    assertError(errorsOf(input), /^offers\.yaml\.offers\[0\]\.formula: must be a mapping$/);
  });

  it('an indexed formula that does not add the TAR', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers[0].formula.includes_tar = false;
    assertError(errorsOf(input), /formula\.includes_tar: must be true/);
  });

  it('an unpublished loss factor given as a number, or a null one marked as published', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers[0].formula.loss_factor.value_kind = 'unpublished';
    assertError(
      errorsOf(input),
      /loss_factor\.value_kind: cannot be unpublished when a value is given/,
    );

    const nullValue = await repositoryInput();
    nullValue.sections['offers'].offers[0].formula.loss_factor.value = null;
    assertError(
      errorsOf(nullValue),
      /loss_factor\.value: may be null only when value_kind is unpublished/,
    );
  });

  it('a reference to an id missing from UNVERIFIED.md', async () => {
    const input = await repositoryInput();
    input.sections['offers'].offers[0].unverified = ['U999'];
    assertError(errorsOf(input), /offers\[0\]\.unverified\[0\]: U999 is not described/);
  });

  it('a wrong schema_version or catalogue_version', async () => {
    const input = await repositoryInput();
    input.manifest['schema_version'] = 2;
    input.manifest['catalogue_version'] = '2026-10-02';
    const errors = errorsOf(input);
    assertError(errors, /^catalogue\.yaml\.schema_version: must be 1$/);
    assertError(
      errors,
      /^catalogue\.yaml\.catalogue_version: must be a date written as YYYY\.MM\.DD$/,
    );
  });

  it('a missing section', async () => {
    const input = await repositoryInput();
    delete input.sections['taxes'];
    assertError(errorsOf(input), /^taxes: section is missing$/);
  });
});

describe('YAML and UNVERIFIED.md loading', () => {
  it('rejects duplicate keys and aliases, and keeps dates as strings', () => {
    const errors: string[] = [];
    assert.equal(parseYaml('a: 1\na: 2\n', 'dup.yaml', errors), undefined);
    assert.equal(errors.length, 1);
    const aliasErrors: string[] = [];
    assert.equal(parseYaml('a: &x [1]\nb: *x\n', 'alias.yaml', aliasErrors), undefined);
    assert.equal(aliasErrors.length, 1);
    assert.deepEqual(parseYaml('d: 2026-10-02\n', 'date.yaml', []), { d: '2026-10-02' });
  });

  it('reads UNVERIFIED.md headings and flags duplicate ids', () => {
    const errors: string[] = [];
    const entries = parseUnverified(
      '# T\n\n## U1 First\ntext\n## U2 Second\n## U1 Again\n',
      errors,
    );
    assert.deepEqual([...entries.keys()], ['U1', 'U2']);
    assert.equal(errors.length, 1);
  });
});

describe('catalogue-cli', () => {
  async function brokenCopy(edit: (offers: string) => string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'catalogue-test-'));
    await cp(catalogueDir, dir, { recursive: true });
    const offersPath = join(dir, 'offers.yaml');
    await writeFile(offersPath, edit(await readFile(offersPath, 'utf8')));
    return dir;
  }

  it('check exits non-zero and names the problem for an invalid catalogue', async () => {
    const dir = await brokenCopy((text) => text.replace(/^ {4}source_url: .*\r?\n/m, ''));
    await assert.rejects(
      run(process.execPath, [cliPath, 'check', '--catalogue', dir, '--today', TODAY]),
      (error: { code?: number; stderr?: string }) =>
        error.code === 1 && /offers\[0\]\.source_url: is required/.test(error.stderr ?? ''),
    );
  });

  it('build writes JSON that check then accepts', async () => {
    const dir = await brokenCopy((text) => text);
    const out = join(dir, 'out', 'catalogue.json');
    const options = ['--catalogue', dir, '--out', out, '--today', TODAY];
    await assert.rejects(run(process.execPath, [cliPath, 'check', ...options]), { code: 1 });
    await run(process.execPath, [cliPath, 'build', ...options]);
    const { stdout } = await run(process.execPath, [cliPath, 'check', ...options]);
    assert.match(stdout, /6 fixed \+ 4 indexed offers/);
    assert.equal(JSON.parse(await readFile(out, 'utf8')).schema_version, 1);
  });
});
