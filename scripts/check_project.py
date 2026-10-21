"""Offline source and release checks. Python standard library; Node only for JS syntax."""
from __future__ import annotations
import argparse
import ast
import fnmatch
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
ASSET_SUFFIXES = {'.js', '.css', '.html', '.json', '.png', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.txt', '.wasm'}
BLOCKED = {'.git', '.cache', '.duallens', 'private', 'runtime', 'reference', 'duallens-ref', 'node_modules', '__pycache__', 'venv', '.venv', 'credentials', 'secrets', 'backups'}
PUBLIC_FILES = ('README.md', 'LICENSE', 'SECURITY.md', 'AGENTS.md', 'CONTRIBUTING.md', 'requirements-dev.txt', 'package.json', '.gitignore', '.gitattributes', 'CHANGELOG.md')
# Add user documentation only through an explicit reviewed list; private research is never included.
PUBLIC_DOCS = ('docs/ARCHITECTURE.md', 'docs/COMICS.md', 'docs/DESIGN.md', 'docs/PDF.md', 'docs/PLATFORMS.md', 'docs/PRIVACY.md', 'docs/PRODUCT.md', 'docs/ROADMAP.md', 'docs/SPEC.md', 'docs/SUBTITLES.md', 'docs/USAGE.md', 'docs/VALIDATION.md', 'docs/store/listing.en.md', 'docs/store/listing.zh-CN.md', 'docs/store/permissions.md', 'docs/store/submission-checklist.md')
IMPORT_RE = re.compile(r"\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?['\"]([^'\"]+)['\"]|\bimport\s*\(\s*['\"]([^'\"]+)['\"]")
RESOURCE_RE = re.compile(r"chrome\.runtime\.getURL\(\s*['\"]([^'\"]+)['\"]\s*\)")
VERSIONED_ASSET_RE = re.compile(r'duallens-(?:extension|portable|edge-store|chrome-store)-v\d+(?:\.\d+){0,3}\.zip')
USERSCRIPT_ASSETS = {'duallens.user.js', 'duallens-settings.js'}

class CheckError(ValueError):
    pass

# Only generic patterns belong in public source. Optional private terms stay on the maintainer's device.
PRIVACY_PATTERNS = (
    r'[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][A-Za-z0-9_.-]+',
    r'/(?:(?-i:Users)|home)/[A-Za-z0-9_.-]+',
    r'(?<![\w.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\w.])',
    r'(?<![\w.+-])(?![\w.+@-]*noreply)(?![\w.+-]+@[\w.-]*noreply)(?![\w.+-]+@(?:example\.(?:com|org|net)|[\w.-]+\.(?:test|invalid))\b)[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',
    r'(?<![\w-])(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})(?![\w-])',
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
)

def privacy_regex():
    terms = []
    configured = os.environ.get('DUALLENS_PRIVACY_TERMS_FILE')
    if configured and Path(configured).is_file():
        terms = [line.strip() for line in Path(configured).read_text(encoding='utf-8-sig').splitlines()
                 if line.strip() and not line.lstrip().startswith('#')]
    return re.compile('|'.join([*PRIVACY_PATTERNS, *(re.escape(t) for t in terms)]), re.I)

def check_privacy(project: Path) -> int:
    """Check tracked and new public files, or an unpacked source tree without Git.

    Diagnostics contain only a relative filename and line, never matched content.
    Vendored third-party code is excluded; public project code and docs are not.
    """
    if (project / '.git').exists():
        result = subprocess.run(['git', '-C', str(project), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], capture_output=True)
        require(result.returncode == 0, 'cannot inventory public files for privacy check')
        names = set(result.stdout.decode('utf-8').split('\0')) - {''}
    else:
        names = set()
        def visit(folder):
            for path in folder.iterdir():
                rel = path.relative_to(project)
                if path.name in BLOCKED | {'dist', '.agents', '.codex', '.aws'} or rel.as_posix().startswith('extension/vendor/'):
                    continue
                require(not is_link(path), f'linked public source entry: {rel.as_posix()}')
                if path.is_dir(): visit(path)
                elif path.is_file(): names.add(rel.as_posix())
        visit(project)
    policy = privacy_regex()
    count = 0
    for name in sorted(names):
        if name.startswith('extension/vendor/') or not (project / name).exists():
            continue
        source = safe_file(project, name)
        require(not policy.search(name), f'private identifier in public filename: {name}')
        # Decode binary as well: embedded ASCII metadata must not escape inspection.
        content = source.read_bytes().decode('utf-8-sig', errors='replace')
        match = policy.search(content)
        line = content.count('\n', 0, match.start()) + 1 if match else 0
        require(match is None, f'private identifier in public file: {name}:{line}')
        count += 1
    return count

def require(ok: bool, message: str) -> None:
    if not ok:
        raise CheckError(message)

def is_link(path: Path) -> bool:
    return path.is_symlink() or bool(getattr(path, 'is_junction', lambda: False)())

def safe_file(root: Path, relative: str) -> Path:
    pure = PurePosixPath(relative)
    require(bool(relative) and not pure.is_absolute() and '..' not in pure.parts and '\\' not in relative, f'unsafe relative path: {relative}')
    current = root
    require(not is_link(root), f'linked source directory: {root.name}')
    for part in pure.parts:
        current /= part
        require(not is_link(current), f'linked source entry: {relative}')
    require(current.resolve().is_relative_to(root.resolve()), f'path escapes root: {relative}')
    require(current.is_file(), f'missing file: {relative}')
    require(current.stat().st_size > 0, f'empty file: {relative}')
    return current

TEXT_SUFFIXES = {'.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.md', '.yml', '.yaml', '.py', '.ps1'}
TEXT_NAMES = {'LICENSE', '.gitignore', '.gitattributes'}

def packaged_bytes(source: Path) -> bytes:
    """Canonical release bytes: UTF-8/LF text; PowerShell keeps a UTF-8 BOM; binary unchanged."""
    data = source.read_bytes()
    if source.suffix.casefold() not in TEXT_SUFFIXES and source.name not in TEXT_NAMES:
        return data
    text = data.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    encoded = text.encode('utf-8')
    return b'\xef\xbb\xbf' + encoded if source.suffix.casefold() == '.ps1' else encoded


def manifest_references(m: dict) -> list[str]:
    refs = []
    bg = m.get('background', {})
    if bg.get('service_worker'):
        refs.append(bg['service_worker'])
    for entry in m.get('content_scripts', []):
        refs.extend(entry.get('js', [])); refs.extend(entry.get('css', []))
    act = m.get('action', {})
    if act.get('default_popup'):
        refs.append(act['default_popup'])
    icons = act.get('default_icon', {})
    refs.extend([icons] if isinstance(icons, str) else icons.values())
    refs.extend(m.get('icons', {}).values())
    if m.get('options_page'):
        refs.append(m['options_page'])
    if m.get('options_ui', {}).get('page'):
        refs.append(m['options_ui']['page'])
    refs.extend(m.get('chrome_url_overrides', {}).values())
    for entry in m.get('web_accessible_resources', []):
        refs.extend(entry.get('resources', []))
    if m.get('side_panel', {}).get('default_path'):
        refs.append(m['side_panel']['default_path'])
    if m.get('devtools_page'):
        refs.append(m['devtools_page'])
    require(all(isinstance(x, str) for x in refs), 'manifest references must be strings')
    return sorted(set(refs))

def extension_assets(extension: Path) -> dict[str, Path]:
    assets = {}
    def visit(directory: Path):
        for path in sorted(directory.iterdir()):
            rel = path.relative_to(extension).as_posix()
            require(not is_link(path), f'linked extension entry: {rel}')
            if path.name.startswith('.') or path.name.casefold() in BLOCKED:
                continue
            if path.is_dir():
                visit(path)
            elif path.suffix.casefold() in ASSET_SUFFIXES or rel == 'vendor/tesseract/VENDOR.md':
                assets[rel] = safe_file(extension, rel)
    require(extension.is_dir() and not is_link(extension), 'missing or linked extension directory')
    visit(extension)
    return assets


# Dedicated to the independently distributed userscript/settings resource, or unused by MV3.
USERSCRIPT_ONLY = frozenset({
    'content/comics/canvas-hook-runtime.js', 'content/comics/capabilities.js',
    'content/comics/languages.js', 'content/comics/runtime-resources.js',
    'content/comics/userscript-ocr.js', 'content/subtitles/observer-runtime.js',
    'platform/cache.js', 'platform/storage.js', 'platform/userscript.js',
    'sidepanel/userscript-panel.js', 'ui/common.js', 'ui/ui.css',
    'userscript/entry.js', 'userscript/menu.js', 'userscript/panel.js',
    'userscript/settings-resource.js', 'userscript/ui-resource.js',
})

def extension_runtime_assets(assets):
    runtime = {name:source for name,source in assets.items() if name not in USERSCRIPT_ONLY}
    root = assets['manifest.json'].parent
    for name, source in runtime.items():
        if source.suffix == '.js':
            text=source.read_text(encoding='utf-8-sig')
            for match in IMPORT_RE.finditer(text):
                rel=local_reference(root,source,match.group(1) or match.group(2))
                require(rel in runtime, f'extension import points at excluded asset: {rel}')
            for ref in RESOURCE_RE.findall(text):
                require(ref in runtime, f'extension getURL points at excluded asset: {ref}')
        elif source.suffix == '.html':
            parser=LocalResources();parser.feed(source.read_text(encoding='utf-8-sig'))
            for ref in parser.resources:
                require(local_reference(root,source,ref) in runtime, f'extension HTML points at excluded asset: {ref}')
    return runtime

def read_manifest(extension: Path) -> dict:
    m = json.loads(safe_file(extension, 'manifest.json').read_text(encoding='utf-8-sig'))
    require(m.get('manifest_version') == 3, 'expected Manifest V3')
    version = m.get('version', '')
    require(isinstance(version, str) and re.fullmatch(r'\d+(?:\.\d+){0,3}', version) is not None, 'invalid manifest version')
    require(all(0 <= int(x) <= 65535 for x in version.split('.')), 'manifest version component out of range')
    require(m.get('background', {}).get('type') == 'module', 'background must be an ES module')
    return m

class LocalResources(HTMLParser):
    def __init__(self):
        super().__init__(); self.resources = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ('src', 'href'):
            if key == 'href' and tag != 'link':
                continue
            if key in attrs:
                self.resources.append(attrs[key])

def local_reference(extension: Path, source: Path, reference: str) -> str:
    u = urlsplit(reference)
    require(not u.scheme and not u.netloc, f'external runtime dependency: {reference}')
    raw = unquote(u.path)
    require(not raw.startswith('/') and '\\' not in raw, f'unsafe local dependency: {reference}')
    target = (source.parent / raw).resolve()
    require(target.is_relative_to(extension.resolve()), f'dependency escapes extension: {reference}')
    rel = target.relative_to(extension.resolve()).as_posix()
    safe_file(extension, rel)
    return rel

def validate_extension(extension: Path, syntax: bool = False) -> tuple[dict, dict[str, Path]]:
    m = read_manifest(extension); assets = extension_assets(extension)
    for ref in manifest_references(m):
        require(not PurePosixPath(ref).is_absolute() and '..' not in PurePosixPath(ref).parts and '\\' not in ref, f'unsafe manifest reference: {ref}')
        matches = [name for name in assets if fnmatch.fnmatchcase(name, ref)]
        require(bool(matches), f'missing packaged manifest reference: {ref}')
    for name, path in assets.items():
        if path.suffix == '.js':
            source = path.read_text(encoding='utf-8-sig')
            for match in IMPORT_RE.finditer(source):
                ref = match.group(1) or match.group(2)
                require(ref.startswith('.'), f'non-local module import in {name}: {ref}')
                rel = local_reference(extension, path, ref)
                require(rel in assets, f'import omitted from package: {rel}')
            for ref in RESOURCE_RE.findall(source):
                require(ref in assets, f'getURL asset omitted from package: {ref}')
        elif path.suffix == '.html':
            parser = LocalResources(); parser.feed(path.read_text(encoding='utf-8-sig'))
            for ref in parser.resources:
                rel = local_reference(extension, path, ref)
                require(rel in assets, f'HTML asset omitted from package: {rel}')
        elif path.suffix == '.png':
            data = path.read_bytes()
            require(data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24, f'invalid PNG: {name}')
    if syntax:
        node = shutil.which('node')
        require(bool(node), 'Node.js is required for JavaScript syntax checks')
        for name, path in assets.items():
            if path.suffix == '.js':
                result = subprocess.run([node, '--check', str(path)], capture_output=True, text=True)
                require(result.returncode == 0, f'JS syntax error in {name}: {result.stderr.strip()}')
    return m, assets

def public_source_files(project: Path, directory: str, suffixes: set[str]) -> dict[str, Path]:
    base = project / directory
    require(base.is_dir() and not is_link(base), f'missing or linked source directory: {directory}')
    files = {}
    def visit(folder: Path):
        for path in sorted(folder.iterdir()):
            rel = path.relative_to(project).as_posix()
            require(not is_link(path), f'linked public source entry: {rel}')
            if path.name.startswith('.') or path.name.casefold() in BLOCKED:
                continue
            if path.is_dir():
                visit(path)
            elif path.suffix.casefold() in suffixes:
                files[rel] = safe_file(project, rel)
    visit(base)
    return files

def release_members(project: Path) -> tuple[dict, dict[str, Path], dict[str, Path]]:
    check_privacy(project)
    m, assets = validate_extension(project / 'extension')
    extension = {**extension_runtime_assets(assets), 'LICENSE': safe_file(project, 'LICENSE')}
    portable = {'extension/' + name: path for name, path in assets.items()}
    for name in PUBLIC_FILES + PUBLIC_DOCS:
        portable[name] = safe_file(project, name)
    for directory, suffixes in [('scripts', {'.py', '.mjs'}), ('tests', {'.py', '.mjs', '.html', '.md', '.png'}), ('.github', {'.yml', '.yaml', '.md'})]:
        portable.update(public_source_files(project, directory, suffixes))
    # The portable bundle must retain all locally linked Markdown documentation from README.
    readme = portable['README.md'].read_text(encoding='utf-8-sig')
    for match in re.finditer(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', readme):
        link = match.group(1).strip().split(' ', 1)[0].strip('<>')
        url = urlsplit(link)
        if url.scheme or url.netloc or not url.path.lower().endswith('.md'):
            continue
        relative = unquote(url.path)
        require(relative in portable, f'README link omitted from portable bundle: {relative}')
    return m, extension, portable


def rebuild_userscript_assets(project: Path) -> dict[str, bytes]:
    builder = safe_file(project, 'scripts/build_userscript.mjs')
    with tempfile.TemporaryDirectory(prefix='duallens-verify-user-') as temporary:
        output = Path(temporary) / 'duallens.user.js'
        result = subprocess.run(['node', str(builder), '--output', str(output)], cwd=project,
                                capture_output=True, check=False)
        require(result.returncode == 0 and output.is_file(), 'userscript rebuild failed')
        assets = {'duallens.user.js': output.read_bytes()}
        panel = Path(temporary) / 'duallens-settings.js'
        text = assets['duallens.user.js'].decode('utf-8')
        refs = re.findall(r'^//\s*@resource\s+duallens-settings\s+(\S+)\s*$', text, re.M)
        if panel.exists() or refs:
            require(panel.is_file() and not is_link(panel), 'settings resource rebuild missing or linked')
            content = panel.read_bytes()
            version = read_manifest(project / 'extension')['version']
            digest = hashlib.sha256(content).hexdigest()
            require(refs == [f'https://github.com/ray-oriental/duallens/releases/download/v{version}/duallens-settings.js#sha256={digest}'],
                    'settings resource metadata differs from rebuilt asset')
            assets['duallens-settings.js'] = content
        return assets


def rebuild_userscript(project: Path) -> bytes:
    return rebuild_userscript_assets(project)['duallens.user.js']

def verify_userscript_version(content: bytes, version: str) -> None:
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise CheckError('userscript is not UTF-8') from exc
    header = re.match(r'\A// ==UserScript==\r?\n(.*?)^// ==/UserScript==\r?$', text, re.M | re.S)
    require(header is not None, 'invalid userscript metadata header')
    versions = re.findall(r'^//\s*@version\s+(\S+)\s*$', header.group(1), re.M)
    require(versions == [version], 'userscript metadata version differs from manifest')

def verify_release(project: Path, dist: Path) -> None:
    m, extension, portable = release_members(project)
    names = {f"duallens-extension-v{m['version']}.zip": extension, f"duallens-portable-v{m['version']}.zip": portable}
    store_names = {f"duallens-{store}-store-v{m['version']}.zip" for store in ('chrome','edge')}
    for name in store_names:
        names[name] = extension
    user_name = 'duallens.user.js'
    expected_assets = set(names)
    rebuilt = {}
    if (project / 'scripts/build_userscript.mjs').is_file():
        rebuilt = rebuild_userscript_assets(project)
        expected_assets.update(rebuilt)
    actual_assets = {p.name for p in dist.iterdir() if VERSIONED_ASSET_RE.fullmatch(p.name) or p.name in USERSCRIPT_ASSETS}
    require(actual_assets == expected_assets, 'unexpected, stale or missing release asset')
    checksum_file = safe_file(dist, 'SHA256SUMS')
    checksums = {}
    for line in checksum_file.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9._-]+)', line)
        require(match is not None, 'invalid SHA256SUMS line')
        digest, name = match.groups(); require(name not in checksums, 'duplicate checksum entry'); checksums[name] = digest
    require(set(checksums) == expected_assets, 'SHA256SUMS does not match expected versioned assets')
    for name in expected_assets:
        asset = safe_file(dist, name)
        require(hashlib.sha256(asset.read_bytes()).hexdigest() == checksums[name], f'checksum mismatch: {name}')
    if user_name in expected_assets:
        content = safe_file(dist, user_name).read_bytes()
        verify_userscript_version(content, m['version'])
        for name, expected in rebuilt.items():
            require(safe_file(dist, name).read_bytes() == expected, f'userscript asset differs from rebuilt source: {name}')
    for name, expected in names.items():
        archive = safe_file(dist, name)
        require(hashlib.sha256(archive.read_bytes()).hexdigest() == checksums[name], f'checksum mismatch: {name}')
        with zipfile.ZipFile(archive) as z:
            members = z.infolist()
            require(len(members) == len(expected) and set(z.namelist()) == set(expected), f'unexpected or missing archive member: {name}')
            require(z.testzip() is None, f'ZIP CRC failure: {name}')
            for entry in members:
                require(not entry.is_dir() and not stat.S_ISLNK(entry.external_attr >> 16), f'linked or directory ZIP member: {entry.filename}')
                require(entry.date_time == (1980, 1, 1, 0, 0, 0), f'non-deterministic ZIP timestamp: {entry.filename}')
                content = z.read(entry.filename)
                if name in store_names and entry.filename == 'manifest.json':
                    store_manifest = json.loads(content)
                    require('key' not in store_manifest, 'store manifest contains key')
                    public_manifest = dict(m); public_manifest.pop('key', None)
                    require(store_manifest == public_manifest, 'store manifest differs from source')
                    require(content == json.dumps(public_manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 'store manifest is not deterministic')
                else:
                    require(content == packaged_bytes(expected[entry.filename]), f'archive differs from source: {entry.filename}')
    require('manifest.json' in extension and 'extension/manifest.json' in portable, 'package layout lost manifest')

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-dir', type=Path, default=PROJECT)
    parser.add_argument('--dist-dir', type=Path, help='also verify versioned ZIP assets and checksums')
    args = parser.parse_args(argv)
    try:
        project = args.project_dir.absolute()
        checked = check_privacy(project)
        print(f'PASS privacy: {checked} public files; 0 matches (vendor excluded)')
        m, assets = validate_extension(project / 'extension', syntax=True)
        for directory in ('scripts', 'tests'):
            for source in (project / directory).rglob('*.py'):
                if '__pycache__' not in source.parts:
                    safe_file(project, source.relative_to(project).as_posix())
                    ast.parse(source.read_text(encoding='utf-8-sig'), filename=source.name)
        if args.dist_dir:
            verify_release(project, args.dist_dir.absolute())
        print(f"PASS project v{m['version']}: {len(assets)} runtime assets; imports, manifest and syntax valid")
        return 0
    except (CheckError, OSError, ValueError, SyntaxError, zipfile.BadZipFile) as exc:
        print(f'FAIL project: {exc}', file=sys.stderr); return 1

if __name__ == '__main__':
    raise SystemExit(main())
