import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import type { Catalogue } from './catalogue-types.mts';
import { SECTION_NAMES, type CatalogueInput, type SectionName } from './validate-catalogue.mts';

/** Reads the catalogue YAML files and UNVERIFIED.md; YAML is parsed here, never in the browser. */

export const MANIFEST_FILE = 'catalogue.yaml';
export const UNVERIFIED_FILE = 'UNVERIFIED.md';
const SECTION_FILE = /^[a-z0-9-]+\.yaml$/;
const MAX_FILE_BYTES = 1024 * 1024;
const UNVERIFIED_HEADING = /^## (U\d+) (.+)$/gm;

export interface LoadResult {
  input: CatalogueInput;
  errors: string[];
}

/**
 * Parses YAML with the core schema only: duplicate keys, unknown tags and aliases are errors,
 * and dates stay plain strings.
 */
export function parseYaml(text: string, file: string, errors: string[]): unknown {
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, merge: false });
  const problems = [...doc.errors, ...doc.warnings];
  for (const problem of problems) errors.push(`${file}: ${problem.message}`);
  if (problems.length > 0) return undefined;
  try {
    return doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Ids and titles of the "## U<n> title" headings in UNVERIFIED.md. */
export function parseUnverified(markdown: string, errors: string[]): Map<string, string> {
  const entries = new Map<string, string>();
  for (const match of markdown.matchAll(UNVERIFIED_HEADING)) {
    const [, id, title] = match;
    if (entries.has(id)) errors.push(`${UNVERIFIED_FILE}: ${id} is defined twice`);
    entries.set(id, title.trim());
  }
  return entries;
}

async function readText(path: string, file: string, errors: string[]): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_FILE_BYTES) {
      errors.push(`${file}: larger than ${MAX_FILE_BYTES} bytes`);
      return null;
    }
    return await readFile(path, 'utf8');
  } catch {
    errors.push(`${file}: cannot be read`);
    return null;
  }
}

export async function loadCatalogue(directory: string): Promise<LoadResult> {
  const errors: string[] = [];
  const manifestText = await readText(join(directory, MANIFEST_FILE), MANIFEST_FILE, errors);
  const manifest =
    manifestText === null ? undefined : parseYaml(manifestText, MANIFEST_FILE, errors);
  const unverifiedText = await readText(join(directory, UNVERIFIED_FILE), UNVERIFIED_FILE, errors);
  const unverified = parseUnverified(unverifiedText ?? '', errors);

  const sections: Partial<Record<SectionName, unknown>> = {};
  const files =
    typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>)['sections']
      : undefined;
  for (const name of SECTION_NAMES) {
    const file =
      typeof files === 'object' && files !== null
        ? (files as Record<string, unknown>)[name]
        : undefined;
    // Only plain file names inside the catalogue directory; the validator reports anything else.
    if (typeof file !== 'string' || !SECTION_FILE.test(file)) continue;
    const text = await readText(join(directory, file), file, errors);
    if (text !== null) sections[name] = parseYaml(text, file, errors);
  }
  return { input: { manifest, sections, unverified }, errors };
}

/** Deterministic JSON for web/public/data/catalogue.json. */
export function serializeCatalogue(catalogue: Catalogue): string {
  return `${JSON.stringify(catalogue, null, 2)}\n`;
}
