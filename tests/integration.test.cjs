const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers/browser.cjs');
const {backend}=require('./helpers/apps-script.cjs');
const response=obj=>({json:async()=>obj});
const log={action:'logInjection',peptide:'Example',dosage:'1 mg',site:'Other',timestampMs:1700000000000};
function pair(initial={}){
  const server=backend(initial);server.setup();const client=app();
  const transport=async(url,opts)=>response(opts?server.post(JSON.parse(opts.body)):server.get('getAllData'));
  client.c.fetch=transport;
  return {server,client,transport};
}
test('lost network response retries the exact same request ID and converges to one record',async()=>{
  const {server,client,transport}=pair();let firstId;
  client.c.fetch=async(url,opts)=>{const data=JSON.parse(opts.body);firstId=data.requestId;assert.equal(server.post(data).success,true);throw Error('response lost');};
  const result=await client.c.api(log);assert.equal(result.offline,true);assert.equal(client.c.getOfflineQueue()[0].data.requestId,firstId);assert.equal(client.run('history.length'),1);
  client.c.fetch=transport;await client.c.loadAllData();
  assert.equal(client.c.getOfflineQueue().length,0);assert.equal(client.run('history.length'),1);assert.equal(server.get('getAllData').history.length,1);assert.equal(client.run('history[0].id'),firstId);
});
test('a committed row plus server error retains its request ID for safe recovery',async()=>{
  const {server,client}=pair();const sheet=server.sheets.get('Logs Injections Peptides');
  sheet.afterWrite=({row})=>{if(row===2){sheet.afterWrite=null;throw Error('error after commit');}};
  const result=await client.c.api(log);assert.equal(result.offline,true);await client.c.loadAllData();
  assert.equal(client.c.getOfflineQueue().length,0);assert.equal(client.run('history.length'),1);assert.equal(server.get('getAllData').history.length,1);
});
test('pending creation is not displayed twice if GET sees the committed row before drain succeeds',async()=>{
  const {server,client,transport}=pair();
  client.c.fetch=async(url,opts)=>{server.post(JSON.parse(opts.body));throw Error('response lost');};await client.c.api(log);
  client.c.fetch=async(url,opts)=>{if(opts)throw Error('POST unavailable');return transport(url,opts);};await client.c.loadAllData();
  assert.equal(client.c.getOfflineQueue().length,1);assert.equal(client.run('history.length'),1);
});
test('two offline edits of the same preset advance expected versions and sync in order',async()=>{
  const {server,client,transport}=pair({'QuickLogs Config':[['label','peptide','value','unit','site','frequency','ui','cycle'],['AM','Example',1,'mg','Ask',1,'','']]});
  await client.c.loadAllData();client.c.fetch=async()=>{throw Error('offline');};
  for(const label of ['First','Second']){
    const target=client.run('presets[0]');
    const result=await client.c.api({action:'updateConfig',row:target.row,...client.c.mutationTarget(target),verifyPeptide:'Example',label});assert.equal(result.offline,true);
  }
  assert.deepEqual(Array.from(client.c.getOfflineQueue(),x=>x.data.expectedVersion),[1,2]);assert.equal(client.run('presets[0].version'),3);
  client.c.fetch=transport;await client.c.loadAllData();assert.equal(client.c.getOfflineQueue().length,0);assert.equal(server.get('getAllData').presets[0].label,'Second');assert.equal(client.run('presets[0].version'),3);
});
test('a pending stale edit cannot visually overwrite a newer version from another device',async()=>{
  const {server,client,transport}=pair({'QuickLogs Config':[['label','peptide','value','unit','site','frequency','ui','cycle'],['AM','Example',1,'mg','Ask',1,'','']]});
  await client.c.loadAllData();const target=client.run('presets[0]');client.c.fetch=async()=>{throw Error('offline');};
  await client.c.api({action:'updateConfig',row:2,...client.c.mutationTarget(target),verifyPeptide:'Example',label:'Offline'});
  server.post({action:'updateConfig',id:target.id,expectedVersion:1,label:'Elsewhere',requestId:'another-device-01'});
  client.c.fetch=transport;await client.c.loadAllData();assert.equal(client.c.getOfflineQueue().length,1);assert.equal(client.run('presets[0].label'),'Elsewhere');
});
test('an edit modal retains its original target when a background refresh changes row order',()=>{
  const {client}=pair();client.run("presets=[{row:2,id:'original-target',version:1,label:'A',peptide:'Example'}]");
  client.c.openEditPreset(client.run('presets[0]'));
  client.run("presets=[{row:2,id:'different-target',version:1,label:'B',peptide:'Example'}]");
  assert.equal(client.run('editingPresetTarget.id'),'original-target');
});
test('the upgraded frontend remains compatible with the old row-only response format',async()=>{
  const client=app();let sent;
  client.c.fetch=async(url,opts)=>{sent=JSON.parse(opts.body);return response({success:true});};
  const result=await client.c.api({...log});assert.equal(result.success,true);assert.ok(sent.requestId);assert.equal(client.c.getOfflineQueue().length,0);
});
