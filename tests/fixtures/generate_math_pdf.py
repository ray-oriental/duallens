"""Deterministic original mathematical notes, stdlib only; no borrowed lecture text."""
from pathlib import Path


def make_pdf(pages=6):
    objects=[b'',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
             b'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>']
    kids=[]
    for number in range(1,pages+1):
        page_id=len(objects)+1;stream_id=page_id+1;kids.append(f'{page_id} 0 R')
        lines=[('F1',10,48,770,'Original mathematical notes - DualLens'),
               ('F1',18,48,720,f'Lesson {number}: A linear constraint'),
               ('F1',12,48,682,'Let x + y = 2 be a constraint on two real variables.'),
               ('F1',12,48,664,'We describe the solution by choosing one free coordinate.'),
               ('F2',12,160,625,'x + y = 2'),
               ('F2',12,160,603,'y = 2 - x'),
               ('F1',12,48,558,'Every point on this line satisfies the original constraint.'),
               ('F1',12,48,540,'The formula above stays unchanged when we translate the explanation.'),
               ('F1',12,48,492,'For a quadratic example consider the following expression.'),
               ('F2',12,160,458,'f(x) = x'),('F2',8,207,464,'2'),
               ('F1',12,48,410,'Small raised symbols are part of the formula, not separate sentences.'),
               ('F1',12,48,392,'A long translation must push later paragraphs down without overlap.'),
               ('F1',10,300,20,str(number))]
        commands=[]
        for font,size,x,y,text in lines:
            text=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
            commands.append(f'BT /{font} {size} Tf 1 0 0 1 {x} {y} Tm ({text}) Tj ET')
        stream='\n'.join(commands).encode('ascii')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {stream_id} 0 R >>'.encode())
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'\nendstream')
    objects[0]=b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1]=f'<< /Type /Pages /Count {pages} /Kids [{" ".join(kids)}] >>'.encode()
    # Binary marker keeps Git from newline-normalizing PDF streams/xref records on Windows.
    result=bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\x00\n');offsets=[0]
    for number,obj in enumerate(objects,1):
        offsets.append(len(result));result.extend(f'{number} 0 obj\n'.encode()+obj+b'\nendobj\n')
    start=len(result);result.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:result.extend(f'{offset:010} 00000 n \n'.encode())
    result.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
    return bytes(result)


if __name__=='__main__':
    output=Path(__file__).with_name('math-notes.pdf');output.write_bytes(make_pdf())
    print(f'Math PDF fixture: 6 pages, {output.stat().st_size} bytes')
