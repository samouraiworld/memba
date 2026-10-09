// Offline assembly check against A's real sources. No server or live I/O.
// Usage: node .../verify-shared-recovery.mjs /path/to/A/repository
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the A repository root containing its shared Free Play client/index.');
const sharedRoot = resolve(process.argv[2]);
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const require = createRequire(join(root, 'frontend/package.json'));
const { buildSync } = require('esbuild');
const temp = mkdtempSync(join(tmpdir(), 'memba-si-recovery-'));
const quoted = path => JSON.stringify(path);
try {
  buildSync({ stdin: { resolveDir: join(root, 'frontend'), loader: 'tsx', contents: `
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import vectors from ${quoted(fileURLToPath(new URL('./freeplay_vectors.json', import.meta.url)))};
import { createSpaceInvadersPublication } from ${quoted(join(root, 'frontend/src/games/space-invaders/lib/freePlayPublication'))};
import { createFreePlayClient } from ${quoted(join(sharedRoot, 'frontend/src/lib/arcadeFreePlay'))};
import { createFreePlaySnapshot, listFreePlaySnapshots, loadFreePlaySnapshot, saveFreePlaySnapshot } from ${quoted(join(sharedRoot, 'frontend/src/games/arcade/freeplay/snapshot'))};
import { createFreePlaySession } from ${quoted(join(sharedRoot, 'frontend/src/games/arcade/freeplay/session'))};
import { FreePlayResult } from ${quoted(join(sharedRoot, 'frontend/src/games/arcade/freeplay/FreePlayResult'))};
async function main() {
 const f = vectors.valid[0], input = f.input;
 const entry = { game: input.game, player: f.player, rules: input.rules, simVersion: input.simVersion, runID: f.runID, seed: input.seed, score: f.score, stateHash: f.stateHash, replayHash: f.replayHash };
 const run = { target: f.target, entry, clientRunId: input.clientRunId, payloadHash: f.payloadHash, replayCodec: input.replayCodec, replay: input.replay, status: 'confirmed', receipt: { target: f.target, entry, height: 123, attester: f.player, schemaVersion: 2 } };
 const records = new Map();
 const storage = { getItem: key => records.get(key) ?? null, setItem: (key,value) => { records.set(key,value); } };
 saveFreePlaySnapshot(storage, { ...createFreePlaySnapshot(input), binding: { player: f.player, target: f.target }, result: run });
 const page = listFreePlaySnapshots(storage, { game: 'space-invaders', offset: 0, limit: 10 });
 assert.equal(page.total, 1); assert.equal(page.unavailable, 0); assert.equal(page.snapshots.length, 1);
 const selectedId = page.snapshots[0].input.clientRunId;
 assert.equal(selectedId, input.clientRunId);
 let subscriptions=0, reads=0, tokens=0, created=0;
 const identity = { player: f.player, chainId: f.target.chainId, revision: 'test-session' };
 const client = createFreePlayClient({ origin:'https://example.invalid', target:f.target,
   auth:{identity:()=>identity, subscribe:()=>{subscriptions++;return()=>{subscriptions--;};}, token:async()=>{tokens++;return{token:'offline-test',identity};}},
   fetch:async(_url, init)=>{assert.equal(init?.method,'GET');reads++;return new Response(JSON.stringify(run),{status:200});},
 });
 let restored;
 const adapter = createSpaceInvadersPublication({
   createSnapshot: input => { created++; return createFreePlaySnapshot(input); },
   createSession: snapshot => (restored=createFreePlaySession({snapshot,client,storage})),
   renderSession: session => createElement(FreePlayResult,{session}),
   recovery: { loadSnapshot:id=>loadFreePlaySnapshot(storage,id), inputOf:snapshot=>snapshot.input },
 });
 const prepared = await adapter.recover(selectedId);
 assert.equal(created,0); assert.equal(restored.getSnapshot().phase,'saved'); assert.equal(reads,0); assert.equal(tokens,0);
 const before = renderToStaticMarkup(prepared.content);
 assert.match(before,/Saved receipt/); assert.doesNotMatch(before,/Score confirmed on/); assert.match(before,/Check saved result/);
 await restored.refresh();
 assert.equal(reads,1); assert.equal(tokens,1); assert.equal(restored.getSnapshot().phase,'confirmed');
 assert.match(renderToStaticMarkup(prepared.content),/Score confirmed on/);
 prepared.dispose(); assert.equal(subscriptions,0);
 assert.equal(listFreePlaySnapshots(storage,{game:'space-invaders'}).total,1);
 console.log('PASS: A shared index -> existing UUID -> B recovery -> A saved/unconfirmed UI. Zero automatic I/O/new snapshots; explicit offline readback confirms after A validation; session cleanup and one retained index entry.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
` }, bundle: true, jsx: 'automatic', platform: 'node', format: 'cjs', alias: {
      react: realpathSync(join(root, 'frontend/node_modules/react')),
      'react-dom': realpathSync(join(root, 'frontend/node_modules/react-dom')),
    }, outfile: join(temp, 'check.cjs'), logLevel: 'silent' });
  require(join(temp, 'check.cjs'));
} finally { rmSync(temp, { recursive: true, force: true }); }
