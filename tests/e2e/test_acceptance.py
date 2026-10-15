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
    def test_restore_exempts_only_same_control_attribute_and_never_text_or_residue(self):
        delta = {'path':'body:0/div:0','attribute':'aria-valuenow','before':'10','after':'11'}
        control = {'complete':True,'restore_attribute_activity':[delta]}
        good = {'restore_attributes':[delta],'restore_text_changes':[],'restore_residue':[],'restore_strict':False}
        result = runner.apply_restore_control(dict(good),control)
        self.assertTrue(result['restore_identical'])
        self.assertFalse(result['restore_strict'])
        for extra in ({'restore_text_changes':[{}]}, {'restore_residue':[{}]},
                      {'restore_attributes':[{**delta,'attribute':'title'}]}):
            self.assertFalse(runner.apply_restore_control({**good,**extra},control)['restore_identical'])
        self.assertFalse(runner.apply_restore_control(dict(good),{**control,'complete':False})['restore_identical'])

    def test_pdf_restore_ignores_toolbar_but_requires_both_original_layers_and_no_residue(self):
        good = {'pdf_source_dom_identical':True,'pdf_original_pixels_identical':True,
                'restore_strict':False,'restore_text_changes':[{'path':'toolbar'}],'restore_residue':[]}
        self.assertTrue(runner.pdf_restore_verdict(good))
        for change in ({'pdf_source_dom_identical':False},{'pdf_original_pixels_identical':None},{'restore_residue':[{'attribute':'class'}]}):
            self.assertFalse(runner.pdf_restore_verdict({**good,**change}))

    def test_gateway_policy_preserves_enabled_flags_and_configured_free_models_only(self):
        config = {'port':18790,'auto':{'prefer':['claude/anything','hermes/paid','hermes/*','sjtu/fast','ollama/small']},
                  'remote':{'enabled':True},'claude':{'enabled':True},'codex':{'enabled':True},
                  'hermes':{'enabled':True,'models':['paid','approved:free']},
                  'ollama':{'enabled':False,'models':['small']},'sjtu':{'enabled':True,'models':['fast'],'daily_limit':30}}
        runner.gateway_policy(config)
        self.assertEqual(config['port'],18799)
        self.assertEqual(config['hermes']['models'],['approved:free'])
        self.assertEqual(config['sjtu']['daily_limit'],15)
        self.assertEqual(config['auto']['prefer'],['hermes/*','sjtu/fast','hermes/approved:free'])
        for key in ('claude','codex','remote','ollama'):
            self.assertFalse(config[key]['enabled'])

    def test_sjtu_budget_persists_before_attempt_and_cannot_reset_on_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'budget.json'
            a,b = runner.SjtuBudget(path),runner.SjtuBudget(path)
            for i in range(15):
                (a if i%2 else b).take()
            with self.assertRaises(RuntimeError):
                runner.SjtuBudget(path).take()
            self.assertEqual(json.loads(path.read_text())['attempts'],15)
            path.write_text('{broken',encoding='utf-8')
            with self.assertRaises(ValueError):
                a.take()
            self.assertFalse(path.with_suffix('.lock').exists())

    def test_fallback_relation_is_visible_in_matrix(self):
        self.assertIn('guardian (替补 ap)',runner.markdown([{'id':'guardian','device':'desktop','status':'FAIL','fallback_for':'ap'}]))

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

    async def test_leader_identifier_brand_and_contextual_name_exclusions_are_listed(self):
        cohort = await self.fixture('<p>HTML</p><p>MIT License</p><p>camelCase</p><p>snake_case</p>'
            '<p>owner/repo</p><p>v1.2.3</p><p>file.name</p><a href="https://example.org/Token">Token</a>'
            '<a class="hnuser">Jane Doe</a><p>@janedoe</p><p>Read More</p><p>Hello.</p><p>Go</p>')
        self.assertEqual(cohort['total'],2)
        reasons = [x['reason'] for x in cohort['exclusions']]
        self.assertIn('brand-product-language',reasons)
        self.assertIn('person-or-username',reasons)
        self.assertIn('link-path-identifier',reasons)
        self.assertEqual(len(cohort['exclusions']),11)

    async def test_unchanged_marker_and_legacy_whole_host_are_excluded_but_pending_is_missing(self):
        await self.fixture('<p id="same">Proper name</p><p id="old">Legacy proper name</p><p id="pending">Translate this.</p>')
        await self.page.evaluate("""()=>{document.querySelector('#same').dataset.dlState='same';
          const old=document.querySelector('#old');old.dataset.dlState='done';old.dataset.dlId='1';
          document.querySelector('#pending').dataset.dlState='pending';}""")
        result = await self.page.evaluate('__dlAcceptance.sample()')
        self.assertEqual((result['initial_total'],result['total'],result['covered']),(3,1,0))
        self.assertEqual({x['reason'] for x in result['exclusions']},
                         {'mt-returned-unchanged-marker','mt-returned-unchanged-inferred'})
        self.assertEqual(result['missing'][0]['text'],'Translate this.')

    async def test_removed_host_cannot_keep_detached_translation_covered(self):
        await self.fixture('<p>Original prose.</p>')
        await self.page.evaluate("""()=>{const p=document.querySelector('p');p.dataset.dlId='1';
          p.insertAdjacentHTML('beforeend','<dl-t data-dl-id=1 data-dl-state=done>原文翻译</dl-t>');p.remove();}""")
        self.assertEqual((await self.page.evaluate('__dlAcceptance.sample()'))['covered'],0)

    async def test_restore_tracks_attributes_text_and_extension_residue_separately(self):
        await self.fixture('<p title="Original" style="color:red">Original prose.</p><input placeholder="Search">')
        await self.page.evaluate("""()=>{const p=document.querySelector('p');p.setAttribute('class','');
          p.dataset.dlState='done';p.title='Changed';p.style.color='blue';
          document.querySelector('input').placeholder='搜索';p.firstChild.data='Changed prose.';}""")
        result = await self.page.evaluate('__dlAcceptance.restoreResult()')
        self.assertFalse(result['restore_identical'])
        self.assertFalse(result['restore_strict'])
        self.assertEqual({x['attribute'] for x in result['restore_residue']},{'class','data-dl-state'})
        self.assertEqual(result['restore_text_changes'][0]['reason'],'content')
        self.assertTrue({'title','style','placeholder'}.issubset({x['attribute'] for x in result['restore_attributes']}))

    async def test_restore_preserves_preexisting_empty_class_and_ignores_only_ui_host(self):
        await self.fixture('<p class="">Original prose.</p>')
        await self.page.evaluate("document.body.appendChild(document.createElement('dl-ui'))")
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])
        await self.page.evaluate("document.body.appendChild(document.createElement('dl-w'))")
        self.assertFalse((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])

    async def test_restore_document_order_and_parent_paths_are_required(self):
        await self.fixture('<p>First prose.</p><p>Second prose.</p>')
        await self.page.evaluate("document.body.prepend(document.querySelectorAll('p')[1])")
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_text_changes'])

    async def test_restore_does_not_mislabel_site_created_empty_class_as_extension_residue(self):
        await self.fixture('<p>Original prose.</p>')
        await self.page.evaluate("""()=>{const span=document.createElement('span');span.className='';span.textContent='Site update';document.body.append(span);}""")
        result = await self.page.evaluate('__dlAcceptance.restoreResult()')
        self.assertFalse(result['restore_strict'])
        self.assertTrue(result['restore_identical'])
        self.assertFalse(result['restore_residue'])

    async def test_removed_text_does_not_cascade_false_order_diagnostics(self):
        await self.fixture('<p>First prose.</p><p>Second prose.</p><p>Third prose.</p>')
        await self.page.evaluate("document.querySelector('p').firstChild.remove()")
        changes=(await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_text_changes']
        self.assertEqual(len(changes),1)
        self.assertEqual(changes[0]['reason'],'removed')

    async def test_control_records_transient_attribute_changes(self):
        await self.fixture('<p title="Original">Original prose.</p>')
        await self.page.evaluate('__dlAcceptance.start()')
        await self.page.evaluate("document.querySelector('p').title='temporary'")
        await self.page.evaluate("document.querySelector('p').title='Original'")
        result = await self.page.evaluate('__dlAcceptance.restoreResult()')
        self.assertTrue(result['restore_identical'])
        self.assertEqual(result['restore_attribute_activity'],[{'path':'body:0/p:0','attribute':'title'}])

    async def test_denominator_exceptions_attributes_and_no_minchars(self):
        original = '<p>English prose.</p><button>Yes</button><span>I</span><p>中文原文</p><code>Code</code><p>1234</p><p>https://example.com</p><p hidden>Invisible</p><p style="position:absolute;top:2000px">Offscreen</p><input placeholder="Search"><textarea placeholder="Your comment"></textarea>'
        cohort = await self.fixture(original)
        self.assertEqual(cohort['total'], 5)
        self.assertEqual((await self.page.evaluate('__dlAcceptance.sample()'))['coverage'], 0)
        self.assertTrue((await self.page.evaluate('__dlAcceptance.restoreResult()'))['restore_identical'])

    async def test_obvious_code_tokens_outside_code_tags_are_exempt(self):
        cohort = await self.fixture('<p>637fb36</p><p>'+('a1'*32)+'</p><p>'+('f'*128)+'</p><p>.devcontainer</p><p>main.py</p><p>[v7]</p><p>arXiv:1706.03762</p><p>2.7k</p><p>Read more</p><button>Yes</button>')
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

    async def test_explicit_whole_host_covers_css_block_spans_but_never_mismatched_id(self):
        await self.fixture('<span id="counter" style="display:inline-block"><span style="display:block">items</span></span>')
        await self.page.evaluate("""()=>{const p=document.querySelector('#counter');p.dataset.dlId='1';
          p.insertAdjacentHTML('beforeend','<dl-t data-dl-id=2 data-dl-state=done>项目</dl-t>');}""")
        self.assertEqual((await self.page.evaluate('__dlAcceptance.sample()'))['covered'],0)
        await self.page.evaluate("document.querySelector('dl-t').dataset.dlId='1'")
        self.assertEqual((await self.page.evaluate('__dlAcceptance.sample()'))['covered'],1)

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
