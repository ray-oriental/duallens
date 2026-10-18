"""Release behavior tests with isolated synthetic public projects; no network or model calls."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from build_release import build_release
from check_project import CheckError, GATEWAY_FILES, PUBLIC_FILES, PUBLIC_DOCS, packaged_bytes, validate_extension, verify_release

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJX0AAAAASUVORK5CYII=')

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.cache = Path.home() / '.cache' / 'duallens-release-tests'
        self.cache.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='fixture-', dir=self.cache)
        self.project = Path(self.temp.name) / 'project'; self.project.mkdir()
        self.out = Path(self.temp.name) / 'dist'
        self.write('extension/manifest.json', json.dumps({'manifest_version':3, 'version':'0.1.0', 'background':{'type':'module','service_worker':'background/main.js'}, 'content_scripts':[{'js':['content/loader.js']}], 'action':{'default_popup':'ui/popup.html','default_icon':{'1':'icons/1.png'}}, 'options_page':'ui/popup.html', 'icons':{'1':'icons/1.png'}, 'web_accessible_resources':[{'resources':['content/*.js','shared/*.js'],'matches':['<all_urls>']}]}))
        self.write('extension/background/main.js', 'import "../shared/defs.js";\n')
        self.write('extension/content/loader.js', 'void 0;\n')
        self.write('extension/shared/defs.js', 'export const value = 1;\n')
        self.write('extension/ui/popup.html', '<!doctype html><link rel="stylesheet" href="ui.css"><img src="../icons/1.png"><script type="module" src="popup.js"></script>')
        self.write('extension/ui/popup.js', 'import "../shared/defs.js";\n')
        self.write('extension/ui/ui.css', 'body { color: black; }\n')
        icon = self.project / 'extension/icons/1.png'; icon.parent.mkdir(); icon.write_bytes(PNG)
        for name in PUBLIC_FILES + PUBLIC_DOCS + GATEWAY_FILES:
            self.write(name, '# public fixture\n')
        self.write('README.md', '# Fixture\n[Specification](docs/SPEC.md)\n')
        self.write('package.json', '{"type":"module"}\n')
        self.write('scripts/check_project.py', '# public fixture\n')
        self.write('tests/unit/example.test.mjs', '// public fixture\n')
        self.write('.github/workflows/ci.yml', 'name: fixture\n')
    def tearDown(self):
        self.assertEqual(Path(self.temp.name).resolve().parent, self.cache.resolve())
        self.temp.cleanup()
    def write(self, relative, text):
        path = self.project / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text,encoding='utf-8')
        return path
    def build(self):
        return build_release(self.project, self.out)
    def userscript_builder(self):
        return self.write('scripts/build_userscript.mjs', """import fs from 'node:fs/promises';
import path from 'node:path';
const version=JSON.parse(await fs.readFile('extension/manifest.json','utf8')).version;
const output=process.argv[2]==='--output'?process.argv[3]:'dist/duallens.user.js';
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,'// ==UserScript==\\n// @version '+version+'\\n// ==/UserScript==\\n// fixture userscript\\n');
""")
    def rehash(self):
        sums = self.out / 'SHA256SUMS'
        names = [line.split('  ', 1)[1] for line in sums.read_text().splitlines()]
        sums.write_text(''.join(f'{hashlib.sha256((self.out/name).read_bytes()).hexdigest()}  {name}\n' for name in names), encoding='utf-8')
    def replace_zip_member(self, name, member, content):
        archive = self.out / name
        with zipfile.ZipFile(archive) as z:
            rows = [(entry, content if entry.filename == member else z.read(entry.filename)) for entry in z.infolist()]
        with zipfile.ZipFile(archive, 'w') as z:
            for entry, data in rows:
                z.writestr(entry, data)
        self.rehash()
    def test_two_archives_and_sha256_validate(self):
        paths = self.build(); self.assertEqual(len(paths),3)
        verify_release(self.project,self.out)
        with zipfile.ZipFile(self.out/'duallens-extension-v0.1.0.zip') as z:
            self.assertIn('manifest.json',z.namelist()); self.assertNotIn('extension/manifest.json',z.namelist())
        with zipfile.ZipFile(self.out/'duallens-portable-v0.1.0.zip') as z:
            self.assertIn('extension/manifest.json',z.namelist()); self.assertIn('gateway/duallens_gateway.py',z.namelist()); self.assertIn('tests/unit/example.test.mjs',z.namelist())

    def test_edge_store_target_removes_manifest_key_and_keeps_extension_members(self):
        manifest = self.project / 'extension/manifest.json'
        data = json.loads(manifest.read_text())
        data['key'] = 'public-test-key'
        manifest.write_text(json.dumps(data), encoding='utf-8')
        paths = build_release(self.project, self.out, 'edge-store')
        self.assertEqual([p.name for p in paths], ['duallens-extension-v0.1.0.zip', 'duallens-portable-v0.1.0.zip', 'duallens-edge-store-v0.1.0.zip', 'SHA256SUMS'])
        verify_release(self.project, self.out)
        with zipfile.ZipFile(self.out/'duallens-edge-store-v0.1.0.zip') as edge:
            self.assertNotIn('key', json.loads(edge.read('manifest.json')))
            self.assertEqual(set(edge.namelist()), {'LICENSE', 'manifest.json', 'background/main.js', 'content/loader.js', 'shared/defs.js', 'ui/popup.html', 'ui/popup.js', 'ui/ui.css', 'icons/1.png'})

    def test_userscript_builder_is_optional_and_added_when_present(self):
        self.userscript_builder()
        paths = self.build()
        self.assertIn(self.out/'duallens.user.js', paths)
        self.assertIn('duallens.user.js', (self.out/'SHA256SUMS').read_text(encoding='utf-8'))
        verify_release(self.project, self.out)
        self.assertFalse((self.project / 'dist').exists(), 'builder wrote into source project instead of staging')

    def settings_builder(self):
        builder = self.userscript_builder()
        builder.write_text(builder.read_text(encoding='utf-8') + r"""
const panel='(function(){return {mountSettingsForm(){}};})();\n';
const {createHash}=await import('node:crypto');
const hash=createHash('sha256').update(panel).digest('hex');
const line='// @resource duallens-settings https://github.com/ray-oriental/duallens/releases/download/v'+version+'/duallens-settings.js#sha256='+hash+'\n';
await fs.writeFile(path.join(path.dirname(output),'duallens-settings.js'),panel);
await fs.writeFile(output,(await fs.readFile(output,'utf8')).replace('// ==/UserScript==',line+'// ==/UserScript=='));
""", encoding='utf-8')
        return builder

    def test_settings_resource_is_packaged_hashed_and_rebuilt(self):
        self.settings_builder()
        self.assertIn(self.out / 'duallens-settings.js', self.build())
        self.assertIn('  duallens-settings.js\n', (self.out / 'SHA256SUMS').read_text())
        verify_release(self.project, self.out)
        resource = self.out / 'duallens-settings.js'
        resource.write_text(resource.read_text() + '// tampered\n')
        with self.assertRaisesRegex(CheckError, 'checksum mismatch'):
            verify_release(self.project, self.out)
        self.rehash()
        with self.assertRaisesRegex(CheckError, 'rebuilt source'):
            verify_release(self.project, self.out)
        self.build(); resource.unlink()
        with self.assertRaisesRegex(CheckError, 'missing release asset'):
            verify_release(self.project, self.out)

    def test_settings_resource_metadata_must_pin_release_version_and_digest(self):
        builder = self.settings_builder()
        original = builder.read_text(encoding='utf-8')
        self.build()
        before = (self.out / 'SHA256SUMS').read_bytes()
        for code in [original.replace("'/duallens-settings.js#sha256='+hash", "'/duallens-settings.js#sha256='+'0'.repeat(64)"),
                     original.replace("'/duallens-settings.js#sha256='", "'/wrong-settings.js#sha256='")]:
            builder.write_text(code, encoding='utf-8')
            with self.assertRaisesRegex(CheckError, 'settings resource metadata'):
                self.build()
            self.assertEqual((self.out / 'SHA256SUMS').read_bytes(), before)

    def test_obsolete_settings_resource_is_removed_when_no_longer_built(self):
        self.settings_builder(); self.build()
        self.userscript_builder(); self.build()
        self.assertFalse((self.out / 'duallens-settings.js').exists())
        verify_release(self.project, self.out)

    def test_userscript_hash_metadata_and_rebuild_are_all_checked(self):
        self.userscript_builder()
        for mode, error in [('hash', 'checksum mismatch'), ('version', 'metadata version'), ('header', 'metadata header'), ('duplicate', 'metadata version'), ('bytes', 'rebuilt source')]:
            with self.subTest(mode=mode):
                self.build()
                user = self.out / 'duallens.user.js'
                content = user.read_text()
                if mode == 'version': content = content.replace('@version 0.1.0', '@version 9.9.9')
                elif mode == 'header': content = content.replace('==UserScript==', 'invalid')
                elif mode == 'duplicate': content = content.replace('// @version 0.1.0', '// @version 0.1.0\n// @version 0.1.0')
                else: content += '// changed\n'
                user.write_text(content, encoding='utf-8')
                if mode != 'hash': self.rehash()
                with self.assertRaisesRegex(CheckError, error): verify_release(self.project, self.out)

    def test_missing_userscript_or_checksum_entry_is_rejected(self):
        self.userscript_builder(); self.build()
        (self.out / 'duallens.user.js').unlink()
        with self.assertRaisesRegex(CheckError, 'missing release asset'): verify_release(self.project, self.out)
        self.build()
        sums = self.out / 'SHA256SUMS'
        sums.write_text(''.join(line+'\n' for line in sums.read_text().splitlines() if not line.endswith('duallens.user.js')))
        with self.assertRaisesRegex(CheckError, 'expected versioned assets'): verify_release(self.project, self.out)

    def test_edge_store_key_members_and_source_bytes_are_checked(self):
        self.userscript_builder()
        name = 'duallens-edge-store-v0.1.0.zip'
        for mode, error in [('key', 'manifest contains key'), ('manifest', 'manifest differs'), ('source', 'archive differs'), ('extra', 'unexpected or missing archive member')]:
            with self.subTest(mode=mode):
                build_release(self.project, self.out, 'edge-store')
                if mode in {'key', 'manifest'}:
                    with zipfile.ZipFile(self.out/name) as z: data = json.loads(z.read('manifest.json'))
                    data['key' if mode == 'key' else 'name'] = 'public fixture'
                    self.replace_zip_member(name, 'manifest.json', json.dumps(data).encode())
                elif mode == 'source': self.replace_zip_member(name, 'shared/defs.js', b'// changed\n')
                else:
                    with zipfile.ZipFile(self.out/name, 'a') as z: z.writestr('extra.txt', 'fixture')
                    self.rehash()
                with self.assertRaisesRegex(CheckError, error): verify_release(self.project, self.out)

    def test_old_versions_are_cleaned_and_current_store_is_rebuilt(self):
        self.userscript_builder(); build_release(self.project, self.out, 'edge-store')
        for kind in ['extension', 'portable', 'edge-store']:
            (self.out / f'duallens-{kind}-v0.0.9.zip').write_text('stale')
        unrelated = self.out / 'notes.txt'; unrelated.write_text('keep')
        self.build(); verify_release(self.project, self.out)
        self.assertTrue((self.out/'duallens-edge-store-v0.1.0.zip').exists())
        self.assertFalse(any(self.out.glob('*v0.0.9.zip')))
        self.assertEqual(unrelated.read_text(), 'keep')
        manifest = self.project/'extension/manifest.json'
        data = json.loads(manifest.read_text()); data['version'] = '0.2.0'; manifest.write_text(json.dumps(data))
        self.build(); verify_release(self.project, self.out)
        self.assertFalse(any(self.out.glob('*v0.1.0.zip')))

    def test_stale_directory_asset_is_rejected_even_if_unlisted_in_checksums(self):
        self.build(); (self.out/'duallens-extension-v0.0.9.zip').write_text('stale')
        with self.assertRaisesRegex(CheckError, 'stale'): verify_release(self.project, self.out)

    def test_failed_userscript_build_preserves_previous_release(self):
        self.userscript_builder(); self.build()
        before = {p.name:p.read_bytes() for p in self.out.iterdir()}
        self.write('scripts/build_userscript.mjs', 'process.exit(1);')
        with self.assertRaisesRegex(CheckError, 'rebuild failed'): self.build()
        self.assertEqual(before, {p.name:p.read_bytes() for p in self.out.iterdir()})
    def test_repeated_build_is_byte_identical(self):
        first = {p.name:p.read_bytes() for p in self.build()}
        second = {p.name:p.read_bytes() for p in self.build()}
        self.assertEqual(first,second)
    def test_crlf_lf_and_bom_checkouts_produce_same_release(self):
        first = {p.name:p.read_bytes() for p in self.build()}
        for source in self.project.rglob('*'):
            if source.is_file() and source.suffix != '.png':
                data = source.read_bytes().decode('utf-8-sig').replace('\r\n','\n').replace('\r','\n')
                source.write_bytes(b'\xef\xbb\xbf' + data.replace('\n','\r\n').encode('utf-8'))
        second = {p.name:p.read_bytes() for p in self.build()}
        self.assertEqual(first,second)
        verify_release(self.project,self.out)
        with zipfile.ZipFile(self.out/'duallens-portable-v0.1.0.zip') as z:
            script=z.read('gateway/Install-Startup.ps1')
            self.assertTrue(script.startswith(b'\xef\xbb\xbf'))
            self.assertNotIn(b'\r',script)
        self.assertEqual(packaged_bytes(self.project/'extension/icons/1.png'),PNG)
    def test_runtime_private_reference_and_generator_are_excluded(self):
        for name in ['extension/private/fixture.json','extension/.env','extension/icons/generate_icons.py','gateway/state.json','gateway/__pycache__/bad.pyc','docs/research/notes.md','docs/HANDOFF.md','scripts/.cache/data.py']:
            self.write(name,'excluded fixture\n')
        self.build(); verify_release(self.project,self.out)
        for name in ['duallens-extension-v0.1.0.zip','duallens-portable-v0.1.0.zip']:
            with zipfile.ZipFile(self.out/name) as z:
                self.assertFalse(any('private/' in x or 'research/' in x or 'HANDOFF' in x or 'generate_icons.py' in x or 'state.json' in x or '.env' in x or '__pycache__' in x or '/.cache/' in x for x in z.namelist()))
    def test_missing_manifest_reference_rejected_before_output(self):
        (self.project/'extension/content/loader.js').unlink()
        with self.assertRaisesRegex(CheckError,'missing packaged manifest reference'):
            self.build()
        self.assertFalse(self.out.exists())
    def test_empty_runtime_asset_rejected(self):
        self.write('extension/shared/defs.js','')
        with self.assertRaisesRegex(CheckError,'empty file'):
            self.build()
    def test_unresolved_module_import_rejected(self):
        self.write('extension/ui/popup.js','import "./missing.js";\n')
        with self.assertRaisesRegex(CheckError,'missing file'):
            self.build()
    def test_html_reference_outside_extension_rejected(self):
        self.write('extension/ui/popup.html','<img src="../../LICENSE">')
        with self.assertRaisesRegex(CheckError,'escapes extension'):
            self.build()
    def test_external_script_dependency_rejected(self):
        self.write('extension/ui/popup.html','<script src="https://example.com/a.js"></script>')
        with self.assertRaisesRegex(CheckError,'external runtime dependency'):
            self.build()
    def test_invalid_version_rejected(self):
        manifest = self.project/'extension/manifest.json'; data=json.loads(manifest.read_text()); data['version']='../../escape'; manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(CheckError,'invalid manifest version'):
            self.build()
    def test_symlink_outside_extension_rejected(self):
        outside = Path(self.temp.name)/'outside.txt'; outside.write_text('fixture')
        linked = self.project/'extension/linked.txt'
        try:
            linked.symlink_to(outside)
        except OSError:
            self.skipTest('symbolic link creation unavailable on this host')
        try:
            with self.assertRaisesRegex(CheckError,'linked extension entry'):
                self.build()
        finally:
            linked.unlink()
    def test_readme_private_link_cannot_enter_portable(self):
        self.write('README.md','[Private](docs/research/notes.md)')
        with self.assertRaisesRegex(CheckError,'README link omitted'):
            self.build()
    def test_extra_archive_member_rejected_even_with_valid_hash(self):
        self.build(); archive=self.out/'duallens-extension-v0.1.0.zip'
        with zipfile.ZipFile(archive,'a') as z:
            z.writestr('private/extra.txt','fixture')
        sums=self.out/'SHA256SUMS'; old=sums.read_text(); lines=[]
        for line in old.splitlines():
            digest,name=line.split('  '); lines.append(f"{hashlib.sha256(archive.read_bytes()).hexdigest() if name==archive.name else digest}  {name}\n")
        sums.write_text(''.join(lines),encoding='utf-8')
        with self.assertRaisesRegex(CheckError,'unexpected or missing archive member'):
            verify_release(self.project,self.out)
    def test_checksum_tampering_rejected(self):
        self.build(); sums=self.out/'SHA256SUMS'; text=sums.read_text(); sums.write_text('0'*64+text[64:],encoding='utf-8')
        with self.assertRaisesRegex(CheckError,'checksum mismatch'):
            verify_release(self.project,self.out)

if __name__ == '__main__':
    unittest.main()
