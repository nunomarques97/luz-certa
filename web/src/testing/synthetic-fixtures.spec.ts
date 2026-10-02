import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { unzipSync } from 'fflate';

import { FIXTURE_FILES, YEAR_LEAK_NEEDLES, buildFixtureSet, fixtureReadme, lisbonQuarterLabels } from './synthetic-fixtures';

const FIXTURE_DIR = resolve(process.cwd(), '../fixtures/synthetic');

describe('synthetic fixtures', () => {
  it('are deterministic and match the committed files byte for byte', () => {
    const first = buildFixtureSet();
    const second = buildFixtureSet();
    expect(Object.keys(first).sort()).toEqual(Object.values(FIXTURE_FILES).sort());
    for (const [name, bytes] of Object.entries(first)) {
      expect(Buffer.from(second[name]).equals(Buffer.from(bytes)), name).toBe(true);
      const onDisk = readFileSync(join(FIXTURE_DIR, name));
      expect(onDisk.equals(Buffer.from(bytes)), `${name} is stale: run npm run fixtures`).toBe(true);
    }
    expect(readFileSync(join(FIXTURE_DIR, 'README.md'), 'utf8')).toBe(fixtureReadme());
  });

  it('are the only files in fixtures/synthetic (no real consumption data)', () => {
    const allowed = new Set([...Object.values(FIXTURE_FILES), 'README.md', '.gitkeep']);
    expect(readdirSync(FIXTURE_DIR).filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('hold the privacy leak needles in the year file marker row only', () => {
    expect(YEAR_LEAK_NEEDLES).toEqual(['9,871', '9,872', '9,873', '9,874', '9.871', '9.872', '9.873', '9.874']);
    for (const [name, bytes] of Object.entries(buildFixtureSet())) {
      let text: string;
      try {
        text = Object.values(unzipSync(bytes)).map((entry) => new TextDecoder().decode(entry)).join('\n');
      } catch {
        text = new TextDecoder().decode(bytes);
      }
      for (const needle of YEAR_LEAK_NEEDLES) {
        const count = text.split(needle).length - 1;
        // The 10-column layout writes each reading in both consumption columns.
        const expected = name === FIXTURE_FILES.year && needle.includes(',') ? 2 : 0;
        expect(count, `${needle} in ${name}`).toBe(expected);
      }
    }
  });

  it('label quarter-hours by interval end with 92 and 100 quarters on DST days', () => {
    const spring = lisbonQuarterLabels('2025-03-30', '2025-03-31');
    expect(spring).toHaveLength(92);
    expect(spring.slice(2, 6).map((l) => l.time)).toEqual(['00:45', '01:00', '02:15', '02:30']);
    const autumn = lisbonQuarterLabels('2025-10-26', '2025-10-27');
    expect(autumn).toHaveLength(100);
    expect(autumn.slice(3, 12).map((l) => l.time)).toEqual(['01:00', '01:15', '01:30', '01:45', '02:00', '01:15', '01:30', '01:45', '02:00']);
    expect(autumn[autumn.length - 1]).toMatchObject({ date: '2025/10/27', time: '00:00' });
  });
});
