'use strict';

const {HYDRATION_INTERVALS}=require('./settings');
function localDay(at) {
  const date=new Date(at);
  if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid reminder date');
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
const statements=new WeakMap();
// COUNT uses the existing timestamp index; pending rows are deduplicated against
// both the persisted event IDs and the pending batch, without loading a day's events.
function countTodayKeys(store,at=Date.now()) {
  if(!store||store.closed)throw new Error('Keyboard store unavailable');
  const date=new Date(at),start=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
  if(!Number.isFinite(start)||!Number.isSafeInteger(at))throw new TypeError('Invalid count date');
  let prepared=statements.get(store);
  if(!prepared){prepared={count:store.db.prepare('SELECT COUNT(*) AS n FROM key_events WHERE kind=0 AND ts_ms>=? AND ts_ms<=?'),has:store.db.prepare('SELECT 1 AS found FROM key_events WHERE event_id=?')};statements.set(store,prepared);}
  let count=Number(prepared.count.get(start,at).n);
  const seen=new Set();
  for(const event of store.pending||[]){
    if(event.kind!==0||event.ts_ms<start||event.ts_ms>at||seen.has(event.event_id))continue;
    seen.add(event.event_id);if(!prepared.has.get(event.event_id))count++;
  }
  return count;
}
function validProgress(value) {
  if(!value||typeof value!=='object'||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.handledCount)||value.handledCount<0)return null;
  return {day:value.day,handledCount:value.handledCount,needsBaseline:value.needsBaseline===true,interval:HYDRATION_INTERVALS.includes(value.interval)?value.interval:8192};
}
class HydrationReminder {
  constructor({enabled=false,interval=8192,readCount,readProgress=()=>null,saveProgress=()=>{},notify,supported=()=>true,now=Date.now,onChange=()=>{}}) {
    if(typeof readCount!=='function'||typeof notify!=='function')throw new TypeError('Reminder services required');
    this.enabled=enabled===true;this.interval=HYDRATION_INTERVALS.includes(interval)?interval:8192;
    this.readCount=readCount;this.saveProgress=saveProgress;this.notify=notify;this.supported=supported;this.now=now;this.onChange=onChange;
    try{this.progress=validProgress(readProgress());}catch{this.progress=null;}
    this.needsBaseline=this.progress?.needsBaseline===true || !!(this.progress&&this.progress.interval!==this.interval);
    this.count=0;this.error=null;this.closed=false;this.revision=0;this.evaluating=null;
  }
  status() {
    let supported=false;try{supported=this.supported()===true;}catch{}
    const handled=this.progress?.day===localDay(this.now())?this.progress.handledCount:0;
    return {supported,enabled:this.enabled,interval:this.interval,error:this.error,count:this.count,day:localDay(this.now()),nextAt:(Math.floor(Math.max(this.count,handled)/this.interval)+1)*this.interval};
  }
  persist(progress) {
    const next={...progress,needsBaseline:this.needsBaseline,interval:this.interval};
    this.saveProgress(next);this.progress=next;
  }
  async configure(enabled,interval) {
    if(typeof enabled!=='boolean'||!HYDRATION_INTERVALS.includes(interval))throw new TypeError('Invalid hydration settings');
    if(this.enabled===enabled&&this.interval===interval)return this.status();
    this.enabled=enabled;this.interval=interval;this.revision++;this.needsBaseline=true;this.error=null;
    this.persist(this.progress||{day:localDay(this.now()),handledCount:0});
    // Wait for an older evaluation to finish before baselining the new interval.
    if(this.evaluating)await this.evaluating;
    if(enabled)await this.evaluate();
    this.onChange(this.status());return this.status();
  }
  evaluate() {
    if(this.closed||!this.enabled)return Promise.resolve(this.status());
    if(this.evaluating)return this.evaluating;
    this.evaluating=this.run().finally(()=>{this.evaluating=null;});return this.evaluating;
  }
  async run() {
    const revision=this.revision;
    try {
      const at=this.now(),day=localDay(at),count=await this.readCount(at);
      if(!Number.isSafeInteger(count)||count<0)throw new Error('Invalid daily keyboard count');
      if(this.closed||!this.enabled||revision!==this.revision||day!==localDay(this.now()))return this.status();
      const countChanged=this.count!==count;this.count=count;
      const previous=this.progress?.day===day?this.progress:{day,handledCount:0};
      if(this.needsBaseline){this.needsBaseline=false;try{this.persist({day,handledCount:Math.max(previous.handledCount,count)});}catch(error){this.needsBaseline=true;throw error;}this.onChange(this.status());return this.status();}
      if(Math.floor(count/this.interval)<=Math.floor(previous.handledCount/this.interval)) {
        if(this.progress?.day!==day)this.persist(previous);
        if(countChanged)this.onChange(this.status());
        return this.status();
      }
      const reserved={day,handledCount:count};
      this.persist(reserved); // Reserve before the async OS handoff to prevent replay after restart.
      if(!this.status().supported){this.error='Windows notifications are unavailable';this.onChange(this.status());return this.status();}
      try {
        await this.notify({kind:'milestone',count,interval:this.interval,milestone:Math.floor(count/this.interval)*this.interval,day});
        if(revision===this.revision)this.error=null;
      } catch(error) {
        if(revision===this.revision&&!this.closed){this.persist(previous);this.error='Unable to send the Windows notification';}
      }
      this.onChange(this.status());return this.status();
    } catch(error) {
      if(!this.closed){this.error='Unable to read or save reminder progress';this.onChange(this.status());}
      return this.status();
    }
  }
  async test() {
    if(!this.enabled)throw new Error('Enable water reminders before sending a test');
    if(this.closed||!this.status().supported)throw new Error('Windows notifications are unavailable');
    try{await this.notify({kind:'test',count:this.count,interval:this.interval,day:localDay(this.now())});this.error=null;this.onChange(this.status());return this.status();}
    catch(error){this.error='Unable to send the Windows notification';this.onChange(this.status());throw new Error(this.error);}
  }
  stop(){this.closed=true;this.revision++;}
}
module.exports={HydrationReminder,countTodayKeys,localDay,validProgress};
