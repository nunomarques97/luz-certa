import { ConsumptionParseError } from './parse-errors';
import { DecompressionBudget, ZipEntry, extractZipEntry, hasZipSignature, readZipDirectory } from './zip-reader';

/**
 * Reads the first worksheet of an .xlsx file into plain cell values. It understands shared
 * strings, inline strings, formula string results, numbers and booleans.
 *
 * The XML is read by a single forward scan (see scanXml), so the time spent is linear in the
 * size of the text even for crafted input such as thousands of unclosed tags. Text is decoded
 * entity by entity; nothing from the file is executed and DOCTYPE declarations (custom
 * entities) are rejected. Only the first MAX_STORED_COLUMNS columns are kept, so a cell placed
 * at a far column cannot make a row allocate thousands of slots.
 */

export type CellValue = string | number | boolean | null;

export interface SheetRow {
  /** 1-based row number as stored in the sheet. */
  rowNumber: number;
  /** Cell values by 0-based column index, up to MAX_STORED_COLUMNS; holes are null. */
  cells: CellValue[];
}

export interface Worksheet {
  rows: SheetRow[];
  /** True when the workbook uses the 1904 date system. */
  date1904: boolean;
}

export interface SheetReadLimits {
  maxDecompressedBytes: number;
  maxRows: number;
}

/** Highest column count a worksheet may reference (Excel limit, column XFD). */
const MAX_COLUMNS = 16_384;
/** Cells beyond this column are validated but not stored. The E-Redes export uses 10 columns. */
export const MAX_STORED_COLUMNS = 64;

const OFFICE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

const decoder = new TextDecoder('utf-8', { fatal: true });

function malformed(): ConsumptionParseError {
  return new ConsumptionParseError('MALFORMED_XLSX');
}

function readXml(bytes: Uint8Array, entry: ZipEntry, budget: DecompressionBudget): string {
  const data = extractZipEntry(bytes, entry, budget);
  let text: string;
  try {
    text = decoder.decode(data);
  } catch {
    throw malformed();
  }
  if (/<!DOCTYPE/i.test(text)) {
    throw malformed();
  }
  return text;
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlText(raw: string): string {
  if (raw.indexOf('&') < 0) {
    return raw;
  }
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
  });
}

// ---------------------------------------------------------------------------
// Forward XML scanner
// ---------------------------------------------------------------------------

/** Raw (still entity-encoded) attribute values by local name; namespace declarations are dropped. */
type XmlAttributes = ReadonlyMap<string, string>;

interface XmlEvents {
  /** Element start by local name. A self-closing element is followed by end() at once. */
  start(name: string, attributes: XmlAttributes): void;
  end(name: string): void;
  /** Character data between start and end (exclusive); CDATA content is passed undecoded. */
  text(xml: string, start: number, end: number, cdata: boolean): void;
}

const NO_ATTRIBUTES: XmlAttributes = new Map();

function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon < 0 ? qualified : qualified.slice(colon + 1);
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Name characters end at whitespace, ">", "/", "=" or "<". */
function isNameEnd(code: number): boolean {
  return isSpace(code) || code === 0x3e || code === 0x2f || code === 0x3d || code === 0x3c;
}

/** Index just past `terminator`, searching from `from`; rejects text that never closes. */
function indexAfter(xml: string, terminator: string, from: number): number {
  const index = xml.indexOf(terminator, from);
  if (index < 0) {
    throw malformed();
  }
  return index + terminator.length;
}

/** Reads a start tag whose name begins at `position`. Returns the index after its '>'. */
function readStartTag(xml: string, position: number, events: XmlEvents): number {
  let i = position;
  while (i < xml.length && !isNameEnd(xml.charCodeAt(i))) {
    i++;
  }
  if (i === position) {
    throw malformed();
  }
  const name = localName(xml.slice(position, i));
  let attributes = NO_ATTRIBUTES;
  for (;;) {
    while (i < xml.length && isSpace(xml.charCodeAt(i))) {
      i++;
    }
    const code = xml.charCodeAt(i);
    if (code === 0x3e) {
      events.start(name, attributes);
      return i + 1;
    }
    if (code === 0x2f) {
      if (xml.charCodeAt(i + 1) !== 0x3e) {
        throw malformed();
      }
      events.start(name, attributes);
      events.end(name);
      return i + 2;
    }
    const nameStart = i;
    while (i < xml.length && !isNameEnd(xml.charCodeAt(i))) {
      i++;
    }
    const attributeName = xml.slice(nameStart, i);
    while (i < xml.length && isSpace(xml.charCodeAt(i))) {
      i++;
    }
    if (attributeName === '' || xml.charCodeAt(i) !== 0x3d) {
      throw malformed();
    }
    i++;
    while (i < xml.length && isSpace(xml.charCodeAt(i))) {
      i++;
    }
    const quote = xml[i];
    if (quote !== '"' && quote !== "'") {
      throw malformed();
    }
    const valueEnd = indexAfter(xml, quote, i + 1);
    const isNamespace = attributeName === 'xmlns' || attributeName.startsWith('xmlns:');
    const key = localName(attributeName);
    if (!isNamespace && !attributes.has(key)) {
      if (attributes === NO_ATTRIBUTES) {
        attributes = new Map();
      }
      (attributes as Map<string, string>).set(key, xml.slice(i + 1, valueEnd - 1));
    }
    i = valueEnd;
  }
}

/**
 * Walks the XML once from start to end. Every step moves forward past the construct it read,
 * and an unterminated construct is rejected instead of being searched for again.
 */
function scanXml(xml: string, events: XmlEvents): void {
  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf('<', position);
    if (open < 0) {
      events.text(xml, position, xml.length, false);
      return;
    }
    if (open > position) {
      events.text(xml, position, open, false);
    }
    const next = xml.charCodeAt(open + 1);
    if (xml.startsWith('<!--', open)) {
      position = indexAfter(xml, '-->', open + 4);
    } else if (xml.startsWith('<![CDATA[', open)) {
      position = indexAfter(xml, ']]>', open + 9);
      events.text(xml, open + 9, position - 3, true);
    } else if (next === 0x3f) {
      position = indexAfter(xml, '?>', open + 2);
    } else if (next === 0x21) {
      throw malformed();
    } else if (next === 0x2f) {
      position = indexAfter(xml, '>', open + 2);
      events.end(localName(xml.slice(open + 2, position - 1).trim()));
    } else {
      position = readStartTag(xml, open + 1, events);
    }
  }
}

function attribute(attributes: XmlAttributes, name: string): string | null {
  const raw = attributes.get(name);
  return raw === undefined ? null : decodeXmlText(raw);
}

function decodedText(xml: string, start: number, end: number, cdata: boolean): string {
  const raw = xml.slice(start, end);
  return cdata ? raw : decodeXmlText(raw);
}

// ---------------------------------------------------------------------------
// Workbook parts
// ---------------------------------------------------------------------------

function resolveTarget(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function readRelationships(xml: string): Map<string, { type: string; target: string }> {
  const relationships = new Map<string, { type: string; target: string }>();
  scanXml(xml, {
    start(name, attributes) {
      if (name !== 'Relationship') {
        return;
      }
      const id = attribute(attributes, 'Id');
      const type = attribute(attributes, 'Type');
      const target = attribute(attributes, 'Target');
      if (id && type && target && !relationships.has(id)) {
        relationships.set(id, { type, target });
      }
    },
    end() {},
    text() {},
  });
  return relationships;
}

function readWorkbook(xml: string): { sheetRelationshipId: string | null; date1904: boolean } {
  let sheetRelationshipId: string | null = null;
  let sawSheet = false;
  let date1904 = false;
  scanXml(xml, {
    start(name, attributes) {
      if (name === 'sheet' && !sawSheet) {
        sawSheet = true;
        sheetRelationshipId = attribute(attributes, 'id');
      } else if (name === 'workbookPr') {
        const value = attribute(attributes, 'date1904');
        date1904 = value === '1' || value === 'true';
      }
    },
    end() {},
    text() {},
  });
  return { sheetRelationshipId, date1904 };
}

/** Text runs (<t>) inside an <si> or <is> element, ignoring phonetic hints (<rPh>). */
class RichTextCollector {
  private phoneticDepth = 0;
  private inText = false;
  text = '';

  reset(): void {
    this.phoneticDepth = 0;
    this.inText = false;
    this.text = '';
  }

  start(name: string): void {
    if (name === 'rPh') {
      this.phoneticDepth++;
    } else if (name === 't' && this.phoneticDepth === 0) {
      this.inText = true;
    }
  }

  end(name: string): void {
    if (name === 'rPh' && this.phoneticDepth > 0) {
      this.phoneticDepth--;
    } else if (name === 't') {
      this.inText = false;
    }
  }

  append(xml: string, start: number, end: number, cdata: boolean): void {
    if (this.inText) {
      this.text += decodedText(xml, start, end, cdata);
    }
  }
}

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const item = new RichTextCollector();
  let inItem = false;
  scanXml(xml, {
    start(name) {
      if (name === 'si') {
        if (inItem) {
          throw malformed();
        }
        inItem = true;
        item.reset();
      } else if (inItem) {
        item.start(name);
      }
    },
    end(name) {
      if (name === 'si') {
        if (!inItem) {
          throw malformed();
        }
        strings.push(item.text);
        inItem = false;
      } else if (inItem) {
        item.end(name);
      }
    },
    text(text, start, end, cdata) {
      if (inItem) {
        item.append(text, start, end, cdata);
      }
    },
  });
  if (inItem) {
    throw malformed();
  }
  return strings;
}

/** Converts a column reference such as "C" or "AB" to a 0-based index. */
function columnIndex(reference: string): number {
  let index = 0;
  for (let i = 0; i < reference.length && index <= MAX_COLUMNS; i++) {
    const code = reference.charCodeAt(i);
    if (code < 65 || code > 90) {
      break;
    }
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function cellValue(type: string, value: string | null, inline: string | null, sharedStrings: string[]): CellValue {
  if (type === 'inlineStr') {
    return inline;
  }
  if (value === null) {
    return null;
  }
  switch (type) {
    case 's': {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
        throw malformed();
      }
      return sharedStrings[index];
    }
    case 'str':
    case 'd':
      return value;
    case 'b':
      return value === '1' || value === 'true';
    case 'e':
      return null;
    default: {
      const trimmed = value.trim();
      const number = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(number)) {
        throw malformed();
      }
      return number;
    }
  }
}

function readRows(xml: string, sharedStrings: string[], maxRows: number): SheetRow[] {
  const rows: SheetRow[] = [];
  let sawSheetData = false;
  let inSheetData = false;
  let previousRowNumber = 0;
  let row: SheetRow | null = null;
  let nextColumn = 0;

  let cellColumn = -1;
  let cellType = 'n';
  let inCell = false;
  let value: string | null = null;
  let inValue = false;
  const inline = new RichTextCollector();
  let inlineText: string | null = null;
  let inInline = false;

  scanXml(xml, {
    start(name, attributes) {
      if (name === 'sheetData') {
        if (sawSheetData) {
          throw malformed();
        }
        sawSheetData = inSheetData = true;
        return;
      }
      if (!inSheetData) {
        return;
      }
      if (name === 'row') {
        if (row) {
          throw malformed();
        }
        const rowAttribute = attribute(attributes, 'r');
        const rowNumber = rowAttribute === null ? previousRowNumber + 1 : Number(rowAttribute);
        if (!Number.isInteger(rowNumber) || rowNumber <= previousRowNumber) {
          throw malformed();
        }
        previousRowNumber = rowNumber;
        if (rows.length >= maxRows) {
          throw new ConsumptionParseError('TOO_MANY_ROWS');
        }
        row = { rowNumber, cells: [] };
        nextColumn = 0;
      } else if (name === 'c') {
        if (!row || inCell) {
          throw malformed();
        }
        const reference = attribute(attributes, 'r');
        const column = reference === null ? nextColumn : columnIndex(reference);
        if (column < 0 || column >= MAX_COLUMNS || column < nextColumn) {
          throw malformed();
        }
        nextColumn = column + 1;
        cellColumn = column;
        cellType = attribute(attributes, 't') ?? 'n';
        inCell = true;
        value = null;
        inlineText = null;
      } else if (inCell && inInline) {
        inline.start(name);
      } else if (inCell && name === 'is' && inlineText === null) {
        inInline = true;
        inline.reset();
      } else if (inCell && name === 'v' && value === null) {
        inValue = true;
        value = '';
      }
    },
    end(name) {
      if (name === 'sheetData') {
        if (!inSheetData || row) {
          throw malformed();
        }
        inSheetData = false;
      } else if (!inSheetData) {
        return;
      } else if (name === 'row') {
        if (!row || inCell) {
          throw malformed();
        }
        rows.push(row);
        row = null;
      } else if (name === 'c') {
        if (!row || !inCell || inInline) {
          throw malformed();
        }
        const cell = cellValue(cellType, value, inlineText, sharedStrings);
        if (cellColumn < MAX_STORED_COLUMNS) {
          while (row.cells.length < cellColumn) {
            row.cells.push(null);
          }
          row.cells[cellColumn] = cell;
        }
        inCell = false;
      } else if (inInline && name === 'is') {
        inInline = false;
        inlineText = inline.text;
      } else if (inInline) {
        inline.end(name);
      } else if (name === 'v') {
        inValue = false;
      }
    },
    text(text, start, end, cdata) {
      if (inValue) {
        value = (value ?? '') + decodedText(text, start, end, cdata);
      } else if (inInline) {
        inline.append(text, start, end, cdata);
      }
    },
  });
  if (!sawSheetData || inSheetData) {
    throw malformed();
  }
  return rows;
}

export function readFirstWorksheet(bytes: Uint8Array, limits: SheetReadLimits): Worksheet {
  if (!hasZipSignature(bytes)) {
    throw new ConsumptionParseError('NOT_XLSX');
  }
  const entries = readZipDirectory(bytes, limits.maxDecompressedBytes);
  const budget: DecompressionBudget = { remaining: limits.maxDecompressedBytes };

  const workbookEntry = entries.get('xl/workbook.xml');
  if (!workbookEntry) {
    throw new ConsumptionParseError('NOT_XLSX');
  }
  const workbook = readWorkbook(readXml(bytes, workbookEntry, budget));
  const relationshipsEntry = entries.get('xl/_rels/workbook.xml.rels');
  if (!relationshipsEntry) {
    throw malformed();
  }
  const relationships = readRelationships(readXml(bytes, relationshipsEntry, budget));

  const sheetRelationship = workbook.sheetRelationshipId ? relationships.get(workbook.sheetRelationshipId) : undefined;
  if (!sheetRelationship || !sheetRelationship.type.startsWith(OFFICE_REL_TYPE)) {
    throw malformed();
  }
  const sheetEntry = entries.get(resolveTarget(sheetRelationship.target));
  if (!sheetEntry) {
    throw malformed();
  }

  let sharedStrings: string[] = [];
  for (const relationship of relationships.values()) {
    if (relationship.type === `${OFFICE_REL_TYPE}sharedStrings`) {
      const sharedEntry = entries.get(resolveTarget(relationship.target));
      if (!sharedEntry) {
        throw malformed();
      }
      sharedStrings = readSharedStrings(readXml(bytes, sharedEntry, budget));
    }
  }

  const rows = readRows(readXml(bytes, sheetEntry, budget), sharedStrings, limits.maxRows);
  return { rows, date1904: workbook.date1904 };
}
