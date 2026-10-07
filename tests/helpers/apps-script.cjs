const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const clone=value=>value instanceof Date?new Date(value):value;
class Sheet {
  constructor(rows=[]){this.rows=rows.map(r=>r.map(clone));this.maxColumns=Math.max(26,...rows.map(r=>r.length));this.maxRows=1000;this.afterWrite=null;}
  getLastRow(){let n=this.rows.length;while(n&&!this.rows[n-1].some(x=>x!==''&&x!==undefined))n--;return n;}
  getLastColumn(){return Math.max(0,...this.rows.map(r=>{let n=r.length;while(n&&(r[n-1]===''||r[n-1]===undefined))n--;return n;}));}
  getMaxColumns(){return this.maxColumns;}
  getMaxRows(){return this.maxRows;}
  insertColumnsAfter(_,n){this.maxColumns+=n;}
  insertRowsAfter(_,n){this.maxRows+=n;}
  getRange(row,col,n=1,m=1){
    if(row<1||col<1||n<1||m<1||row+n-1>this.maxRows||col+m-1>this.maxColumns)throw Error('range bounds');
    const raw=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row+i-1]?.[col+j-1]??''));
    return {
      getValues:()=>raw().map(r=>r.map(x=>typeof x==='string'&&x.startsWith("'")?x.slice(1):typeof x==='string'&&x.startsWith('=')?42:clone(x))),
      getFormulas:()=>raw().map(r=>r.map(x=>typeof x==='string'&&x.startsWith('=')?x:'')),
      setValues:values=>{
        if(values.length!==n||values.some(r=>r.length!==m))throw Error('dimension mismatch');
        values.forEach((r,i)=>{if(!this.rows[row+i-1])this.rows[row+i-1]=[];r.forEach((v,j)=>this.rows[row+i-1][col+j-1]=clone(v));});
        if(this.afterWrite)this.afterWrite({row,col,n,m});
      }
    };
  }
}
function backend(initial={},options={}){
  const sheets=new Map(Object.entries(initial).map(([k,v])=>[k,new Sheet(v)]));
  const props=new Map();const events=[];
  const ss={getId:()=>options.dbId||'synthetic-sheet',getName:()=> 'Synthetic Sheet',getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const s=new Sheet();sheets.set(n,s);return s;}};
  const c=vm.createContext({console,Date,Number,String,Array,Object,JSON,Error,isFinite,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:id=>{events.push('open:'+id);if(id!==ss.getId())throw Error('wrong database');return ss;},flush:()=>events.push('flush')},
    LockService:{getScriptLock:()=>({tryLock:()=>{events.push('lock');return options.lockAvailable!==false;},releaseLock:()=>events.push('release')})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algo,s)=>Array.from(crypto.createHash(algo).update(s).digest())},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>({text})})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../apps-script/Code.gs'),'utf8'),c);
  return {c,ss,sheets,props,events,setup:()=>c.setupPepLogs(),post:data=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(data)}}).text),get:action=>JSON.parse(c.doGet({parameter:{action}}).text)};
}
module.exports={backend,Sheet};
