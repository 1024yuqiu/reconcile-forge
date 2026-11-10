import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
let link,requests=[];
const bytes=Buffer.from('Order ID,Amount\n1,100\n');
const api={asUser:()=>({requestConfluence:async path=>{
 requests.push(path);
 if(path==='/wiki/api/v2/pages/42')return{ok:true,json:async()=>({id:'42',spaceId:'9'})};
 if(path==='/wiki/api/v2/pages/42/attachments?limit=100')return{ok:true,json:async()=>({results:[{id:'att7',title:'ledger.csv',fileSize:bytes.length,downloadLink:link}]})};
 return{ok:true,arrayBuffer:async()=>bytes};
}})};
mock.module(require.resolve('@forge/api'),{defaultExport:api,namedExports:{route:(parts,...values)=>parts.reduce((s,p,i)=>s+p+(values[i]??''),''),assumeTrustedRoute:path=>path}});
mock.module(require.resolve('@forge/kvs'),{namedExports:{kvs:{}}});
mock.module(require.resolve('@forge/resolver'),{namedExports:{makeResolver:definitions=>definitions}});
const {handler}=await import('../src/index.js');
const context={accountId:'synthetic',extension:{content:{id:'42'}}};
test('Confluence attachment adapter accepts current REST links and both legacy wiki forms',async()=>{
 for(const value of ['/rest/api/content/42/child/attachment/att7/download','/wiki/rest/api/content/42/child/attachment/att7/download','/download/attachments/42/ledger.csv?version=1','/wiki/download/attachments/42/ledger.csv?version=1']){
  link=value;requests=[];const result=await handler.loadSource({context,payload:{id:'att7'}});
  assert.equal(result.bytes64,bytes.toString('base64'));assert.equal(requests.at(-1),value.startsWith('/wiki/')?value:`/wiki${value}`);
 }
});
test('Confluence REST download route stays bound to the authorized page and attachment',async()=>{
 for(const value of ['/rest/api/content/99/child/attachment/att7/download','/rest/api/content/42/child/attachment/att8/download','/rest/api/content/42/child/attachment/att7/delete']){
  link=value;requests=[];await assert.rejects(handler.loadSource({context,payload:{id:'att7'}}),/Unsupported Confluence attachment download path/);assert.equal(requests.length,2);
 }
});
