const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend}=require('./helpers/apps-script.cjs');
const log={action:'logInjection',requestId:'request-log-0001',peptide:'Example',dosage:'1 mg',site:'Other',timestampMs:1700000000000};
const presets=[['label','peptide','value','unit','site','frequency','ui','cycle','custom'],['AM','Example',1,'mg','Ask',1,'','5/2','=A2'],['PM','Other',2,'mg','Ask',2,'','','Keep me']];
function configured(initial={}){const b=backend(initial);b.setup();return b;}
test('each script copy pins its own Sheet; read/ping never acquire a lock',()=>{
  const a=backend({}, {dbId:'one'}),b=backend({}, {dbId:'two'});a.setup();b.setup();a.events.length=0;b.events.length=0;
  assert.equal(a.get('ping').apiVersion,2);assert.equal(a.get('getAllData').success,true);assert.equal(b.get('getAllData').success,true);
  assert.deepEqual(a.events,['open:one']);assert.deepEqual(b.events,['open:two']);
});
test('unconfigured deployment fails clearly; unknown or GET write actions cannot mutate',()=>{
  const b=backend();assert.equal(b.get('getAllData').code,'setup_required');
  assert.equal(b.get('logInjection').success,false);assert.equal(b.post({action:'setupPepLogs'}).success,false);assert.equal(b.sheets.size,0);
});
test('migration appends metadata without changing business/custom formulas and can be rerun',()=>{
  const b=configured({'QuickLogs Config':presets}),sheet=b.sheets.get('QuickLogs Config');
  const ids=b.get('getAllData').presets.map(p=>p.id);b.setup();
  assert.deepEqual(b.get('getAllData').presets.map(p=>p.id),ids);
  assert.equal(sheet.rows[1][8],'=A2');assert.equal(sheet.rows[2][8],'Keep me');assert.deepEqual(sheet.rows[0].slice(0,9),presets[0]);
});
test('migration refuses duplicate IDs rather than targeting an arbitrary copy',()=>{
  const b=configured({'QuickLogs Config':presets}),s=b.sheets.get('QuickLogs Config'),col=s.rows[0].indexOf('_pep_id');
  s.rows[2][col]=s.rows[1][col];assert.throws(()=>b.setup(),/dupliqué/);
});
test('a repeated creation after a lost response appends only once',()=>{
  const b=configured();const first=b.post(log),again=b.post(log);
  assert.equal(first.success,true);assert.equal(again.duplicate,true);assert.equal(first.id,again.id);
  assert.equal(b.get('getAllData').history.length,1);assert.equal(b.sheets.get('Logs Injections Peptides').getLastRow(),2);
});
test('all creation endpoints deduplicate and preserve API reader fields',()=>{
  const b=configured();
  const creates=[
    {action:'saveConfig',requestId:'request-preset-1',label:'AM',peptide:'Example',value:1,unit:'mg',frequency:1,cycle:'5/2'},
    {action:'savePeptide',requestId:'request-peptide-1',name:'Example',halfLife:1,hlUnit:'days'},
    {action:'saveBacWater',requestId:'request-bacwater-1',openedAt:'2026-10-01T00:00:00Z'},
    {action:'saveReconstitution',requestId:'request-recon-1',peptide:'Example',vialMg:10,bacWaterMl:2,date:'2026-10-01T00:00:00Z'}
  ];
  for(const data of creates){assert.equal(b.post(data).success,true);assert.equal(b.post(data).duplicate,true);}
  const all=b.get('getAllData');assert.equal(all.presets.length,1);assert.equal(all.peptides.length,1);assert.equal(all.reconstitutions.length,1);assert.equal(all.bacWater,'2026-10-01T00:00:00.000Z');
});
test('same request ID with different create content is rejected',()=>{
  const b=configured();b.post(log);assert.equal(b.post({...log,dosage:'2 mg'}).code,'request_conflict');assert.equal(b.get('getAllData').history[0].dosage,'1 mg');
});
test('ID locates a moved row; an unknown ID never falls back to the provided row',()=>{
  const b=configured({'QuickLogs Config':presets}),p=b.get('getAllData').presets[0],s=b.sheets.get('QuickLogs Config');
  [s.rows[1],s.rows[2]]=[s.rows[2],s.rows[1]];
  const data={action:'updateConfig',id:p.id,expectedVersion:p.version,row:2,verifyPeptide:'Example',label:'Changed',requestId:'request-update-01'};
  assert.equal(b.post(data).row,3);assert.equal(s.rows[1][0],'PM');assert.equal(s.rows[2][0],'Changed');assert.equal(s.rows[2][8],'=A2');
  assert.equal(b.post({...data,id:'unknown-identifier',requestId:'request-update-02'}).stale,true);
});
test('replayed update succeeds once, but an old retry cannot overwrite a newer edit',()=>{
  const b=configured({'QuickLogs Config':presets}),p=b.get('getAllData').presets[0];
  const data={action:'updateConfig',id:p.id,expectedVersion:1,label:'First',requestId:'request-update-01'};
  assert.equal(b.post(data).version,2);assert.equal(b.post(data).duplicate,true);
  assert.equal(b.post({...data,expectedVersion:2,label:'Second',requestId:'request-update-02'}).version,3);
  assert.equal(b.post(data).stale,true);assert.equal(b.get('getAllData').presets[0].label,'Second');
});
test('delete uses a tombstone: repeated delete and delayed create cannot resurrect the entry',()=>{
  const b=configured(),p=b.post(log),data={action:'deleteLog',id:p.id,expectedVersion:1,row:p.row,requestId:'request-delete-01'};
  assert.equal(b.post(data).success,true);assert.equal(b.post(data).duplicate,true);assert.equal(b.post(log).duplicate,true);
  assert.equal(b.get('getAllData').history.length,0);assert.equal(b.sheets.get('Logs Injections Peptides').getLastRow(),2);
});
test('closeReconstitution is versioned and safe to replay',()=>{
  const b=configured(),p=b.post({action:'saveReconstitution',requestId:'request-recon-1',peptide:'Example',vialMg:10,bacWaterMl:2,date:'2026-10-01T00:00:00Z'});
  const data={action:'closeReconstitution',id:p.id,expectedVersion:1,row:2,requestId:'request-close-1',closedAt:'2026-10-07T00:00:00Z'};
  assert.equal(b.post(data).version,2);assert.equal(b.post(data).duplicate,true);assert.equal(b.get('getAllData').reconstitutions[0].closedAt,'2026-10-07T00:00:00.000Z');
});
test('legacy row requests still work and their existing stale guards are preserved',()=>{
  const b=configured({'QuickLogs Config':presets});
  assert.equal(b.post({action:'updateConfig',row:2,verifyPeptide:'Wrong',label:'Fail'}).stale,true);
  assert.equal(b.post({action:'updateConfig',row:2,verifyPeptide:'Example',label:'Legacy'}).success,true);
  assert.equal(b.post({action:'deleteConfig',row:3,verifyLabel:'PM',verifyPeptide:'Other'}).success,true);
  assert.equal(b.get('getAllData').presets.length,1);
});
test('lock timeout writes nothing; successful and failed mutations release after flushing',()=>{
  const blocked=backend({}, {lockAvailable:false});assert.equal(blocked.post(log).code,'busy');assert.equal(blocked.sheets.size,0);
  const b=configured();b.events.length=0;b.post(log);assert.deepEqual(b.events.slice(-2),['flush','release']);
  b.events.length=0;b.post({...log,requestId:'request-invalid-1',peptide:''});assert.deepEqual(b.events.slice(-2),['flush','release']);
});
test('failed acknowledgement after a committed row is recoverable with the same request ID',()=>{
  const b=configured(),s=b.sheets.get('Logs Injections Peptides');
  s.afterWrite=({row})=>{if(row===2){s.afterWrite=null;throw Error('simulated failure after write');}};
  assert.equal(b.post(log).code,'server_error');assert.equal(b.post(log).duplicate,true);assert.equal(b.get('getAllData').history.length,1);
});
test('formula injection is neutralized in user text and invalid numbers/dates are rejected',()=>{
  const b=configured();assert.equal(b.post({...log,peptide:'=IMPORTXML("bad")',notes:'@formula'}).success,true);
  const s=b.sheets.get('Logs Injections Peptides');assert.ok(s.rows[1][1].startsWith("'="));assert.ok(s.rows[1][4].startsWith("'@"));
  for(const data of [{action:'saveReconstitution',peptide:'Example',vialMg:-1,bacWaterMl:2},{...log,timestampMs:'bad'},{action:'saveConfig',label:'X',peptide:'Y',value:1,unit:'mg',cycle:'-1/2'}])assert.equal(b.post(data).success,false);
});
test('updating or deleting an entry keeps previously escaped text inert',()=>{
  const b=configured();const p=b.post({action:'saveConfig',requestId:'request-escaped-1',label:'AM',peptide:'=IMPORTXML("bad")',value:1,unit:'mg',frequency:1});
  assert.equal(b.post({action:'updateConfig',id:p.id,expectedVersion:1,requestId:'request-escaped-2',label:'Changed'}).success,true);
  const s=b.sheets.get('QuickLogs Config');assert.ok(s.rows[1][1].startsWith("'="));
  assert.equal(b.post({action:'deleteConfig',id:p.id,expectedVersion:2,requestId:'request-escaped-3'}).success,true);assert.ok(s.rows[1][1].startsWith("'="));
});
