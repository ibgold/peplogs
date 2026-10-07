const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../planning.js');
const date = s => new Date(s + 'T12:00:00');
const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const preset = { peptide:'Example', cycle:'5/2', frequency:6 };
const history = [{peptide:' example ',date:date('2026-10-05')}];
test('5/2 has five active days, two rest days, then starts again', () => {
  const states = Array.from({length:8},(_,i)=>P.cycleStatus(preset,history,date(`2026-10-${String(5+i).padStart(2,'0')}`)).status);
  assert.deepEqual(states,['done','active','active','active','active','rest','rest','active']);
  assert.equal(P.cycleStatus(preset,history,date('2026-10-11')).restDay,2);
});
test('another injection and a missed day do not reset the cycle',()=>{
  const logs=[...history,{peptide:'Example',date:date('2026-10-08')}];
  assert.equal(P.cycleStatus(preset,logs,date('2026-10-09')).status,'active');
  assert.equal(P.cycleStatus(preset,logs,date('2026-10-10')).status,'rest');
});
test('all schedule consumers agree and cycle overrides frequency',()=>{
  const now=date('2026-10-06'),to=date('2026-10-13');
  const occurrences=P.occurrences(preset,history,{now,from:now,to});
  assert.deepEqual(occurrences.map(x=>key(x.date)),['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13']);
  assert.equal(key(P.next(preset,history,now).date),key(occurrences[0].date));
  for(const item of occurrences) assert.equal(P.cycleStatus(preset,history,item.date).status,'active');
});
test('rest days do not create overdue catch-up reminders',()=>{
  const now=date('2026-10-10');
  assert.deepEqual(P.occurrences(preset,history,{now,from:now,to:now,includeOverdue:true}),[]);
  assert.equal(key(P.next(preset,history,now).date),'2026-10-12');
});
test('completed days excluded; frequency handles overdue and long gaps',()=>{
  const p={peptide:'Example',frequency:2},now=date('2026-10-10');
  assert.equal(key(P.next(p,history,now).date),'2026-10-07');
  assert.deepEqual(P.occurrences(p,history,{now,from:now,to:date('2026-10-14'),includeOverdue:true}).map(x=>key(x.date)),['2026-10-07','2026-10-11','2026-10-13']);
});
test('invalid/future logs do not poison scheduling and missing history has no invented start',()=>{
  assert.equal(P.next(preset,[],date('2026-10-06')),null);
  const logs=[...history,{peptide:'Example',date:'bad'},{peptide:'Example',date:date('2027-01-01')}];
  assert.equal(key(P.next(preset,logs,date('2026-10-06')).date),'2026-10-06');
});
test('reject malformed cycles and fractional/negative frequency without fallback',()=>{
  for(const cycle of ['-1/2','1.5/2','0/2','5/2/1','bad']){
    assert.equal(P.parseCycle(cycle),null);
    assert.equal(P.next({...preset,cycle},history,date('2026-10-06')),null);
  }
  assert.deepEqual(P.parseCycle(' 5 / 0 '),{active:5,rest:0});
  for(const frequency of [-1,0,0.5]) assert.equal(P.next({peptide:'Example',frequency},history,date('2026-10-06')),null);
});
test('calendar covers a complete month, not only ten predictions',()=>{
  const now=date('2026-10-01'),logs=[{peptide:'Example',date:date('2026-09-30')}];
  assert.equal(P.occurrences({peptide:'Example',frequency:1},logs,{now,from:now,to:date('2026-10-31')}).length,31);
});
test('local calendar days stay aligned across daylight saving changes',()=>{
  const now=date('2026-10-24'),logs=[{peptide:'Example',date:date('2026-10-23')}];
  assert.deepEqual(P.occurrences({peptide:'Example',frequency:1},logs,{now,from:now,to:date('2026-10-27')}).map(x=>key(x.date)),['2026-10-24','2026-10-25','2026-10-26','2026-10-27']);
});
