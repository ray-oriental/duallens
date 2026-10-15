"""Offline tests of independent acceptance metrics; no extension/model/network."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch, AsyncMock

import run_acceptance as runner
from merge_acceptance import merge
from playwright.async_api import async_playwright


class ReportTests(unittest.TestCase):
    def test_sites_cover_requested_classes(self):
        sites = runner.load_sites()
        self.assertGreaterEqual(len(sites), 18)
        self.assertIn('wiki', {s['id'] for s in sites})
        self.assertEqual(next(s['pages'] for s in sites if s['id'] == 'lecture-pdf'), [1, 2, 11])

    def test_missing_measurements_and_inaccessible_are_never_pass(self):
        good = dict(t_first=2.99, coverage=.95, restore_identical=True, layout_issues=[], visible_errors=[])
        self.assertEqual(runner.outcome(good), 'PASS')
        for patch in ({'t_first': None}, {'coverage': .949}, {'restore_identical': False},
                      {'layout_issues': [{}]}, {'visible_errors': [{}]}, {'t_first': 3.01}):
            self.assertEqual(runner.outcome({**good, **patch}), 'FAIL')
        self.assertEqual(runner.outcome({**good, 'status': 'UNREACHABLE'}), 'UNREACHABLE')

    def test_markdown_keeps_missing_distinct_from_zero(self):
        text = runner.markdown([{'id': 'wiki', 'device': 'desktop', 't_first': 0,
            'coverage': 0, 'restore_identical': False, 'status': 'FAIL'}])
        self.assertIn('| 0.000 | — | — | 0.0% | 0 | NO | FAIL |', text)

    def test_gm_transport_rejects_arbitrary_or_authenticated_destination(self):
        for url in ['http://127.0.0.1:18790/v1', 'https://example.com/', 'https://user:pass@edge.microsoft.com/']:
            with self.assertRaises(ValueError):
                runner.direct_request({'url': url})

    def test_gateway_child_cannot_use_the_production_state_directory(self):
        with self.assertRaises(ValueError):
            runner.gateway_child(runner.REPO, Path.home()/'.duallens')

    def test_gm_zero_timeout_uses_host_deadline_instead_of_nonblocking_socket(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.read.return_value = b'[]'
        response.code = 200
        with patch('urllib.request.build_opener', return_value=opener):
            runner.direct_request({'url': 'https://edge.microsoft.com/translate/translatetext', 'timeout': 0})
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 30)

    def test_explicit_overlay_preserves_provenance_and_does_not_mutate_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = [Path(tmp)/'first', Path(tmp)/'second']
            for i, path in enumerate(paths):
                path.mkdir()
                (path/'matrix.json').write_text(json.dumps({'metadata': {'run_id': str(i), 'extension_tree_sha256': 'same',
                    'userscript_sha256': 'same', 'llm': 'none', 'complete': True},
                    'rows': [{'id': 'wiki', 'device': 'desktop', 'status': 'FAIL' if i == 0 else 'PASS'}]}), encoding='utf-8')
            meta, rows = merge(paths)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['status'], 'PASS')
            self.assertEqual(rows[0]['source_run_id'], '1')
            self.assertEqual(json.loads((paths[0]/'matrix.json').read_text())['rows'][0]['status'], 'FAIL')
            data = json.loads((paths[1]/'matrix.json').read_text())
            data['metadata']['extension_tree_sha256'] = 'changed'
            (paths[1]/'matrix.json').write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                merge(paths)


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(headless=True, args=['--no-proxy-server'])
        self.page = await self.browser.new_page(viewport={'width': 1280, 'height': 800})

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()

    async def fixture(self, html):
        await self.page.set_content(html)
        await self.page.evaluate(runner.PROBE)
        return await self.page.evaluate('__dlAcceptance.freeze()')

    async def test_denominator_exceptions_attributes_and_no_minchars(self):
        original = '<p>English prose.</p><button>Go</button><span>I</span><p>中文原文</p><code>Code</code><p>1234</p><p>https://example.com</p><p hidden>Invisible</p><p style="position:absolute;top:2000px">Offscreen</p><input placeholder="Search"><textarea placeholder="Your comment"></textarea>'
        cohort = await self.fixture(original)
        self.assertEqual(cohort['total'], 5)
        self.assertEqual((await self.page.evaluate('__dlAcceptance.sample()'))['coverage'], 0)
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])

    async def test_obvious_code_tokens_outside_code_tags_are_exempt(self):
        cohort = await self.fixture('<p>637fb36</p><p>.devcontainer</p><p>main.py</p><p>[v7]</p><p>arXiv:1706.03762</p><p>2.7k</p><p>Read more</p><button>Go</button>')
        self.assertEqual(cohort['total'], 2)

    async def test_pdf_denominator_exempts_addresses_but_not_skipped_prose(self):
        await self.fixture('<p>Original page.</p>')
        await self.page.evaluate("""()=>{window.__acceptancePdfStart=performance.now();
          window.__duallensPdfBlocks=()=>[{id:1,source:'Ordinary untranslated sentence.',state:'skip'},
            {id:2,source:'author@example.com',state:'skip'}, {id:3,source:'x'.repeat(120),state:'skip'}];}""")
        data = await self.page.evaluate(runner.PDF_SAMPLE, {'n': 1, 'ids': [1, 2, 3]})
        self.assertEqual(data['total'], 2)
        self.assertEqual([b['id'] for b in data['blocks']], [1, 3])
        self.assertEqual([b['id'] for b in data['exclusions']], [2])

    async def test_body_overflow_propagates_to_viewport_even_at_zero_body_height(self):
        cohort = await self.fixture('<style>body{height:0;overflow:auto}</style><p>Actually visible.</p>')
        self.assertEqual(cohort['total'], 1)

    async def test_invisible_recaptcha_badge_is_not_an_access_wall(self):
        await self.fixture('<p>Public article.</p><iframe src="about:blank#captcha" style="display:none"></iframe>')
        self.assertIsNone(await runner.unreachable(self.page, None))
        await self.page.locator('iframe').evaluate("e=>{e.style.display='block';e.style.width='400px';e.style.height='400px'}")
        self.assertIn('Human verification', await runner.unreachable(self.page, None))

    async def test_whole_unit_covers_nested_inline_text_nodes(self):
        await self.fixture('<p id="p">Read <strong>this link</strong> now.</p>')
        await self.page.evaluate("""()=>{const p=document.querySelector('p');p.dataset.dlId='1';p.insertAdjacentHTML('beforeend','<dl-t data-dl-id="1" data-dl-state="done" data-dl-stage="final" data-dl-engine="llm">阅读这个链接。</dl-t>');} """)
        s = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual((s['total'], s['covered'], s['refined']), (3, 3, 3))

    async def test_earlier_untranslated_run_cannot_borrow_later_translation(self):
        await self.fixture('<p><span>Earlier untranslated.</span><br><span>Later translated.</span></p>')
        await self.page.evaluate("document.querySelector('p').insertAdjacentHTML('beforeend','<dl-t data-dl-state=done>后面的翻译</dl-t>')")
        s = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual((s['total'], s['covered']), (2, 1))
        self.assertEqual(s['missing'][0]['text'], 'Earlier untranslated.')

    async def test_later_block_cannot_borrow_ancestor_translation(self):
        await self.fixture('<div>Parent text.<section>Untranslated child.</section></div>')
        await self.page.evaluate("document.querySelector('div').insertAdjacentHTML('beforeend','<dl-t data-dl-state=done>父级翻译</dl-t>')")
        s = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual(s['covered'], 0)

    async def test_target_echo_and_detached_source_fail(self):
        await self.fixture('<p>Hello</p><p>Goodbye</p>')
        await self.page.evaluate("""()=>{document.querySelector('p').insertAdjacentHTML('beforeend','<dl-t data-dl-state=done>Hello</dl-t>');document.querySelectorAll('p')[1].remove();}""")
        s = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual(s['covered'], 0)
        self.assertIn('source-detached', [x['reason'] for x in s['missing']])

    async def test_frozen_cohort_survives_layout_shift(self):
        await self.fixture('<p id="a">Visible before.</p><p id="b">Also initially visible.</p>')
        await self.page.evaluate("document.querySelector('#a').style.height='2000px'")
        s = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual(s['total'], 2)

    async def test_timing_ignores_offscreen_translation(self):
        await self.fixture('<p>Visible source.</p><div style="position:absolute;top:2000px" id="off"></div>')
        await self.page.evaluate('__dlAcceptance.start()')
        await self.page.evaluate("document.querySelector('#off').insertAdjacentHTML('beforeend','<dl-t data-dl-state=done>远处译文</dl-t>')")
        self.assertNotIn('t_first', await self.page.evaluate('__dlAcceptance.sample()'))

    async def test_layout_detects_new_overflow_and_contrast(self):
        await self.fixture('<style>button{width:60px;height:30px;background:#111;color:#222}</style><button>Hello</button>')
        await self.page.evaluate("document.querySelector('button').insertAdjacentHTML('beforeend','<dl-t data-dl-state=done style=" + '"white-space:nowrap"' + ">很长很长很长的中文翻译</dl-t>')")
        issues = await self.page.evaluate('__dlAcceptance.layout(true)')
        self.assertIn('new-horizontal-overflow', [i['type'] for i in issues])
        self.assertIn('low-dark-contrast', [i['type'] for i in issues])

    async def test_srgb_computed_contrast_uses_255_channel_scale(self):
        await self.fixture('<p style="background:black;color:color(srgb 1 1 1)">White on black.</p>')
        ratio = await self.page.evaluate("__dlAcceptance.contrast(document.querySelector('p'))")
        self.assertAlmostEqual(ratio, 21, places=4)

    async def test_site_exclusion_is_explicit_and_occlusion_counts(self):
        cohort = await self.fixture('<p class="excluded">Excluded by site.</p><p>Visible.</p>')
        self.assertEqual(cohort['total'], 2)
        self.assertEqual((await self.page.evaluate("__dlAcceptance.freeze('.excluded')"))['total'], 1)

    async def test_screenshots_do_not_add_empty_style_attributes(self):
        await self.fixture('<input type="checkbox"><input placeholder="Search"><p>Text.</p>')
        await self.page.screenshot(caret='initial')
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])

    async def test_native_capture_handles_scrolled_document_clips_without_dom_writes(self):
        await self.fixture('<input><div style="height:3000px">A long document.</div>')
        await self.page.evaluate('scrollTo(0,1000)')
        with tempfile.TemporaryDirectory() as tmp:
            paths, errors = await runner.screenshot(self.page, Path(tmp), 'probe-desktop', [])
            self.assertEqual(errors, [])
            self.assertEqual(len(paths), 2)
            viewport_png = (Path(tmp)/'probe-desktop-viewport.png').read_bytes()
            self.assertEqual(int.from_bytes(viewport_png[20:24], 'big'), 800)
            png = (Path(tmp)/'probe-desktop-full.png').read_bytes()
            height = int.from_bytes(png[20:24], 'big')
            self.assertGreater(height, 800)
            self.assertLessEqual(height, 3200)
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])

    async def test_capture_survives_destroyed_navigation_javascript_context(self):
        await self.fixture('<p>Browser error surface.</p>')
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(self.page, 'evaluate', new=AsyncMock(side_effect=RuntimeError('Execution context destroyed'))):
                paths, errors = await runner.screenshot(self.page, Path(tmp), 'error-desktop', [])
            self.assertEqual(errors, [])
            self.assertEqual(len(paths), 2)


if __name__ == '__main__':
    unittest.main()
