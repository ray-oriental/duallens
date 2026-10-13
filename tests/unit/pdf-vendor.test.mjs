import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../../extension/vendor/pdfjs/',import.meta.url);
test('PDF vendor inventory and installed bytes match their recorded SHA-256',()=>{
  const doc=readFileSync(new URL('VENDOR.md',root),'utf8');
  assert.equal(doc,readFileSync(new URL('VENDOR.txt',root),'utf8'));
  const patched=doc.match(/Installed pdf.min.js SHA-256: ([0-9a-f]{64})/)[1];
  const entries=[...doc.matchAll(/^([0-9a-f]{64})  (\S+) \(/gm)];
  assert.equal(entries.length,13);
  for(const [,hash,path] of entries){
    const actual=createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex');
    assert.equal(actual,path==='pdf.min.js'?patched:hash,path);
  }
  const core=readFileSync(new URL('pdf.min.js',root),'utf8');
  assert.ok(core.includes('DualLens requires a bundled same-origin PDF worker'));
  assert.ok(!core.includes('await import("${t}")'));
  assert.ok(readFileSync(new URL('LICENSE.txt',root),'utf8').includes('Apache License'));
});
