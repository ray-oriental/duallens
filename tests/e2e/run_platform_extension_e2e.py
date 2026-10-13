#!/usr/bin/env python3
"""Run canonical mock E2E with the pending leader-owned manifest seam in a cache copy.

This is an integration preview, not a claim that the current source manifest works.
After leader adds platform/*.js to web_accessible_resources, run run_e2e.py directly.
"""
import json
import sys
import uuid
import run_e2e as canonical


def main():
    canonical.E2E_ROOT.mkdir(parents=True, exist_ok=True)
    run = canonical.E2E_ROOT / ('run-platform-manifest-' + uuid.uuid4().hex[:8])
    run.mkdir()
    try:
        extension, missing = canonical.stage_extension(run)
        if missing:
            raise ValueError('missing extension resources: ' + ', '.join(missing))
        manifest_path = extension / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        resources = manifest['web_accessible_resources'][0]['resources']
        if 'platform/*.js' not in resources:
            resources.append('platform/*.js')
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        print('INTEGRATION PREVIEW: cache-only manifest adds platform/*.js; source manifest unchanged', flush=True)
        return canonical.main(['--extension-dir', str(extension), '--mock-only', *sys.argv[1:]])
    finally:
        canonical.remove_runtime_dir(run)


if __name__ == '__main__':
    raise SystemExit(main())
