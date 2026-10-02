#!/usr/bin/env node
// Checks the project documents. Exits 1 when a rule is broken, 2 on bad usage.
//   node scripts/check-docs.mjs                 check the repository
//   node scripts/check-docs.mjs --root <dir>    check another tree (used by the self-test)
//   node scripts/check-docs.mjs --self-test     prove that every rule detects its failure
// Rules:
//   1. docs/STATE.md starts with YAML front-matter holding non-empty status, sponsor_action,
//      kill_review (with a YYYY-MM-DD date) and success_metric.
//   2. docs/WALKTHROUGH.md has at most 900 words (about two printed pages).
//   3. No em-dash (the character, an HTML entity or a — escape) in the READMEs, CONTRIBUTING.md,
//      DESIGN.md, docs/*.md, catalogue/ or web/src/.
// No dependencies, so it runs before `npm ci`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');

const REQUIRED_STATE_KEYS = ['status', 'sponsor_action', 'kill_review', 'success_metric'];
const WALKTHROUGH_MAX_WORDS = 900;

const EM_DASH_FILES = ['README.md', 'CONTRIBUTING.md', 'DESIGN.md', 'web/README.md', 'jobs/omie-prices/README.md', 'fixtures/synthetic/README.md'];
const EM_DASH_DIRS = [
  { dir: 'docs', recursive: false, extensions: ['.md'] },
  { dir: 'catalogue', recursive: true, extensions: ['.yaml', '.yml', '.md', '.json'] },
  { dir: 'web/src', recursive: true, extensions: ['.html', '.ts', '.css', '.scss', '.json', '.md'] },
];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.angular']);
const EM_DASH = /—|&mdash;|&#8212;|&#x0*2014;|\\u2014|\\u\{0*2014\}|\\x\{2014\}/gi;

/** Top-level keys of a simple YAML block; a key with an empty inline value takes its indented lines. */
function frontMatterKeys(yaml) {
  const keys = new Map();
  let current = null;
  for (const line of yaml.split('\n')) {
    const key = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (key) {
      current = key[1];
      keys.set(current, key[2].trim());
    } else if (current !== null && /^\s+\S/.test(line)) {
      keys.set(current, `${keys.get(current)} ${line.trim()}`.trim());
    } else if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
      current = null;
    }
  }
  return keys;
}

function checkState(root, errors) {
  const path = join(root, 'docs/STATE.md');
  if (!existsSync(path)) {
    errors.push('docs/STATE.md: file is missing');
    return;
  }
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text);
  if (!match) {
    errors.push('docs/STATE.md: no YAML front-matter (the file must start with a --- block)');
    return;
  }
  const keys = frontMatterKeys(match[1]);
  for (const key of REQUIRED_STATE_KEYS) {
    const value = keys.get(key);
    if (value === undefined) {
      errors.push(`docs/STATE.md: front-matter is missing "${key}"`);
    } else if (value === '' || value === '""' || value === "''" || value === 'null' || value === '~') {
      errors.push(`docs/STATE.md: front-matter "${key}" is empty`);
    }
  }
  const killReview = keys.get('kill_review');
  if (killReview && !/\b\d{4}-\d{2}-\d{2}\b/.test(killReview)) {
    errors.push('docs/STATE.md: front-matter "kill_review" has no YYYY-MM-DD date');
  }
}

/** Words a reader sees: link targets, code fence markers and table pipes are not words. */
function countWords(markdown) {
  const visible = markdown
    .replace(/\r\n/g, '\n')
    .replace(/^```.*$/gm, '')
    .replace(/(!?\[[^\]]*\])\([^)]*\)/g, '$1');
  return visible.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function checkWalkthrough(root, errors) {
  const path = join(root, 'docs/WALKTHROUGH.md');
  if (!existsSync(path)) {
    errors.push('docs/WALKTHROUGH.md: file is missing');
    return;
  }
  const words = countWords(readFileSync(path, 'utf8'));
  if (words > WALKTHROUGH_MAX_WORDS) {
    errors.push(`docs/WALKTHROUGH.md: ${words} words, the limit is ${WALKTHROUGH_MAX_WORDS}`);
  }
}

function listFiles(dir, recursive, extensions) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !SKIPPED_DIRS.has(entry.name)) files.push(...listFiles(path, true, extensions));
    } else if (extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function checkEmDashes(root, errors) {
  const files = [
    ...EM_DASH_FILES.map((file) => join(root, file)).filter((path) => existsSync(path)),
    ...EM_DASH_DIRS.flatMap(({ dir, recursive, extensions }) => listFiles(join(root, dir), recursive, extensions)),
  ];
  for (const path of files.sort()) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(EM_DASH)) {
        const name = relative(root, path).replaceAll('\\', '/');
        errors.push(`${name}:${index + 1}:${match.index + 1}: em-dash "${match[0]}", use a comma, colon or full stop`);
      }
    });
  }
}

function checkDocs(root) {
  const errors = [];
  checkState(root, errors);
  checkWalkthrough(root, errors);
  checkEmDashes(root, errors);
  return errors;
}

// ---- Self-test ------------------------------------------------------------------------------

const VALID_STATE = [
  '---',
  'status: v0.1 ready for Sponsor review',
  'sponsor_action: Run the app and upload your own file.',
  'kill_review:',
  '  date: 2027-02-15',
  '  criterion: Fewer than 20 people used it.',
  'success_metric: 50 households compare offers in January.',
  '---',
  '',
  '# State',
  '',
].join('\n');

function words(count) {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
}

function writeTree(root, overrides) {
  const files = {
    'README.md': '# Project\n\nPlain text, with a hyphen - and an en dash – only.\n',
    'CONTRIBUTING.md': '# Contributing\n',
    'docs/STATE.md': VALID_STATE,
    // Exactly at the limit: 1 heading word, the generated words and 2 link-text words.
    'docs/WALKTHROUGH.md': `# Walkthrough\n\n${words(WALKTHROUGH_MAX_WORDS - 3)}\n\n[link text](https://example.org/a/long/path/that/is/not/counted)\n`,
    'docs/OTHER.md': 'Other notes.\n',
    'catalogue/offers.yaml': 'offers: []\n',
    'web/src/app/page.html': '<p>Texto</p>\n',
    'web/src/app/copy.ts': "export const copy = 'Texto';\n",
    // Outside the checked set: an em-dash here must not fail.
    'docs/ui/notes.md': 'Prototype note — not checked.\n',
    'web/node_modules/pkg/index.ts': '// —\n',
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

const withoutKey = (key) => VALID_STATE.replace(new RegExp(`^${key}:.*\\n(  .*\\n)*`, 'm'), '');

const SELF_TEST_CASES = [
  { name: 'valid tree passes', files: {}, expect: null },
  { name: 'walkthrough at exactly the limit passes', files: { 'docs/WALKTHROUGH.md': words(WALKTHROUGH_MAX_WORDS) }, expect: null },
  { name: 'STATE.md missing', files: { 'docs/STATE.md': null }, expect: /docs\/STATE\.md: file is missing/ },
  { name: 'STATE.md without front-matter', files: { 'docs/STATE.md': '# State\n\nstatus: ok\n' }, expect: /no YAML front-matter/ },
  ...REQUIRED_STATE_KEYS.map((key) => ({
    name: `STATE.md front-matter missing ${key}`,
    files: { 'docs/STATE.md': withoutKey(key) },
    expect: new RegExp(`front-matter is missing "${key}"`),
  })),
  { name: 'STATE.md empty key', files: { 'docs/STATE.md': VALID_STATE.replace(/^status:.*$/m, 'status: ""') }, expect: /"status" is empty/ },
  {
    name: 'STATE.md kill_review without a date',
    files: { 'docs/STATE.md': VALID_STATE.replace('  date: 2027-02-15\n', '') },
    expect: /"kill_review" has no YYYY-MM-DD date/,
  },
  { name: 'STATE.md with CRLF line endings passes', files: { 'docs/STATE.md': VALID_STATE.replace(/\n/g, '\r\n') }, expect: null },
  { name: 'WALKTHROUGH.md missing', files: { 'docs/WALKTHROUGH.md': null }, expect: /docs\/WALKTHROUGH\.md: file is missing/ },
  {
    name: 'WALKTHROUGH.md over the limit',
    files: { 'docs/WALKTHROUGH.md': words(WALKTHROUGH_MAX_WORDS + 1) },
    expect: new RegExp(`${WALKTHROUGH_MAX_WORDS + 1} words, the limit is ${WALKTHROUGH_MAX_WORDS}`),
  },
  { name: 'em-dash in README.md', files: { 'README.md': 'Fast — private.\n' }, expect: /README\.md:1:6: em-dash/ },
  { name: 'em-dash in CONTRIBUTING.md', files: { 'CONTRIBUTING.md': 'a\nb — c\n' }, expect: /CONTRIBUTING\.md:2:3: em-dash/ },
  { name: 'em-dash in docs/*.md', files: { 'docs/OTHER.md': 'x — y\n' }, expect: /docs\/OTHER\.md:1:3: em-dash/ },
  { name: 'em-dash in docs/STATE.md body', files: { 'docs/STATE.md': `${VALID_STATE}Done — mostly.\n` }, expect: /docs\/STATE\.md:\d+:\d+: em-dash/ },
  { name: 'em-dash in catalogue YAML', files: { 'catalogue/offers.yaml': 'name: "A — B"\n' }, expect: /catalogue\/offers\.yaml:1:\d+: em-dash/ },
  { name: 'em-dash in nested catalogue file', files: { 'catalogue/sub/notes.md': '—\n' }, expect: /catalogue\/sub\/notes\.md:1:1: em-dash/ },
  { name: 'em-dash in web/src template', files: { 'web/src/app/page.html': '<p>Texto — mais</p>\n' }, expect: /web\/src\/app\/page\.html:1:\d+: em-dash/ },
  { name: '&mdash; entity in web/src template', files: { 'web/src/app/page.html': '<p>a &mdash; b</p>\n' }, expect: /page\.html:1:\d+: em-dash "&mdash;"/ },
  { name: 'numeric entity in web/src template', files: { 'web/src/app/page.html': '<p>a &#x2014; b</p>\n' }, expect: /page\.html:1:\d+: em-dash "&#x2014;"/ },
  { name: 'escaped em-dash in web/src TypeScript', files: { 'web/src/app/copy.ts': "export const copy = 'a \\u2014 b';\n" }, expect: /copy\.ts:1:\d+: em-dash/ },
];

function runSelfTest() {
  const base = mkdtempSync(join(tmpdir(), 'check-docs-'));
  let failures = 0;
  SELF_TEST_CASES.forEach((testCase, index) => {
    const root = join(base, String(index));
    writeTree(root, testCase.files);
    const run = spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    const ok = testCase.expect === null ? run.status === 0 : run.status === 1 && testCase.expect.test(output);
    if (!ok) failures += 1;
    const detail = ok ? '' : `\n    exit ${run.status}, output:\n    ${output.trim().replace(/\n/g, '\n    ')}`;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${testCase.name}${detail}`);
  });
  console.log(`${SELF_TEST_CASES.length - failures}/${SELF_TEST_CASES.length} self-test cases passed`);
  if (failures > 0) {
    console.log(`Test trees kept in ${base}`);
    return 1;
  }
  rmSync(base, { recursive: true, force: true });
  return 0;
}

// ---- CLI ------------------------------------------------------------------------------------

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: { root: { type: 'string' }, 'self-test': { type: 'boolean', default: false } },
    }));
  } catch (error) {
    console.error(`${error.message}\nUsage: node scripts/check-docs.mjs [--root <dir>] [--self-test]`);
    return 2;
  }
  if (values['self-test']) return runSelfTest();

  const root = resolve(values.root ?? repositoryRoot);
  const errors = checkDocs(root);
  if (errors.length > 0) {
    console.error(`Documentation check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`OK documentation: STATE.md front-matter, WALKTHROUGH.md length, no em-dashes (${root})`);
  return 0;
}

process.exitCode = main();
