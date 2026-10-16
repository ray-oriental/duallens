import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfTranslations, renderResult, repairAtoms, restoreLiteralAtoms, MAX_BATCH_ITEMS, identifierOnly } from '../../extension/pdf/translate.js';
import { PRIORITY } from '../../extension/shared/protocol.js';

function fakeService() {
  const calls = [];
  return {
    calls,
    translateBatch(req, onPartial) {
      let finish;
      const call = { req, onPartial, cancelled: false, done: new Promise(resolve => { finish = resolve; }) };
      call.finish = finish;
      calls.push(call);
      return { done: call.done, cancel() { call.cancelled = true; finish(); } };
    },
  };
}
const source = (markup, plain = markup.replace(/<x\d+\/>/g, 'x'), atoms = (markup.match(/<x\d+\/>/g) || []).map(text => ({ text }))) => ({ markup, plain, atoms });
function setup(settings = {}) {
  const service = fakeService();
  const updates = [];
  const session = new PdfTranslations({ service, getSettings: () => ({ targetLang: 'zh-CN', sourceLang: 'auto', minChars: 2, ...settings }),
    getContext: () => ({}), onUpdate: ids => updates.push(...ids) });
  session.start();
  return { service, session, updates };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('PDF translation requests carry draft/purpose flags, batch per 40 items and skip text already in the target language', () => {
  const { service, session } = setup();
  const list = Array.from({ length: 45 }, (_, i) => ({ id: `p1-b${i}`, source: source(`Sentence number ${i} of the page.`) }));
  list.push({ id: 'p1-b45', source: source('这一段已经是中文了，不需要翻译。') }, { id: 'p1-b46', source: source('42') });
  assert.equal(session.request(list, PRIORITY.VISIBLE), 45);
  assert.equal(service.calls.length, 2);
  assert.equal(service.calls[0].req.items.length, MAX_BATCH_ITEMS);
  assert.deepEqual({ ...service.calls[0].req, items: undefined }, { items: undefined, to: 'zh-CN', from: 'auto', priority: PRIORITY.VISIBLE,
    context: {}, draft: true, purpose: 'pdf' });
  assert.equal(session.get('p1-b45').state, 'skip');
  assert.equal(session.get('p1-b46').state, 'skip');
  assert.equal(session.request(list), 0, 'known ids are not requested twice');
  assert.deepEqual(session.stats(), { total: 45, done: 0, draft: 0, pending: 45, failed: 0, unrefined: 0 });
});

test('PDF a machine-translation draft is shown first and replaced in place by the final text', () => {
  const { service, session, updates } = setup();
  session.request([{ id: 'a', source: source('Fix the point <x0/> on the curve.') }, { id: 'b', source: source('Plain words here.') }]);
  const { onPartial } = service.calls[0];
  onPartial([{ id: 'a', text: '固定曲线上的点<x0/>（草稿）', stage: 'draft' }, { id: 'b', text: '普通词语', stage: 'draft' }]);
  assert.equal(session.get('a').state, 'draft');
  assert.deepEqual(session.get('a').nodes, [{ t: 'text', v: '固定曲线上的点' }, { t: 'x', n: 0 }, { t: 'text', v: '（草稿）' }]);
  onPartial([{ id: 'a', text: '固定曲线上的点 <x0/>。', stage: 'final' }]);
  assert.equal(session.get('a').state, 'final');
  assert.equal(session.get('a').refined, true);
  onPartial([{ id: 'a', text: '迟到的草稿', stage: 'draft' }]);
  assert.equal(session.get('a').text, '固定曲线上的点 <x0/>。', 'a late draft never replaces the final text');
  onPartial([{ id: 'b', text: '普通的词语。' }]);
  assert.equal(session.get('b').state, 'final', 'results without stage are final');
  assert.deepEqual(updates, ['a', 'b', 'a', 'b']);
});

test('PDF a plain-text draft for a block with formula atoms waits for the final text', () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Draw the line through <x0/> and <x1/>.') }, { id: 'b', source: source('No formulas in here.') }]);
  service.calls[0].onPartial([{ id: 'a', text: '画出经过 和 的直线', stage: 'draft', plain: true }, { id: 'b', text: '这里没有公式', stage: 'draft', plain: true }]);
  assert.equal(session.get('a').state, 'pending');
  assert.equal(session.get('b').state, 'draft');
});

test('PDF refinement failures keep the draft; real errors can be retried', () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Draft first sentence.') }, { id: 'b', source: source('Second sentence fails entirely.') }, { id: 'c', source: source('Third sentence is refined.') }]);
  const { onPartial } = service.calls[0];
  onPartial([{ id: 'a', text: '第一句草稿', stage: 'draft' }]);
  onPartial([{ id: 'a', error: { code: 'provider_error', message: '模型超时' } }, { id: 'b', error: { code: 'provider_error', message: '模型超时' } },
    { id: 'c', text: '第三句', stage: 'final', refined: false }]);
  assert.equal(session.get('a').state, 'final');
  assert.equal(session.get('a').refined, false);
  assert.equal(session.get('a').text, '第一句草稿');
  assert.equal(session.get('c').refined, false);
  assert.equal(session.get('b').state, 'error');
  assert.deepEqual(session.stats(), { total: 3, done: 2, draft: 0, pending: 0, failed: 1, unrefined: 2 });
  assert.equal(session.retry('a'), false);
  assert.equal(session.retry('b'), true);
  assert.equal(service.calls.length, 2);
  assert.equal(service.calls[1].req.priority, PRIORITY.VISIBLE);
  assert.deepEqual(service.calls[1].req.items, [{ id: 'b', text: 'Second sentence fails entirely.' }]);
  service.calls[1].onPartial([{ id: 'b', text: '第二句' }]);
  assert.equal(session.get('b').state, 'final');
});

test('PDF names and addresses that every model leaves unchanged keep the original quietly', () => {
  const { service, session } = setup();
  session.request([{ id: 'name', source: source('Kaiming He') }, { id: 'url', source: source('http://example.org/a') },
    { id: 'long', source: source('A genuine paragraph with many words that the model failed to translate at all today.') }]);
  const error = { code: 'provider_error', message: '模型漏翻，尝试备用模型' };
  service.calls[0].onPartial([{ id: 'name', error }, { id: 'url', error }, { id: 'long', error }]);
  assert.equal(session.get('name').state, 'final');
  assert.equal(session.get('name').same, true);
  assert.equal(session.get('url').state, 'skip');
  assert.equal(session.get('long').state, 'error');
});

test('PDF a finished request without an answer fails its blocks instead of spinning', async () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Lost sentence one.') }, { id: 'b', source: source('Answered sentence two.') }]);
  service.calls[0].onPartial([{ id: 'b', text: '第二句' }]);
  service.calls[0].finish();
  await tick();
  assert.equal(session.get('a').state, 'error');
  assert.equal(session.get('a').error.message, '没有收到完整译文');
  assert.equal(session.get('b').state, 'final');
});

test('PDF restore cancels requests and ignores late answers', async () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Sentence before restore.') }]);
  session.stop();
  assert.equal(service.calls[0].cancelled, true);
  service.calls[0].onPartial([{ id: 'a', text: '迟到' }]);
  await tick();
  assert.equal(session.get('a'), undefined);
  assert.equal(session.active, false);
  assert.equal(session.request([{ id: 'a', source: source('Sentence before restore.') }]), 0, 'inactive sessions send nothing');
});

test('PDF requests for pages the reader left are cancelled only while nothing has arrived', () => {
  const { service, session, updates } = setup();
  session.request([{ id: 'p2-b0', source: source('Page two sentence.') }]);
  session.request([{ id: 'p3-b0', source: source('Page three sentence.') }]);
  session.request([{ id: 'p9-b0', source: source('Page nine sentence.') }]);
  service.calls[1].onPartial([{ id: 'p3-b0', text: '第三页', stage: 'draft' }]);
  const released = session.release(id => id.startsWith('p9-'));
  assert.deepEqual(released, ['p2-b0']);
  assert.equal(service.calls[0].cancelled, true);
  assert.equal(service.calls[1].cancelled, false, 'a page with a visible draft keeps its request');
  assert.equal(session.get('p2-b0'), undefined);
  assert.ok(updates.includes('p2-b0'));
  assert.equal(session.request([{ id: 'p2-b0', source: source('Page two sentence.') }]), 1, 'released blocks are requested again later');
});

test('PDF model output is parsed as text and atoms only, with damaged atom markers repaired', () => {
  assert.deepEqual(renderResult('点 <x1/> 与 <x0/>', 2), { nodes: [{ t: 'text', v: '点 ' }, { t: 'x', n: 1 }, { t: 'text', v: ' 与 ' }, { t: 'x', n: 0 }], complete: true, plain: '点  与 ' });
  assert.deepEqual(renderResult('具有 3<x0/3 滤波器', 1).nodes, [{ t: 'text', v: '具有 3' }, { t: 'x', n: 0 }, { t: 'text', v: '3 滤波器' }]);
  assert.equal(repairAtoms('< x2 /> <X1> </x1>'), '<x2/> <x1/> ');
  const unsafe = renderResult('<img src=x onerror=alert(1)><b>粗</b><x0/>', 1);
  assert.deepEqual(unsafe.nodes, [{ t: 'text', v: '粗' }, { t: 'x', n: 0 }], 'tags are dropped, never interpreted');
  const missing = renderResult('只剩文字', 2);
  assert.equal(missing.complete, false);
  const broken = renderResult('坏 <x9/> 标记', 1);
  assert.deepEqual(broken.nodes, [{ t: 'text', v: '坏  标记' }]);
  assert.equal(broken.complete, false);
});

test('PDF identical output marks a block as unchanged so the original pixels stay', () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Andrew Shi') }]);
  service.calls[0].onPartial([{ id: 'a', text: 'Andrew  Shi' }]);
  assert.equal(session.get('a').same, true);
});

test('PDF released and retried ids reject answers from an older request attempt', () => {
  const { service, session } = setup();
  const list = [{ id: 'a', source: source('Keep this sentence.') }];
  session.request(list);
  session.release(() => false);
  session.request(list);
  service.calls[0].onPartial([{ id: 'a', text: '旧请求' }]);
  assert.equal(session.get('a').state, 'pending');
  service.calls[1].onPartial([{ id: 'a', error: { message: 'timeout' } }]);
  session.retry('a');
  service.calls[1].onPartial([{ id: 'a', text: '重试前的迟到回复' }]);
  assert.equal(session.get('a').state, 'pending');
  service.calls[2].onPartial([{ id: 'a', text: '新请求' }]);
  assert.equal(session.get('a').text, '新请求');
});

test('PDF missing/duplicated formula atoms never replace original content or a valid draft', () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('Fix <x0/> on the curve.') }, { id: 'b', source: source('Fix <x0/> on the line.') }]);
  const { onPartial } = service.calls[0];
  onPartial([{ id: 'a', text: '固定曲线上的点', stage: 'draft' }]);
  assert.equal(session.get('a').state, 'pending');
  onPartial([{ id: 'a', text: '固定曲线上的点' }, { id: 'b', text: '固定 <x0/>', stage: 'draft' }]);
  assert.equal(session.get('a').state, 'pending', 'missing atoms get one single-block repair');
  assert.equal(service.calls.length, 2);
  assert.deepEqual(service.calls[1].req.items, [{ id: 'a', text: 'Fix <x0/> on the curve.' }]);
  service.calls[1].onPartial([{ id: 'a', text: '仍然缺少公式' }]);
  assert.equal(session.get('a').state, 'error');
  assert.equal(service.calls.length, 2, 'the repair budget is bounded');
  assert.match(session.get('a').error.message, /缺少公式/);
  onPartial([{ id: 'b', text: '重复 <x0/> <x0/>' }]);
  assert.equal(session.get('b').state, 'final');
  assert.equal(session.get('b').refined, false);
  assert.equal(session.get('b').text, '固定 <x0/>');
});

test('PDF callback-only platform handles stay pending; successive unstaged results replace earlier text', async () => {
  const { service, session } = setup();
  let reply;
  service.translateBatch = (_req, cb) => { reply = cb; return { cancel() {} }; };
  session.request([{ id: 'a', source: source('One sentence here.') }]);
  await tick();
  assert.equal(session.get('a').state, 'pending');
  reply([{ id: 'a', text: '第一次' }]);
  reply([{ id: 'a', text: '第二次' }]);
  assert.equal(session.get('a').text, '第二次');
  reply([{ id: 'a', text: '迟到草稿', stage: 'draft' }]);
  assert.equal(session.get('a').text, '第二次');
  session.stop();
  reply([{ id: 'a', text: '恢复后的迟到回复' }]);
  assert.equal(session.get('a'), undefined);
});

test('PDF request completion settles drafts and rejected done promises without unhandled rejections', async () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('A draft sentence.') }]);
  service.calls[0].onPartial([{ id: 'a', text: '保留草稿', stage: 'draft' }]);
  service.calls[0].finish();
  await tick();
  assert.equal(session.get('a').state, 'final');
  assert.equal(session.get('a').refined, false);
  service.translateBatch = () => ({ cancel() {}, done: Promise.reject(new Error('transport failed')) });
  session.request([{ id: 'b', source: source('A failed sentence.') }]);
  await tick();
  assert.equal(session.get('b').state, 'error');
});

test('PDF short untranslated sentences and paragraphs containing URLs remain visible failures', () => {
  const { service, session } = setup();
  session.request([{ id: 'a', source: source('This is important.') }, { id: 'b', source: source('See https://example.org for details.') }]);
  service.calls[0].onPartial(['a', 'b'].map(id => ({ id, error: { message: 'untranslated' } })));
  assert.equal(session.get('a').state, 'error');
  assert.equal(session.get('b').state, 'error');
});

test('PDF URL footnotes and grouped author emails stay local; prose containing a link still translates', () => {
  for (const value of ['https://example.org/paper', '1 http://example.org/a 2 https://example.org/b', '1http://example.org/a',
    '{author.one, author-two, last}@example.org', 'one@example.org']) assert.equal(identifierOnly(value), true, value);
  for (const value of ['See https://example.org for details.', 'Email the author at one@example.org.',
    'Contact me@example.org', 'This paragraph needs translation.', 'Microsoft Research']) assert.equal(identifierOnly(value), false, value);
  const { session, service } = setup();
  session.request([{ id: 'mail', source: source('{first, second}@example.org') },
    { id: 'url', source: source('1 https://example.org/data') }, { id: 'prose', source: source('See https://example.org for details.') }]);
  assert.deepEqual(service.calls[0].req.items.map(item => item.id), ['prose']);
  assert.equal(session.get('mail').state, 'skip');
  assert.equal(session.get('url').state, 'skip');
});

test('PDF unique exact formula literals recover their crops without guessing missing or repeated formulas', () => {
  const recover = (text, atoms) => restoreLiteralAtoms(renderResult(text, atoms.length), atoms.map(text => ({ text })));
  assert.deepEqual(recover('使用 3×3 滤波器', ['×']).nodes, [{ t: 'text', v: '使用 3' }, { t: 'x', n: 0 }, { t: 'text', v: '3 滤波器' }]);
  assert.equal(recover('使用 3×3 滤波器', ['×']).complete, true);
  assert.equal(recover('两个 × 乘号 ×', ['×']).complete, false);
  assert.equal(recover('两个 × 乘号', ['×', '×']).complete, false);
  assert.equal(recover('漏掉了公式', ['×']).complete, false);
  assert.equal(recover('C 有一个点 1', ['C', '1']).complete, false, 'common names and numbers cannot be guessed');
  assert.equal(recover('函数 f(x)', ['f(x)']).complete, true);
});
