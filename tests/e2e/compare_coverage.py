"""Compare unchanged acceptance metrics and exact missing records; no network or rescoring."""
import argparse
from collections import Counter
import json
from pathlib import Path

CONDITIONS=('probe_sha256','coverage_version','restore_version','timeout_seconds','llm','headed','ack','browser_version')


def missing_key(item):
    return tuple(item.get(k) for k in ('selector','type','text','reason'))


def missing_diff(before,after):
    a,b=Counter(map(missing_key,before)),Counter(map(missing_key,after))
    def records(counter):
        return [dict(zip(('selector','type','text','reason'),key)) for key,count in counter.items() for _ in range(count)]
    return {'added':records(b-a),'removed':records(a-b),'shared':records(a&b)}


def compare(before,after):
    mismatched=[key for key in CONDITIONS if before['metadata'].get(key)!=after['metadata'].get(key)]
    if mismatched:
        raise ValueError('Different observation conditions: '+', '.join(mismatched))
    def index(data):
        out={}
        for row in data['rows']:
            key=(row['id'],row['device'])
            if key in out:raise ValueError('Duplicate case: '+str(key))
            out[key]=row
        return out
    a,b=index(before),index(after)
    if a.keys()!=b.keys():raise ValueError('Different case sets')
    rows=[]
    for key,old in a.items():
        new=b[key]
        if old.get('emulation')!=new.get('emulation'):
            raise ValueError('Different device emulation: '+str(key))
        def summary(row):
            return {k:row.get(k) for k in ('coverage','covered','total','initial_total','t_first','status','emulation')}
        rows.append({'id':key[0],'device':key[1],'baseline':summary(old),'current':summary(new),
                     'missing':missing_diff(old.get('missing',[]),new.get('missing',[]))})
    return rows


def markdown(rows):
    def pct(value):return f'{value:.1%}' if value is not None else '—'
    def sec(value):return f'{value:.3f}' if value is not None else '—'
    lines=['| Page | Device | v0.6 coverage | Current coverage | v0.6 t_first | Current t_first | Added missing | Removed missing |',
           '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for row in rows:
        a,b=row['baseline'],row['current']
        lines.append(f"| {row['id']} | {row['device']} | {pct(a['coverage'])} | {pct(b['coverage'])} | {sec(a['t_first'])} | {sec(b['t_first'])} | {len(row['missing']['added'])} | {len(row['missing']['removed'])} |")
    return '\n'.join(lines)+'\n'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline',type=Path)
    parser.add_argument('current',type=Path)
    parser.add_argument('--out',type=Path,required=True,help='New report directory; refuses to replace evidence')
    args=parser.parse_args()
    if args.out.exists() and any(args.out.iterdir()):parser.error('--out must be empty')
    rows=compare(json.loads(args.baseline.read_text('utf-8')),json.loads(args.current.read_text('utf-8')))
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'comparison.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),'utf-8')
    report=markdown(rows)
    (args.out/'comparison.md').write_text(report,'utf-8')
    print(report,end='')
    print(f'SUMMARY coverage comparison cases={len(rows)}; original metrics preserved')


if __name__=='__main__':main()
