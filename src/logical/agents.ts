import { spawn, execFile } from 'node:child_process';
import { access, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { AGENTS, type AgentId } from './types.js';

export interface AgentOptions { agent: AgentId; model?: string; provider?: string; bin?: string }
export interface Invocation { bin: string; args: string[]; env: NodeJS.ProcessEnv; stdin?: string }
const executableNames: Record<AgentId, string> = { 'claude-code': 'claude', codex: 'codex', opencode: 'opencode', pi: 'pi' };
export function agentId(value: string): AgentId { if (!AGENTS.includes(value as AgentId)) throw new Error(`Choose --agent ${AGENTS.join('|')}.`); return value as AgentId; }
export function validateAgentOptions(options: AgentOptions): void {
  agentId(options.agent);
  for (const [name, value] of [['model', options.model], ['provider', options.provider]]) if (value !== undefined && (typeof value !== 'string' || !/^[\w][\w.:/@#+-]{0,199}$/.test(value))) throw new Error(`Invalid --${name} identifier.`);
  if (options.provider && options.agent !== 'pi') throw new Error('--provider is supported by Pi; use a provider-qualified --model for OpenCode.');
  if (options.provider && !options.model) throw new Error('--provider requires --model.');
}
export async function findAgent(agent: AgentId, override?: string): Promise<string> {
  const name = override ?? executableNames[agent];
  const names = process.platform === 'win32' && !path.extname(name) ? [name + '.exe', name + '.cmd', name] : [name];
  const directories = name.includes('/') || name.includes('\\') ? [''] : (process.env.PATH ?? '').split(path.delimiter);
  for (const directory of directories) for (const name of names) {
    const file = path.resolve(directory, name);
    try { await access(file, process.platform === 'win32' ? constants.F_OK : /\.[cm]?js$/i.test(file) ? constants.R_OK : constants.X_OK); return file; } catch { /* next candidate */ }
  }
  throw new Error(`${executableNames[agent]} is not installed or not on PATH. Install/authenticate it separately, or supply --agent-bin.`);
}
export function childEnvironment(): NodeJS.ProcessEnv {
  // Keep CLI-owned authentication/provider settings, but strip inherited project/harness injection.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', TERM: 'dumb' };
  for (const key of Object.keys(env)) if (/^(GIT_|DIFFSLICE_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|OPENCODE_CONFIG|OPENCODE_SERVER|NODE_OPTIONS$|NODE_PATH$|LD_PRELOAD$|DYLD_|BASH_ENV$|ENV$)/.test(key)) delete env[key];
  return env;
}
// npm Windows shims must not require shell:true (which would interpret model/prompt text).
async function command(bin: string): Promise<{ bin: string; prefix: string[] }> {
  if (/\.[cm]?js$/i.test(bin)) return { bin: process.execPath, prefix: [bin] };
  if (/\.cmd$/i.test(bin)) {
    const raw = await readFile(bin, 'utf8');
    const matches = [...raw.matchAll(/%dp0%[\\/]([^"\r\n]*?\.[cm]?js)/g)];
    const entry = matches.at(-1)?.[1];
    if (!entry) throw new Error('Unsupported Windows CLI shim. Supply --agent-bin pointing to its JavaScript entry or native executable.');
    return { bin: process.execPath, prefix: [await realpath(path.resolve(path.dirname(bin), entry.replace(/\\/g, '/')))] };
  }
  return { bin, prefix: [] };
}
export async function planInvocation(options: AgentOptions, bin: string, cwd: string, prompt: string): Promise<Invocation> {
  validateAgentOptions(options); const env = childEnvironment(); let args: string[], stdin: string | undefined = prompt;
  if (options.agent === 'claude-code') {
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--no-session-persistence', '--setting-sources', '', '--disable-slash-commands'];
    // Keep normal CLI authentication. Do not use --bare (it disables subscription auth).
    env.CLAUDE_CODE_SAFE_MODE = '1';
  } else if (options.agent === 'codex') {
    args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false', '-'];
  } else if (options.agent === 'opencode') {
    await writeFile(path.join(cwd, 'prompt.txt'), prompt, { mode: 0o600 });
    await writeFile(path.join(cwd, 'opencode.json'), JSON.stringify({ snapshots: false, permissions: [{ action: '*', resource: '*', effect: 'deny' }], policies: ['tool.use', 'mcp.use', 'plugin.use', 'skill.use'].map(action => ({ action, resource: '*', effect: 'deny' })) }), { mode: 0o600 });
    args = ['--standalone', 'run', '--format', 'json', '--file', path.join(cwd, 'prompt.txt'), 'Analyse the attached evidence. Return only the requested JSON.']; stdin = undefined;
  } else {
    args = ['-p', '--mode', 'json', '--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-approve'];
    if (options.provider) args.push('--provider', options.provider);
  }
  if (options.model) args.push('--model', options.model);
  const cmd = await command(bin); return { bin: cmd.bin, args: [...cmd.prefix, ...args], env, stdin };
}
export async function runProcess(inv: Invocation, cwd: string, signal: AbortSignal, onProgress?: (message: string) => void, timeoutMs = 600_000): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(inv.bin, inv.args, { cwd, env: inv.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let stdout = '', bytes = 0, failure: Error | undefined, escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (force: boolean) => {
        if (!child.pid) return;
        if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
        else { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already stopped */ } }
    };
    const terminate = (reason: Error) => {
      if (failure) return; failure = reason;
      kill(false); escalation = setTimeout(() => kill(true), 2000); escalation.unref();
    };
    const abort = () => terminate(new Error('Logical analysis cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => terminate(new Error('Agent timed out. No logical result was saved.')), timeoutMs); timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 8 * 1024 * 1024) terminate(new Error('Agent output exceeded 8 MiB.')); else stdout += chunk; });
    child.stderr.resume(); // Drain without retaining provider diagnostics/secrets in report state.
    child.stdin.on('error', () => {});
    child.once('spawn', () => { onProgress?.('Agent running'); child.stdin.end(inv.stdin); });
    const cleanup = () => { clearTimeout(timer); if (escalation) clearTimeout(escalation); signal.removeEventListener('abort', abort); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      // A leader can exit before its detached descendants. Stop the whole owned group.
      if (failure && process.platform !== 'win32') kill(true);
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Agent exited with ${code}. Check the CLI's authentication, selected model, and supported version by running it directly. Agent stderr is not copied into shared report state.`));
      else resolve(stdout);
    });
    if (signal.aborted) abort();
  });
}
export async function probeAgent(options: AgentOptions, cwd: string, signal: AbortSignal): Promise<{ bin: string; version: string }> {
  validateAgentOptions(options); const bin = await findAgent(options.agent, options.bin); const cmd = await command(bin);
  const raw = await runProcess({ bin: cmd.bin, args: [...cmd.prefix, '--version'], env: childEnvironment() }, cwd, signal, undefined, 15_000);
  const version = raw.trim().split('\n')[0];
  if (!version || version.length > 200) throw new Error('Agent returned an invalid version.');
  const minimums: Record<AgentId, number[]> = { 'claude-code': [2, 1, 318], codex: [0, 166, 0], opencode: [2, 2, 3], pi: [1, 5, 0] };
  const match = version.match(/(?:v|\s|^)(\d+)\.(\d+)\.(\d+)/), minimum = minimums[options.agent];
  const actual = match?.slice(1).map(Number);
  let compatible = !!actual;
  if (actual) for (let i = 0; i < 3; i++) { if (actual[i] !== minimum[i]) { compatible = actual[i] > minimum[i]; break; } }
  if (!compatible) throw new Error(`Logical analysis requires ${executableNames[options.agent]} ${minimum.join('.')}+ for the supported headless safety profile.`);
  return { bin, version };
}
export function extractResult(agent: AgentId, stdout: string): unknown {
  let final = '', fragments = '', failed = false;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue; let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (agent === 'claude-code') {
      if (e.type === 'result') { if (e.is_error || e.subtype && e.subtype !== 'success') failed = true; if (e.structured_output && !failed) final = JSON.stringify(e.structured_output); if (typeof e.result === 'string' && !e.structured_output) final = e.result; }
      if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'text') fragments += c.text;
    } else if (agent === 'codex') {
      if (e.type === 'error' || e.type === 'turn.failed') failed = true;
      if (e.type === 'item.completed' && e.item?.type === 'agent_message') final = e.item.text;
    } else if (agent === 'opencode') {
      if (e.type === 'error') failed = true;
      if (e.type === 'text' && typeof e.part?.text === 'string') fragments += e.part.text;
    } else {
      if (e.type === 'message_end' && e.message?.role === 'assistant') {
        if (['error', 'aborted'].includes(e.message.stopReason)) failed = true;
        const content = e.message.content; if (Array.isArray(content)) final = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      }
    }
  }
  if (failed) throw new Error('Agent reported a failed turn. No logical result was saved.');
  const raw = (final || fragments).trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  if (!raw) throw new Error('Agent returned no supported final response. Check the installed CLI version.');
  try { return JSON.parse(raw); } catch { throw new Error('Agent did not return valid logical-map JSON. No result was saved.'); }
}
