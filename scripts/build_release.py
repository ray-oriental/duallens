"""Create deterministic public release ZIPs and SHA256SUMS without third-party dependencies."""
from __future__ import annotations
import argparse
import hashlib
import shutil
import subprocess
import json
from pathlib import Path
import stat
import sys
import tempfile
import zipfile
from check_project import CheckError, is_link, packaged_bytes, release_members, require

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
    manifest, extension, portable = release_members(project)
    version = manifest['version']
    output = (output_dir or project / 'dist').absolute()
    check_output_path(output)
    if target == 'edge-store':
        edge_manifest = dict(manifest)
        edge_manifest.pop('key', None)
        edge_members = dict(extension)
        edge_members.pop('key', None)
        named = {f'duallens-edge-store-v{version}.zip': edge_members}
    else:
        named = {f'duallens-extension-v{version}.zip': extension, f'duallens-portable-v{version}.zip': portable}
    for name in [*named, 'SHA256SUMS']:
        require(not is_link(output / name), f'linked existing output: {name}')
    cache = Path.home() / '.cache' / 'duallens-build'
    check_output_path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='duallens-release-', dir=cache) as temporary:
        stage = Path(temporary)
        require(stage.resolve().parent == cache.resolve(), 'temporary build path escaped local cache')
        output.mkdir(parents=True, exist_ok=True)
        replacements = {}
        if target == 'edge-store':
            manifest_stage = stage / 'manifest.json'
            manifest_stage.write_text(json.dumps(edge_manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8', newline='\n')
            replacements['manifest.json'] = manifest_stage.read_bytes()
        for name, members in named.items():
            write_zip(stage / name, members, replacements)
        user_script = project / 'scripts' / 'build_userscript.mjs'
        release_assets = list(named)
        if user_script.is_file():
            subprocess.run(['node', str(user_script)], cwd=project, check=True)
            generated = project / 'dist' / 'duallens.user.js'
            require(generated.is_file(), 'userscript builder did not create dist/duallens.user.js')
            staged_user = stage / generated.name
            shutil.copyfile(generated, staged_user)
            release_assets.append(generated.name)
        sums = ''.join(f"{hashlib.sha256((stage / name).read_bytes()).hexdigest()}  {name}\n" for name in sorted(release_assets))
        (stage / 'SHA256SUMS').write_text(sums, encoding='utf-8', newline='\n')
        output.mkdir(parents=True, exist_ok=True)
        # Copy only the three final products; source staging may be on a different drive.
        # No intermediate files or caches are written into the project.
        for name in [*named, *(["duallens.user.js"] if user_script.is_file() else []), 'SHA256SUMS']:
            shutil.copyfile(stage / name, output / name)
    return [output / name for name in [*named, *(["duallens.user.js"] if user_script.is_file() else []), 'SHA256SUMS']]

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
