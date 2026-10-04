import { PROTOCOL_VERSION, DIRECTIONS, validateProposal } from '../protocol/decision.ts';
import type { Action, Candidate, Request, Proposal } from '../protocol/decision.ts';
export const SIM_VERSION = 'm0-foraging-v1';
export type Config = {
  seed: number; runId: string; size: number; horizon: number; phaseSteps: number;
  perception: number; capacity: number; initialEnergy: number; metabolism: number;
  moveCost: number; bite: number; memorySize: number; memoryTtl: number;
  initialFood: number; supplyEvery: number; supplyAmount: number;
};
export const DEFAULT_CONFIG: Config = {
  seed:1, runId:'m0', size:7, horizon:360, phaseSteps:120, perception:2,
  capacity:40, initialEnergy:24, metabolism:0.12, moveCost:0.18,
  bite:5, memorySize:8, memoryTtl:60, initialFood:120, supplyEvery:4, supplyAmount:5,
};
type Memory = {x:number;y:number;food:number;tick:number};
export type Snapshot = {
  version:string; config:Config; rng:number; tick:number; epoch:number;
  x:number;y:number;energy:number;food:number[];memory:Memory[];
  ledger:{initial:number; supplied:number; spent:number};
};
export type Transition = {
  accepted:boolean; reason?:string; request:Request | null; proposal:Proposal;
  tick?:number; action?:Action; reward?:number; terminated?:boolean; truncated?:boolean;
  events?:{kind:string;amount?:number;dx?:number;dy?:number}[];
  rewardParts?:{energyDelta:number;death:number}; snapshot?:Snapshot;
};
export class MicroWorld {
  private state: Snapshot;
  private generation = 0;
  private pending: Request | null = null;
  private attempts = 0;
  constructor(config: Partial<Config> = {}) {
    const c = {...DEFAULT_CONFIG,...config};
    if (!Number.isInteger(c.seed) || !Number.isInteger(c.size) || c.size<3 || c.size>64 || !c.runId) throw new Error('invalid_config');
    for(const [key,value] of Object.entries(c)) if(typeof value==='number' && (!Number.isFinite(value) || (key!=='seed' && value<0))) throw new Error('invalid_config');
    for(const key of ['horizon','phaseSteps','perception','memorySize','memoryTtl','supplyEvery'] as const)
      if (!Number.isInteger(c[key]) || c[key]<1) throw new Error('invalid_config');
    if(c.initialEnergy>c.capacity || c.capacity<=0 || c.bite<=0) throw new Error('invalid_config');
    this.state={version:SIM_VERSION,config:c,rng:c.seed>>>0 || 1,tick:0,epoch:0,
      x:Math.floor(c.size/2),y:Math.floor(c.size/2),energy:c.initialEnergy,
      food:Array(c.size*c.size).fill(0),memory:[],ledger:{initial:c.initialEnergy+c.initialFood,supplied:0,spent:0}};
    let remaining=c.initialFood;
    while(remaining>0) {const n=Math.min(c.bite,remaining);this.spawn(n);remaining-=n;}
    this.refreshMemory();
  }
  private random() {
    let x=this.state.rng; x^=x<<13;x^=x>>>17;x^=x<<5;
    this.state.rng=x>>>0;return this.state.rng/4294967296;
  }
  private spawn(amount:number) {
    const s=this.state, n=s.config.size;
    const phase=Math.floor(s.tick/s.config.phaseSteps)%3;
    // 环境日程只在环境内部使用；不进入观测或候选说明。
    const x=phase===1?Math.floor(this.random()*n):Math.floor(this.random()*Math.ceil(n/2));
    const y=Math.floor(this.random()*n);
    s.food[y*n+x]+=amount;
  }
  private local() {
    const s=this.state, c=s.config, cells=[];
    for(let dy=-c.perception;dy<=c.perception;dy++) for(let dx=-c.perception;dx<=c.perception;dx++) {
      if(Math.abs(dx)+Math.abs(dy)>c.perception) continue;
      const x=s.x+dx,y=s.y+dy,blocked=x<0 || y<0 || x>=c.size || y>=c.size;
      cells.push({dx,dy,blocked,food:blocked?0:s.food[y*c.size+x]});
    }
    return cells;
  }
  private refreshMemory() {
    const s=this.state,c=s.config;
    for(const cell of this.local()) {
      if(cell.blocked) continue;
      const x=s.x+cell.dx,y=s.y+cell.dy;
      s.memory=s.memory.filter(m=>m.x!==x || m.y!==y);
      if(cell.food>0) s.memory.push({x,y,food:cell.food,tick:s.tick});
    }
    s.memory=s.memory.filter(m=>s.tick-m.tick<=c.memoryTtl).slice(-c.memorySize);
  }
  request(): Request {
    if(this.done()) throw new Error('episode_done');
    if(this.pending) return structuredClone(this.pending);
    this.pending=this.inspect();
    return structuredClone(this.pending);
  }
  inspect(): Request {
    const s=this.state,c=s.config;
    const candidates:Candidate[]=[];
    for(const [id,[dx,dy]] of Object.entries(DIRECTIONS)) {
      if(id==='eat' && s.food[s.y*c.size+s.x]<=0) continue;
      if(s.x+dx<0 || s.y+dy<0 || s.x+dx>=c.size || s.y+dy>=c.size) continue;
      const description=id==='eat'?'Eat food at the current location.':id==='rest'?'Stay here; pay only resting metabolism.':`Move one cell ${id}.`;
      candidates.push({id:id as Action,dx,dy,description});
    }
    const description={identity:{protocol:PROTOCOL_VERSION,runId:c.runId,generation:this.generation,epoch:s.epoch,
      decisionId:`${c.runId}:${s.epoch}:${s.tick}`,attemptId:`try-${this.attempts}`,
      tick:s.tick,snapshotId:`${c.runId}:${s.epoch}:${s.tick}`,agentId:'life-0'},
      observation:{energy:s.energy,capacity:c.capacity,age:s.tick,local:this.local(),memory:s.memory.map(m=>({dx:m.x-s.x,dy:m.y-s.y,food:m.food,stepsAgo:s.tick-m.tick}))},candidates};
    return description;
  }
  retry(): Request { this.attempts++;this.pending=null;return this.request(); }
  cancel():void { this.state.epoch++;this.pending=null;this.attempts=0; }
  done():boolean { return this.state.energy<=0 || this.state.tick>=this.state.config.horizon; }
  step(proposal:Proposal): Transition {
    const request=this.pending;
    if(!request) return {accepted:false,reason:'no_pending_decision',request:null,proposal};
    const reason=validateProposal(request,proposal);
    if(reason) return {accepted:false,reason,request:structuredClone(request),proposal};
    const s=this.state,c=s.config,before=s.energy,events:NonNullable<Transition['events']>=[];
    const [dx,dy]=DIRECTIONS[proposal.action];
    s.x+=dx;s.y+=dy;
    if(dx || dy) events.push({kind:'moved',dx,dy});
    if(proposal.action==='eat') {
      const index=s.y*c.size+s.x;
      const amount=Math.min(s.food[index],c.bite,c.capacity-s.energy);
      s.food[index]-=amount;s.energy+=amount;events.push({kind:'ate',amount});
    }
    const spent=Math.min(s.energy,c.metabolism+((dx||dy)?c.moveCost:0));
    s.energy-=spent;s.ledger.spent+=spent;events.push({kind:'spent',amount:spent});
    s.tick++;
    if(s.tick%c.supplyEvery===0) {this.spawn(c.supplyAmount);s.ledger.supplied+=c.supplyAmount;events.push({kind:'supplied',amount:c.supplyAmount});}
    this.refreshMemory();
    const terminated=s.energy<=0,truncated=!terminated && s.tick>=c.horizon;
    if(terminated) events.push({kind:'died'});
    const rewardParts={energyDelta:(s.energy-before)/10,death:terminated?-1:0};
    this.pending=null;this.attempts=0;
    this.assertLedger();
    return {accepted:true,request:structuredClone(request),proposal:structuredClone(proposal),tick:s.tick,
      action:proposal.action,reward:rewardParts.energyDelta+rewardParts.death,rewardParts,terminated,truncated,events,snapshot:this.snapshot()};
  }
  snapshot():Snapshot { return structuredClone(this.state); }
  restore(snapshot:Snapshot):void {
    if(snapshot.version!==SIM_VERSION) throw new Error('snapshot_version');
    const candidate=structuredClone(snapshot),c=candidate.config;
    new MicroWorld(c); // 验证配置，不保留临时世界。
    if(candidate.food.length!==c.size*c.size || candidate.food.some(x=>!Number.isFinite(x)||x<0) || !Number.isFinite(candidate.energy) || candidate.energy<0 || candidate.energy>c.capacity || !Number.isInteger(candidate.tick) || candidate.tick<0 || !Number.isInteger(candidate.epoch) || candidate.epoch<0 || !Number.isInteger(candidate.rng) || candidate.rng<1 || candidate.rng>0xffffffff || !Number.isInteger(candidate.x) || !Number.isInteger(candidate.y) || candidate.x<0 || candidate.y<0 || candidate.x>=c.size || candidate.y>=c.size || candidate.memory.length>c.memorySize) throw new Error('invalid_snapshot');
    for(const m of candidate.memory) if(!Number.isInteger(m.x)||!Number.isInteger(m.y)||m.x<0||m.y<0||m.x>=c.size||m.y>=c.size||!Number.isFinite(m.food)||m.food<0||!Number.isInteger(m.tick)||m.tick<0||m.tick>candidate.tick) throw new Error('invalid_memory');
    const old=this.state;this.state=candidate;
    try {this.assertLedger();} catch(e) {this.state=old;throw e;}
    this.generation++;this.pending=null;this.attempts=0;
  }
  assertLedger():void {
    const s=this.state;
    for(const n of Object.values(s.ledger)) if(!Number.isFinite(n)||n<0) throw new Error('invalid_ledger');
    const left=s.energy+s.food.reduce((a,b)=>a+b,0)+s.ledger.spent;
    if(Math.abs(left-s.ledger.initial-s.ledger.supplied)>1e-7) throw new Error('energy_ledger');
  }
}
