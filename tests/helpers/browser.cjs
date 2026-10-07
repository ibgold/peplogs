const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../../index.html'),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let APP_URL'));
function app(initial={}){
  const saved=new Map(Object.entries({'pep_url':'https://example.test/db',...initial}));
  const el=()=>({classList:{add(){},remove(){},contains(){return false},toggle(){}},addEventListener(){},value:'',style:{}});
  const c=vm.createContext({console:{...console,error(){}},Date,Math,JSON,Promise,Set,Map,Number,String,Array,globalThis:null,
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},navigator:{},
    setTimeout(){},setInterval(){},confirm:()=>true,PepPlanning:require('../../planning.js'),fetch:async()=>{throw Error('offline');}});
  c.globalThis=c;
  vm.runInContext(script,c);
  vm.runInContext("renderUI=()=>{}; showToast=(...args)=>messages.push(args); scheduleReminders=()=>{}; checkDueReminderOnOpen=()=>{}; closeModal=()=>{};",c);
  c.messages=[];
  return {c,saved,run:s=>vm.runInContext(s,c)};
}

module.exports = { app };
