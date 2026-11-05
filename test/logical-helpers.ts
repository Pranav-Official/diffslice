import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectEvidence } from '../src/logical/evidence.js';
import { validateLogicalMap, type LogicalMap } from '../src/logical/types.js';

export async function sampleMap(repo: string, base: string, head: string): Promise<LogicalMap> {
  const e = await collectEvidence(repo, base, head);
  return validateLogicalMap({ kind: 'diffslice-logical', schema: 1, repository: e.repository, base: e.base, head: e.head, comparison: 'commits', evidence: e.evidence, changedPaths: e.changedPaths, warnings: e.warnings,
    provenance: { agent: 'codex', model: 'fixture-model', cliVersion: 'fixture', generatedAt: new Date().toISOString(), analysisVersion: 1 },
    areas: [{ id: 'identity', name: 'Identity' }, { id: 'resources', name: 'Resources' }],
    nodes: [
      { id: 'login', area: 'identity', title: 'Authentication response', state: 'changed', summary: 'Updated login behavior', before: 'Previous response', after: 'New response', effect: 'Users receive the updated response.', purpose: 'Keep authentication behavior consistent.', evidence: e.evidence.filter(r => r.path === 'src/auth.ts').map(r => r.id) },
      { id: 'resource', area: 'resources', title: 'Resource availability', state: 'added', summary: 'Additional resource available', before: 'Not present', after: 'Resource available', effect: 'An additional resource can be used.', evidence: e.evidence.filter(r => r.path !== 'src/auth.ts').map(r => r.id) },
    ], edges: [{ id: 'relation', from: 'login', to: 'resource', label: 'uses resource', state: 'removed', evidence: [e.evidence[0].id] }],
  });
}
// Deliberately a synthetic protocol stand-in, not a claim about a live model response.
export async function fakeAgent(mode: 'normal' | 'invalid' | 'hang' = 'normal') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diffslice-agent-'));
  const filename = path.join(root, 'agent.mjs');
  await writeFile(filename, `import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('fixture-cli 2.2.5'); process.exit(0); }
appendFileSync(${JSON.stringify(path.join(root, 'calls.jsonl'))},JSON.stringify({cwd:process.cwd(),args})+'\\n');
${mode === 'hang' ? "setInterval(()=>{},1000);" : `
const prompt=args.includes('--file')?readFileSync(args[args.indexOf('--file')+1],'utf8'):readFileSync(0,'utf8');
let data;try{data=JSON.parse(prompt.split('EVIDENCE DATA:\\n')[1]);}catch{data=JSON.parse(prompt.split('DRAFT DATA:\\n')[1]);}
const refs=data.manifest.map(e=>e.id);
const result=${mode === 'invalid' ? "{areas:[],nodes:[{id:'bad'}],edges:[]}" : "data.drafts?{...data.drafts[0],nodes:data.drafts[0].nodes.map(n=>({...n,evidence:refs}))}:{areas:[{id:'capabilities',name:'Application capabilities'}],nodes:[{id:'capability',area:'capabilities',title:'Functional behavior',state:'changed',summary:'Behavior changes for users',before:'Previous behavior',after:'Updated behavior',effect:'The application behaves differently for users.',purpose:'Improve the workflow.',evidence:refs}],edges:[]}"};
const text=JSON.stringify(result);
let event=args.includes('exec')?{type:'item.completed',item:{type:'agent_message',text}}:args.includes('--file')?{type:'text',part:{text}}:args.includes('--output-format')?{type:'result',subtype:'success',result:text}:{type:'message_end',message:{role:'assistant',content:[{type:'text',text}]}};
console.log(JSON.stringify(event));`}
`);
  return { root, filename };
}
