import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingSuggestions } from '../src/multi.js';
const file = rows => ({ headers: Object.keys(rows[0]), rows });
test('mapping suggestions combine multilingual column names and sample value types with high confidence', () => {
  const files=[file([{'Order ID':'A',Amount:'100',Date:'2026-11-10'}]),file([{'单号':'A','金额':'￥100元','日期':'2026年11月10日'}])];
  const {proposed,advice}=mappingSuggestions(files);
  assert.deepEqual(proposed.keys,[['Order ID'],['单号']]);assert.deepEqual(proposed.fields[0].columns,['Amount','金额']);
  assert.ok(advice.every(a=>a.confidence==='High'));
});
test('mapping fuzzy spelling plus numeric samples gives medium confidence', () => {
  const {advice,proposed}=mappingSuggestions([file([{'Order ID':'A',Amount:'100'}]),file([{'Order ID':'A',Amuont:'100'}])]);
  assert.equal(advice.find(a=>a.table===1&&a.target==='amount').confidence,'Medium');assert.equal(proposed.fields[0].columns[1],'Amuont');
});
test('weak or ambiguous mapping remains blank and never auto-applies a low-confidence candidate', () => {
  for(const row of [{'Order ID':'A',Mystery:'100'},{'Order ID':'A',Amt:'100',Total:'100'}]){
    const {advice,proposed}=mappingSuggestions([file([{'Order ID':'A',Amount:'100'}]),file([row])]);
    assert.equal(advice.find(a=>a.table===1&&a.target==='amount').confidence,'Low');assert.equal(proposed.fields[0].columns[1],'');
  }
});
test('sample types infer numeric fields in unknown reference columns without treating text as money', () => {
  const {proposed}=mappingSuggestions([file([{'Order ID':'A',Count:'12',Memo:'paid'}]),file([{'Order ID':'A',Count:'12',Memo:'paid'}])]);
  assert.equal(proposed.fields.find(f=>f.name==='Count').type,'number');assert.equal(proposed.fields.find(f=>f.name==='Memo').type,'text');
});
