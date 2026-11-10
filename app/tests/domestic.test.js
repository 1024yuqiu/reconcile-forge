import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { amountInCents, dateInDays, normalize, DEFAULT_RULES } from '../src/reconcile.js';
import { configuredDate, reconcileTables, suggestFields } from '../src/multi.js';
import { readBytes } from '../src/files.js';
test('domestic amounts accept valid thousands, both yen symbols and yuan suffix without relaxing precision', () => {
  for (const value of ['1,234.50', '¥1,234.50', '￥1,234.50', '1234.50元', '￥１，２３４．５０元']) assert.equal(amountInCents(value),123450);
  assert.equal(amountInCents('(￥50元)'),-5000);
  for (const value of ['1,23.50元','1元2','1.001元','元','元100','1元元']) assert.equal(amountInCents(value),null);
});
test('Chinese, slash and full-width dates remain strict calendar dates in configured rules', () => {
  const expected=dateInDays('2026-11-10');
  for (const value of ['2026年11月10日','2026/11/10','２０２６年１１月１０日']) {
    assert.equal(dateInDays(value),expected);assert.equal(configuredDate(value,'YYYY-MM-DD,YYYY/MM/DD,YYYY年MM月DD日'),expected);
  }
  assert.equal(configuredDate('2026年2月29日','YYYY年MM月DD日'),null);
  assert.equal(normalize('　００１　',{...DEFAULT_RULES,leadingZeros:true}),'1');
});
for (const encoding of ['utf-8','gbk','gb18030']) test(`domestic ${encoding} CSV auto-decodes and reconciles dirty amounts/dates with clean export`,async()=>{
  const name=`domestic-${encoding}.csv`,dirty=await readBytes(await readFile(`samples/domestic/${name}`),name),clean=await readBytes(await readFile('samples/domestic/domestic-clean.csv'),'clean.csv');
  assert.equal(dirty.encoding,encoding==='utf-8'?'UTF-8':'GBK/GB18030');
  if(encoding==='gb18030') assert.match(dirty.rows[0]['客户'],/𠀀/);
  const files=[clean,dirty],config={...suggestFields(files),baseIndex:0,keyRules:{...DEFAULT_RULES,leadingZeros:true},aggregate:[false,false],acceptedPairs:[]};
  assert.deepEqual(reconcileTables(files,config).summary,{matched:3,mismatch:0,'only-a':0,'only-b':0,duplicate:0});
});
