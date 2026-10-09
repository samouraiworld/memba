// Offline fixture preparation only: no service, network, wallet or publication.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = process.env.SI_SOURCE_ROOT || fileURLToPath(new URL('../../../../../../', import.meta.url));
const require = createRequire(`${root}/frontend/package.json`);
const { buildSync } = require('esbuild');
const bundle = join(tmpdir(), 'memba-si-freeplay-fixtures.cjs');
buildSync({ stdin: { contents: `export {newGame, step} from './frontend/src/games/space-invaders/engine'; export {simulateReplay,hashState} from './frontend/src/games/space-invaders/lib/verify'; export {createInputRecorder} from './frontend/src/games/space-invaders/lib/replay'; export {toWireDeltas,fromWireDeltas} from './frontend/src/games/space-invaders/lib/wire';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
const {newGame, step, simulateReplay, hashState, createInputRecorder, toWireDeltas, fromWireDeltas} = require(bundle);
const {createHash} = require('node:crypto');
// Independent LP oracle for fixture bytes, not another production client.
const H=(...fields)=>createHash('sha256').update(Buffer.concat(fields.flatMap(s=>{const b=Buffer.from(s,'utf8');const n=Buffer.alloc(4);n.writeUInt32BE(b.length);return [n,b]}))).digest('hex');
const target={chainId:'gnoland-1',realm:'gno.land/r/samcrew/memba_arcade_scores_v2'};
const player='g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const fixtures=[];
for (const [index, seed] of [0,1,4242,4294967295].entries()) {
 let state=newGame(seed); const recorder=createInputRecorder(seed);
 for(let tick=0;tick<20000 && state.phase!=='gameover';tick++) {
  const input = index===2 && tick<120 ? {move:tick<60?.3:-.7,fire:true,pause:false} : {move:0,fire:tick===0,pause:false};
  recorder.record(tick,input);state=step(state,1000/60,input);
 }
 if(state.phase!=='gameover') throw Error('fixture must terminate within 20000 offline steps');
 const log=recorder.build(state.tick),events=toWireDeltas(log);
 const result=simulateReplay({...log,inputs:fromWireDeltas(events)});
 if(result.firstGameoverTick!==state.tick || result.score!==state.score || result.hash!==hashState(state)) throw Error('wire replay mismatch');
 const replay=[String(state.tick),...events.map(d=>d.join('|'))].join(';');
 const input={clientRunId:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,game:'space-invaders',rules:'si-free-standard-v1',simVersion:1,seed:`si1:${seed.toString(16).padStart(8,'0')}`,replayCodec:'si-deltas-v1',replay,finishReason:'game-over',claimedScore:state.score};
 const runID=H('memba:free-run:v1',target.chainId,target.realm,player,input.game,input.clientRunId);
 const replayHash=H('memba:free-replay:v1',input.game,input.rules,'1',input.seed,input.replayCodec,replay);
 const stateHash=result.hash.toString(16).padStart(8,'0');
 const payloadHash=H('memba:free-anchor:v1',target.chainId,target.realm,runID,player,input.game,input.rules,'1',input.seed,String(state.score),stateHash,replayHash);
 fixtures.push({name:index===2?'fractional-steering-terminal':`one-shot-terminal-${seed}`,target,player,input,engineSeed:seed,events,finalTick:state.tick,firstGameoverTick:result.firstGameoverTick,score:state.score,stateHash,runID,replayHash,payloadHash});
}
const base=fixtures[1];
const invalid=[
 ['zero-final-tick',{replay:'0;0|0|1|0'},'invalid_replay'],
 ['not-terminal',{replay:'1;0|0|1|0'},'not_terminal'],
 ['padded-after-terminal',{replay:base.input.replay.replace(/^\d+/,String(base.finalTick+1))},'not_terminal'],
 ['duplicate-tick',{replay:`${base.finalTick};0|0|1|0;0|0|0|0`},'invalid_replay'],
 ['pause-step',{replay:`${base.finalTick};0|0|1|0;1|0|0|1`},'invalid_replay'],
 ['fractional-wire-move',{replay:`${base.finalTick};0|0.3|1|0`},'invalid_replay'],
 ['noncanonical-leading-zero',{replay:`0${base.input.replay}`},'invalid_replay'],
 ['noncanonical-negative-zero',{replay:base.input.replay.replace('|0|1|0','|-0|1|0')},'invalid_replay'],
 ['out-of-range-move',{replay:`${base.finalTick};0|11|1|0`},'invalid_replay'],
 ['uppercase-seed',{seed:'si1:FFFFFFFF'},'invalid_replay'],
 ['legacy-daily-seed',{seed:'invaders-2026-10-09'},'invalid_replay'],
 ['wrong-version',{simVersion:2},'unsupported_version'],
 ['wrong-rules',{rules:'si-daily-v1'},'unsupported_rules'],
 ['wrong-score',{claimedScore:base.score+1},'claimed_result_mismatch'],
];
const output={status:'PROPOSED GAME ADAPTER CONTRACT; not yet verified in Go or enabled by A',sourceSha:'84b228e4a18578bf0b8151ae3176222ec380e6c3',encoding:'si-deltas-v1 canonical ASCII; SHA256 LP commitments as A contract',valid:fixtures,invalid:invalid.map(([name,override,error])=>({name,base:'one-shot-terminal-1',input:{...base.input,...override},expectedError:error}))};
const url=new URL('./freeplay_vectors.json',import.meta.url);writeFileSync(url,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({valid:fixtures.map(f=>({name:f.name,ticks:f.finalTick,score:f.score,hash:f.stateHash})),invalid:invalid.length}));
