const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let APP_URL'));
function app(initial={}){
  const saved=new Map(Object.entries({'pep_url':'https://example.test/db',...initial}));
  const el=()=>({classList:{add(){},remove(){},contains(){return false},toggle(){}},addEventListener(){},value:'',style:{}});
  const c=vm.createContext({console,Date,Math,JSON,Promise,Set,Map,Number,String,Array,globalThis:null,
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},navigator:{},
    setTimeout(){},setInterval(){},confirm:()=>true,PepPlanning:require('../planning.js'),fetch:async()=>{throw Error('offline');}});
  c.globalThis=c;
  vm.runInContext(script,c);
  vm.runInContext("renderUI=()=>{}; showToast=(...args)=>messages.push(args); scheduleReminders=()=>{}; checkDueReminderOnOpen=()=>{}; closeModal=()=>{};",c);
  c.messages=[];
  return {c,saved,run:s=>vm.runInContext(s,c)};
}
const response=obj=>({json:async()=>obj});
const log=n=>({action:'logInjection',peptide:'Example',dosage:'1 mg',site:'Other',timestampMs:1700000000000+n});
test('quick log network failure inserts exactly one local entry and one queued write',async()=>{
  const a=app(); await a.c.finalizeQuickLog('Other',{peptide:'Example',value:1,unit:'mg'});
  assert.equal(a.run('history.length'),1);assert.equal(a.c.getOfflineQueue().length,1);
});
test('server rejection does not display or announce a successful quick log',async()=>{
  const a=app();a.c.fetch=async()=>response({success:false});
  await a.c.finalizeQuickLog('Other',{peptide:'Example',value:1,unit:'mg'});
  assert.equal(a.run('history.length'),0);assert.equal(a.c.getOfflineQueue().length,0);
  assert.ok(a.c.messages.every(m=>!m[0].startsWith('Logged')));
});
test('failed drain preserves the failed operation and every unsent tail item',async()=>{
  const a=app();[1,2,3].forEach(n=>a.c.addToOfflineQueue(log(n)));let calls=0;
  a.c.fetch=async()=>{if(++calls===2)throw Error('offline');return response({success:true});};
  await a.c.flushOfflineQueue();
  assert.equal(calls,2);assert.deepEqual(Array.from(a.c.getOfflineQueue(),x=>x.data.timestampMs),[1700000000002,1700000000003]);
});
test('concurrent drains share one request, and additions during drain survive',async()=>{
  const a=app();a.c.addToOfflineQueue(log(1));let resolve,calls=0;
  a.c.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
  const one=a.c.flushOfflineQueue(),two=a.c.flushOfflineQueue();
  a.c.addToOfflineQueue(log(2));resolve(response({success:true}));await Promise.all([one,two]);
  assert.equal(calls,1);assert.equal(a.c.getOfflineQueue().length,1);
  assert.equal(a.c.getOfflineQueue()[0].data.timestampMs,1700000000002);
});
test('server conflicts preserve ordered queue and announce blocked sync',async()=>{
  const a=app();[1,2].forEach(n=>a.c.addToOfflineQueue(log(n)));let calls=0;
  a.c.fetch=async()=>{calls++;return response({success:false,stale:true});};await a.c.flushOfflineQueue();
  assert.equal(calls,1);assert.equal(a.c.getOfflineQueue().length,2);assert.match(a.c.messages[0][0],/Sync blocked/);
});
test('legacy queue entries retain their unsent tail and migrate to the active database',async()=>{
  const a=app({'pep_offline_queue':JSON.stringify([{ts:1,data:log(1)},{ts:2,data:log(2)}])});
  await a.c.flushOfflineQueue();assert.equal(a.c.getOfflineQueue().length,2);assert.equal(a.saved.has('pep_offline_queue'),false);
  assert.equal(app(Object.fromEntries([...a.saved,['pep_url','https://example.test/other']])).c.getOfflineQueue().length,0);
});
test('offline reconstitution and preset changes remain visible after a successful GET',async()=>{
  const a=app();a.run("presets=[{row:2,peptide:'Example',value:1,label:'Old'}]");
  await a.c.api({action:'updateConfig',row:2,verifyPeptide:'Example',value:2,label:'New'});
  await a.c.api({action:'saveReconstitution',peptide:'Example',vialMg:10,bacWaterMl:2,date:'2026-10-01T00:00:00Z'});
  a.c.fetch=async(url,opts)=>{if(opts)throw Error('offline');return response({success:true,presets:[{row:2,peptide:'Example',value:1,label:'Old'}],history:[],reconstitutions:[]});};
  await a.c.loadAllData();assert.equal(a.run('presets[0].value'),2);assert.equal(a.run('reconstitutions.length'),1);
  await a.c.loadAllData();assert.equal(a.run('reconstitutions.length'),1);
});
test('closing an existing reconstitution queues and projects offline',async()=>{
  const a=app();a.run("reconstitutions=[{row:2,peptide:'Example',date:'2026-10-01T00:00:00Z',closedAt:''}]");
  const r=await a.c.api({action:'closeReconstitution',row:2,verifyPeptide:'Example',verifyDate:'2026-10-01T00:00:00Z',closedAt:'2026-10-07T12:00:00Z'});
  assert.equal(r.offline,true);assert.equal(a.run('reconstitutions[0].closedAt'),'2026-10-07T12:00:00Z');
});
test('pending new rows cannot be sent as negative sheet row numbers',async()=>{
  const a=app();let calls=0;a.c.fetch=async()=>{calls++;return response({success:true});};
  const r=await a.c.api({action:'closeReconstitution',row:-123});assert.equal(r.success,false);assert.equal(calls,0);
});
test('storage failure never claims that an offline entry was saved',async()=>{
  const a=app();a.c.localStorage.setItem=()=>{throw Error('quota');};const r=await a.c.api(log(1));
  assert.equal(r.success,false);assert.equal(a.run('history.length'),0);assert.equal(a.c.getOfflineQueue().length,0);
});
test('writes behind a pending queue cannot overtake it',async()=>{
  const a=app();a.c.addToOfflineQueue(log(1));let calls=0;a.c.fetch=async()=>{calls++;return response({success:true});};
  const r=await a.c.api(log(2));assert.equal(r.offline,true);assert.equal(calls,0);assert.equal(a.c.getOfflineQueue().length,2);
});
test('calendar datetime-local keeps the chosen local date',()=>{
  const a=app();assert.equal(a.c.localDateTime(new Date(2026,9,7)), '2026-10-07T00:00');
});
test('a reload can reconstruct pending entries from the queue without a cache',async()=>{
  const first=app();await first.c.api(log(1));
  const saved=Object.fromEntries([...first.saved].filter(([k])=>!k.startsWith('pep_offline_cache')));
  const second=app(saved);await second.c.loadAllData();
  assert.equal(second.run('history.length'),1);await second.c.loadAllData();assert.equal(second.run('history.length'),1);
});
test('a stale GET cannot overwrite a write made while the read was in flight',async()=>{
  const a=app();let resolveRead,reads=0;
  a.c.fetch=async(url,opts)=>{
    if(opts)return response({success:true});
    if(++reads===1)return new Promise(r=>resolveRead=r);
    return response({success:true,history:[{row:2,peptide:'Example',date:'2026-10-07T12:00:00Z',site:'Other'}]});
  };
  const loading=a.c.loadAllData();
  while(!resolveRead)await Promise.resolve();
  await a.c.api(log(1));resolveRead(response({success:true,history:[]}));await loading;
  assert.equal(reads,2);assert.equal(a.run('history.length'),1);
});
