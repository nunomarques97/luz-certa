import { zipSync } from 'fflate';

import { ConsumptionParseError } from './parse-errors';
import { MAX_STORED_COLUMNS, SheetReadLimits, Worksheet, readFirstWorksheet } from './xlsx-sheet-reader';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const LIMITS: SheetReadLimits = { maxDecompressedBytes: 200 * 1024 * 1024, maxRows: 400_000 };

const encoder = new TextEncoder();

/** Minimal workbook around a hand-written worksheet (and optional shared strings) XML. */
function workbook(sheetXml: string, sharedStringsXml?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': encoder.encode(
      `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': encoder.encode(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        (sharedStringsXml ? `<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : '') +
        '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': encoder.encode(sheetXml),
  };
  if (sharedStringsXml) {
    files['xl/sharedStrings.xml'] = encoder.encode(sharedStringsXml);
  }
  return zipSync(files, { level: 6 });
}

function sheet(sheetData: string): string {
  return `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData>${sheetData}</sheetData></worksheet>`;
}

function read(bytes: Uint8Array): Worksheet {
  return readFirstWorksheet(bytes, LIMITS);
}

function expectMalformed(bytes: Uint8Array): void {
  let error: unknown;
  try {
    read(bytes);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ConsumptionParseError);
  expect((error as ConsumptionParseError).code).toBe('MALFORMED_XLSX');
}

describe('readFirstWorksheet: cell content', () => {
  it('reads namespace prefixes, rich inline text, phonetic hints, CDATA, comments and entities', () => {
    const xml =
      `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><!-- note <row> -->` +
      '<x:row r="1">' +
      '<x:c r="A1" t="inlineStr"><x:is><x:r><x:t>Da</x:t></x:r><x:r><x:t xml:space="preserve">ta</x:t></x:r></x:is></x:c>' +
      '<x:c r="B1" t="inlineStr"><x:is><x:t>H</x:t><x:rPh sb="0" eb="1"><x:t>ignored</x:t></x:rPh><x:t>ora</x:t></x:is></x:c>' +
      '<x:c r="C1" t="str"><x:f>A1</x:f><x:v><![CDATA[a<b&amp;]]></x:v></x:c>' +
      "<x:c r='D1' t='inlineStr'><x:is><x:t>&lt;&#65;&#x42;&amp;&unknown;</x:t></x:is></x:c>" +
      '</x:row></x:sheetData></x:worksheet>';
    expect(read(workbook(xml)).rows).toEqual([{ rowNumber: 1, cells: ['Data', 'Hora', 'a<b&amp;', '<AB&&unknown;'] }]);
  });

  it('reads shared strings with rich runs and phonetic hints', () => {
    const shared =
      `<sst xmlns="${MAIN}"><si><t>Consumo</t></si><si/><si><r><rPr><b/></rPr><t>Es</t></r><r><t>tado</t></r>` +
      '<rPh sb="0" eb="1"><t>x</t></rPh></si></sst>';
    const xml = sheet('<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c></row>');
    expect(read(workbook(xml, shared)).rows).toEqual([{ rowNumber: 2, cells: ['Consumo', '', 'Estado'] }]);
    expectMalformed(workbook(sheet('<row><c t="s"><v>3</v></c></row>'), shared));
  });

  it('reads numbers, booleans, errors, empty cells and rows without references', () => {
    const xml = sheet(
      '<row><c><v> 1.5 </v></c><c t="b"><v>1</v></c><c t="e"><v>#N/A</v></c><c s="1"/><c><v>2</v></c></row><row/>',
    );
    expect(read(workbook(xml)).rows).toEqual([
      { rowNumber: 1, cells: [1.5, true, null, null, 2] },
      { rowNumber: 2, cells: [] },
    ]);
  });

  it('accepts attribute values that contain ">" and ignores namespace declarations', () => {
    const xml = sheet('<row r="1" xmlns:r="urn:x" spans="1:2" note="a>b"><c r="B1" t="inlineStr"><is><t>v</t></is></c></row>');
    expect(read(workbook(xml)).rows).toEqual([{ rowNumber: 1, cells: [null, 'v'] }]);
  });
});

describe('readFirstWorksheet: hostile input', () => {
  it(`stores at most ${MAX_STORED_COLUMNS} columns per row, so far references cannot exhaust memory`, () => {
    const rows: string[] = [];
    for (let r = 1; r <= 400_000; r++) {
      rows.push(`<row r="${r}"><c r="XFD${r}" t="inlineStr"><is><t>x</t></is></c></row>`);
    }
    const started = performance.now();
    const result = read(workbook(sheet(rows.join(''))));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.rows).toHaveLength(400_000);
    expect(result.rows.every((row) => row.cells.length === 0)).toBe(true);

    const mixed = sheet('<row r="1"><c r="B1"><v>7</v></c><c r="CA1"><v>8</v></c></row>');
    expect(read(workbook(mixed)).rows[0].cells).toEqual([null, 7]);
    // References past the Excel limit (XFD) and out-of-order columns stay malformed.
    expectMalformed(workbook(sheet('<row r="1"><c r="XFE1"><v>1</v></c></row>')));
    expectMalformed(workbook(sheet(`<row r="1"><c r="${'Z'.repeat(5000)}1"><v>1</v></c></row>`)));
    expectMalformed(workbook(sheet('<row r="1"><c r="C1"><v>1</v></c><c r="B1"><v>1</v></c></row>')));
  });

  it('rejects unterminated and unbalanced markup in linear time', () => {
    const n = 200_000;
    const payloads = [
      sheet('<row>'.repeat(n)),
      sheet('<row r="1">' + '<c><v>1</v>'.repeat(n)),
      `<worksheet><sheetData><row r="1"><c><v>${'1'.repeat(n)}`,
      `<worksheet><sheetData>${'<row r="'.repeat(n)}`,
      `<worksheet><sheetData><row ${'a="1" '.repeat(n)}`,
      `<worksheet><sheetData>${'<!--'.repeat(n)}`,
      `<worksheet><sheetData>${'<'.repeat(n)}`,
      `<worksheet><sheetData>${'</row'.repeat(n)}`,
      '<worksheet><row r="1"></row></worksheet>',
      sheet('</row>'),
      sheet('<row r="2"></row><row r="1"></row>'),
      `<worksheet><sheetData></sheetData><sheetData></sheetData></worksheet>`,
      '<worksheet><sheetData><![CDATA[',
      '<worksheet><sheetData><!ENTITY x "y"></sheetData></worksheet>',
    ];
    for (const xml of payloads) {
      const started = performance.now();
      expectMalformed(workbook(xml));
      expect(performance.now() - started, xml.slice(0, 40)).toBeLessThan(1_000);
    }
    const sharedPayloads = ['<sst>' + '<si><t>x'.repeat(n), '<sst>' + '<si>'.repeat(n), '<sst></si></sst>'];
    for (const shared of sharedPayloads) {
      const started = performance.now();
      expectMalformed(workbook(sheet(''), shared));
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
