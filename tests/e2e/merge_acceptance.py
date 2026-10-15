#!/usr/bin/env python3
"""Merge explicit acceptance reruns without losing their original evidence paths.

Later --run directories replace matching (page,device) rows. Every input must test
the identical extension tree/userscript and LLM policy. Originals remain untouched.
"""
import argparse
import json
from pathlib import Path

from run_acceptance import REPO, write_reports


def merge(paths):
    metadata, rows, provenance = None, {}, []
    for path in paths:
        data = json.loads((path / 'matrix.json').read_text(encoding='utf-8'))
        current = data['metadata']
        if metadata is None:
            metadata = dict(current)
        for field in ('extension_tree_sha256', 'userscript_sha256', 'llm', 'coverage_version', 'restore_version', 'probe_sha256', 'headed'):
            if current.get(field) != metadata.get(field):
                raise ValueError('Incompatible acceptance inputs: ' + field)
        provenance.append({'directory': str(path.resolve()), 'run_id': current['run_id'],
                           'complete': current.get('complete', False)})
        for row in data['rows']:
            key = row['id'], row['device']
            row = dict(row)
            row['evidence_dir'] = str(path.resolve())
            row['source_run_id'] = current['run_id']
            rows[key] = row
    metadata['source_runs'] = provenance
    metadata['merge_policy'] = 'Explicit later runs replace matching rows; original reports/screenshots retained.'
    metadata['complete'] = all(p['complete'] for p in provenance)
    return metadata, list(rows.values())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--run', action='append', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    args.out = args.out.resolve()
    if args.out == REPO or REPO in args.out.parents:
        ap.error('Evidence must remain outside the checkout')
    if args.out.exists() and any(args.out.iterdir()):
        ap.error('--out must be empty')
    metadata, rows = merge(args.run)
    args.out.mkdir(parents=True, exist_ok=True)
    counts = write_reports(args.out, metadata, rows)
    print('SUMMARY acceptance-merge total=' + str(len(rows)) + ' ' + ' '.join(f'{k}={v}' for k,v in counts.items()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
