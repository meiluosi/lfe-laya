import { createInterface } from 'node:readline';
import { MicroWorld, SIM_VERSION } from './micro-world.ts';
const worlds=new Map<string,MicroWorld>();
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  try {
    const q=JSON.parse(line);let result:unknown;
    if(q.op==='ping') result={version:SIM_VERSION};
    else if(q.op==='reset') {const w=new MicroWorld(q.config);worlds.set(q.id,w);result=w.request();}
    else if(q.op==='close') {worlds.delete(q.id);result={closed:true};}
    else {
      const w=worlds.get(q.id);if(!w) throw new Error('unknown_world');
      if(q.op==='observe') result=w.request();
      else if(q.op==='inspect') result=w.inspect();
      else if(q.op==='step') result=w.step(q.proposal);
      else if(q.op==='retry') result=w.retry();
      else if(q.op==='cancel') {w.cancel();result={cancelled:true};}
      else if(q.op==='snapshot') result=w.snapshot();
      else if(q.op==='restore') {w.restore(q.snapshot);result={restored:true};}
      else throw new Error('unknown_operation');
    }
    process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  } catch(e) {process.stdout.write(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)})+'\n');}
}
