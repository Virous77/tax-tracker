"""Build the synthetic CoinDCX fixture workbook from its per-sheet CSV files.

Standard library only. Run from the repo root:

    python3 -I docs/research/scripts/build_coindcx_xlsx.py

Reads  packages/importers/test/fixtures/coindcx-report/sheets.json (+ the CSVs it lists)
Writes packages/importers/test/fixtures/coindcx-report.xlsx

Output is byte-for-byte reproducible (fixed zip timestamps, fixed entry order).
Text cells are shared strings; cells under a sheet's "numericColumns" below the
header row are written as numeric cells with the exact digits from the CSV.
"""

import csv
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape

FIXTURE_DIR = Path("packages/importers/test/fixtures/coindcx-report")
ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def column_letters(index):
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


class SharedStrings:
    def __init__(self):
        self.index_by_text = {}
        self.uses = 0

    def index_of(self, text):
        self.uses += 1
        return self.index_by_text.setdefault(text, len(self.index_by_text))

    def xml(self):
        items = "".join(
            f'<si><t xml:space="preserve">{escape(text)}</t></si>' for text in self.index_by_text
        )
        return (
            f'{XML_HEADER}<sst xmlns="{MAIN_NS}" count="{self.uses}" '
            f'uniqueCount="{len(self.index_by_text)}">{items}</sst>'
        )


def sheet_xml(rows, header_row, numeric_columns, strings):
    header = rows[header_row - 1]
    numeric_indexes = {header.index(name) for name in numeric_columns}
    xml_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row):
            if value == "":
                continue
            ref = f"{column_letters(column_index)}{row_number}"
            if row_number > header_row and column_index in numeric_indexes:
                float(value)
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="s"><v>{strings.index_of(value)}</v></c>')
        xml_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    return f'{XML_HEADER}<worksheet xmlns="{MAIN_NS}"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>'


def build(manifest):
    strings = SharedStrings()
    sheets = []
    for sheet in manifest["sheets"]:
        with open(FIXTURE_DIR / sheet["file"], newline="", encoding="utf-8") as handle:
            rows = list(csv.reader(handle))
        sheets.append(sheet_xml(rows, sheet["headerRow"], sheet["numericColumns"], strings))

    numbers = range(1, len(sheets) + 1)
    workbook_sheets = "".join(
        f'<sheet name="{escape(sheet["name"], {chr(34): "&quot;"})}" sheetId="{n}" r:id="rId{n}"/>'
        for n, sheet in zip(numbers, manifest["sheets"])
    )
    sheet_rels = "".join(
        f'<Relationship Id="rId{n}" Type="{REL_NS}/worksheet" Target="worksheets/sheet{n}.xml"/>'
        for n in numbers
    )
    last = len(sheets)
    sheet_overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{n}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for n in numbers
    )
    parts = [
        (
            "[Content_Types].xml",
            f'{XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            f"{sheet_overrides}"
            '<Override PartName="/xl/sharedStrings.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            '<Override PartName="/xl/styles.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>",
        ),
        (
            "_rels/.rels",
            f'{XML_HEADER}<Relationships xmlns="{PKG_REL_NS}">'
            f'<Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        ),
        (
            "xl/workbook.xml",
            f'{XML_HEADER}<workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}">'
            f"<sheets>{workbook_sheets}</sheets></workbook>",
        ),
        (
            "xl/_rels/workbook.xml.rels",
            f'{XML_HEADER}<Relationships xmlns="{PKG_REL_NS}">{sheet_rels}'
            f'<Relationship Id="rId{last + 1}" Type="{REL_NS}/sharedStrings" Target="sharedStrings.xml"/>'
            f'<Relationship Id="rId{last + 2}" Type="{REL_NS}/styles" Target="styles.xml"/>'
            "</Relationships>",
        ),
        (
            "xl/styles.xml",
            f'{XML_HEADER}<styleSheet xmlns="{MAIN_NS}">'
            '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill>'
            '<fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
            "</styleSheet>",
        ),
    ]
    parts += [(f"xl/worksheets/sheet{n}.xml", xml) for n, xml in zip(numbers, sheets)]
    parts.append(("xl/sharedStrings.xml", strings.xml()))
    return parts


def write_workbook(parts, target):
    with zipfile.ZipFile(target, "w") as archive:
        for name, content in parts:
            info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content.encode("utf-8"))


def verify(target, manifest):
    with zipfile.ZipFile(target) as archive:
        for name in archive.namelist():
            ElementTree.fromstring(archive.read(name))
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        names = [sheet.get("name") for sheet in workbook.iter(f"{{{MAIN_NS}}}sheet")]
        expected = [sheet["name"] for sheet in manifest["sheets"]]
        if names != expected:
            raise SystemExit(f"sheet names differ: {names} != {expected}")
        for number, name in enumerate(names, start=1):
            sheet = ElementTree.fromstring(archive.read(f"xl/worksheets/sheet{number}.xml"))
            row_count = len(list(sheet.iter(f"{{{MAIN_NS}}}row")))
            print(f"  sheet {number}: {name!r}, {row_count} rows")


def main():
    if not FIXTURE_DIR.is_dir():
        raise SystemExit("run from the repo root")
    manifest = json.loads((FIXTURE_DIR / "sheets.json").read_text(encoding="utf-8"))
    target = (FIXTURE_DIR / manifest["workbook"]).resolve()
    write_workbook(build(manifest), target)
    print(f"wrote {target.relative_to(Path.cwd())} ({target.stat().st_size} bytes)")
    verify(target, manifest)


if __name__ == "__main__":
    sys.exit(main())
