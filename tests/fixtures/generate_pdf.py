"""Original deterministic multi-page English PDF fixture; Python stdlib only.
Run from the repository root: python -B tests/fixtures/generate_pdf.py
No third-party PDF or fonts are copied. Bytes and xref offsets are generated here.
"""
from pathlib import Path


def make_pdf(pages=8):
    objects = [b'', b'']
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    kids = []
    for page in range(1, pages + 1):
        page_id = len(objects) + 1
        stream_id = page_id + 1
        kids.append(f'{page_id} 0 R')
        lines = [
            (18, 740, f'DualLens Field Notebook - Page {page}'),
            (12, 694, f'Observation {page}: Morning light reaches the quiet garden.'),
            (12, 676, 'Small leaves collect clear drops after the passing rain.'),
            (12, 658, 'Our team records each change and compares the measurements.'),
            (12, 610, f'Experiment {page}: We place a paper marker near the stone path.'),
            (12, 592, 'The marker stays dry while the nearby soil holds moisture.'),
            (12, 574, 'Careful notes help future readers understand our methods.'),
            (12, 525, 'This original fixture contains no private or borrowed content.'),
            (12, 507, 'Translation appears only when a reader asks for nearby text.'),
            (12, 120, f'End of page {page}. The next page continues the field notebook.'),
        ]
        commands = []
        for size, y, text in lines:
            text = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            commands.append(f'BT /F1 {size} Tf 1 0 0 1 48 {y} Tm ({text}) Tj ET')
        stream = '\n'.join(commands).encode('ascii')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>'.encode('ascii'))
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode('ascii') + stream + b'\nendstream')
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = f'<< /Type /Pages /Count {pages} /Kids [{" ".join(kids)}] >>'.encode('ascii')
    result = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f'{number} 0 obj\n'.encode('ascii') + obj + b'\nendobj\n')
    start = len(result)
    result.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode('ascii'))
    for offset in offsets[1:]:
        result.extend(f'{offset:010} 00000 n \n'.encode('ascii'))
    result.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode('ascii'))
    return bytes(result)


if __name__ == '__main__':
    output = Path(__file__).with_name('pdf-field-notebook.pdf')
    output.write_bytes(make_pdf())
    print(f'PDF fixture: 8 pages, {output.stat().st_size} bytes')
