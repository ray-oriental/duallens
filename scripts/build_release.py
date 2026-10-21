"""Create deterministic public release ZIPs and SHA256SUMS without third-party dependencies."""
from __future__ import annotations
import argparse
import hashlib
import shutil
import json
from pathlib import Path
import stat
import sys
import tempfile
import zipfile
from check_project import CheckError, is_link, packaged_bytes, release_members, require, VERSIONED_ASSET_RE, USERSCRIPT_ASSETS, rebuild_userscript_assets, verify_userscript_version

PROJECT = Path(__file__).resolve().parent.parent

def check_output_path(path: Path) -> None:
    for parent in [path, *path.parents]:
        require(not is_link(parent), f'linked output directory: {parent.name}')

def write_zip(target: Path, members: dict[str, Path], replacements: dict[str, bytes] | None = None) -> None:
    replacements = replacements or {}
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in sorted(members.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            payload = replacements.get(name, packaged_bytes(source))
            archive.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

def build_release(project_root: Path, output_dir: Path | None = None, target: str = 'all') -> list[Path]:
    if target not in {'all', 'edge-store'}:
        raise ValueError(f'unknown release target: {target}')
    project = project_root.absolute()
    # Shared reviewed PUBLIC_DOCS allowlist in check_project.py includes PDF.md;
    # use release_members for both packaging and validation to prevent drift.
    manifest, extension, portable = release_members(project)
    version = manifest['version']
    output = (output_dir or project / 'dist').absolute()
    check_output_path(output)
    named = {f'duallens-extension-v{version}.zip': extension, f'duallens-portable-v{version}.zip': portable}
    edge_name = f'duallens-edge-store-v{version}.zip'
    if target == 'edge-store' or (output / edge_name).exists():
        edge_manifest = dict(manifest)
        edge_manifest.pop('key', None)
        named[edge_name] = extension
    existing = [p for p in output.iterdir() if VERSIONED_ASSET_RE.fullmatch(p.name) or p.name in USERSCRIPT_ASSETS | {'SHA256SUMS'}] if output.exists() else []
    for asset in existing:
        require(not is_link(asset) and asset.is_file(), f'unsafe existing release asset: {asset.name}')
    for name in [*named, *USERSCRIPT_ASSETS, 'SHA256SUMS']:
        require(not is_link(output / name), f'linked existing output: {name}')
    cache = Path(tempfile.gettempdir()) / 'duallens-build'
    check_output_path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='duallens-release-', dir=cache) as temporary:
        stage = Path(temporary)
        require(stage.resolve().parent == cache.resolve(), 'temporary build path escaped local cache')
        for name, members in named.items():
            replacements = {'manifest.json': json.dumps(edge_manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')} if name == edge_name else {}
            write_zip(stage / name, members, replacements)
        user_script = project / 'scripts' / 'build_userscript.mjs'
        release_assets = list(named)
        if user_script.is_file():
            assets = rebuild_userscript_assets(project)
            verify_userscript_version(assets['duallens.user.js'], version)
            for name, content in assets.items():
                (stage / name).write_bytes(content)
                release_assets.append(name)
        sums = ''.join(f"{hashlib.sha256((stage / name).read_bytes()).hexdigest()}  {name}\n" for name in sorted(release_assets))
        (stage / 'SHA256SUMS').write_text(sums, encoding='utf-8', newline='\n')
        output.mkdir(parents=True, exist_ok=True)
        # Remove only validated, project-owned release files before publishing staged outputs.
        # A failed build leaves the previous artifacts intact; unrelated files are untouched.
        for asset in existing:
            require(asset.absolute().parent == output, 'release cleanup escaped output directory')
            require(not is_link(asset) and asset.is_file(), f'unsafe existing release asset: {asset.name}')
            asset.unlink()
        for name in [*release_assets, 'SHA256SUMS']:
            shutil.copyfile(stage / name, output / name)
    return [output / name for name in [*release_assets, 'SHA256SUMS']]

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-dir', type=Path, default=PROJECT)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--target', choices=('all', 'edge-store'), default='all')
    args = parser.parse_args(argv)
    try:
        for path in build_release(args.project_dir, args.output_dir, args.target):
            print(path.name)
        return 0
    except (CheckError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f'FAIL release: {exc}', file=sys.stderr); return 1

if __name__ == '__main__':
    raise SystemExit(main())
