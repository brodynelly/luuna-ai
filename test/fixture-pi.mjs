// Synthetic Pi RPC fixture: never calls a provider. Used only by the native smoke.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--mode', 'rpc', '--no-session'], 'Pi must receive exact RPC arguments through its Windows launcher');
if (process.env.LUUNA_SMOKE_RPC_LOG) appendFileSync(process.env.LUUNA_SMOKE_RPC_LOG, JSON.stringify({type:'fixture_launch',pid:process.pid})+'\n');
createInterface({ input: process.stdin }).on('line', line => {
 try {
  const request = JSON.parse(line);
  if (process.env.LUUNA_SMOKE_RPC_LOG) appendFileSync(process.env.LUUNA_SMOKE_RPC_LOG, JSON.stringify({ type: request.type }) + '\n');
  let data = {};
  if (request.type === 'get_state') data = { model: {provider:'synthetic',id:'fixture'}, sessionName:'SYNTHETIC PI FIXTURE', sessionId:'smoke', thinkingLevel:'off', isStreaming:false };
  if (request.type === 'get_available_models') data = {models:[]};
  if (request.type === 'get_session_stats') data = {tokens:{input:0,output:0,total:0},cost:0,fixturePid:process.pid};
  process.stdout.write(JSON.stringify({ type:'response', id:request.id, command:request.type, success:true, data })+'\n');
 } catch { process.exitCode = 1; }
});
