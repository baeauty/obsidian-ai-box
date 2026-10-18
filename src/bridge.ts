import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { findBlock, mergeBlock, removeBlock, type AgentId } from './instructions';

const MAX_BYTES = 2 * 1024 * 1024;
const digest = (text: string | null) => createHash('sha256').update(text === null ? 'absent' : `present:${text}`).digest('hex');
export interface Plan {
  agent: AgentId;
  target: string;
  root: string;
  before: string | null;
  after: string | null;
  beforeHash: string;
  warnings: string[];
  action: 'connect' | 'disconnect' | 'rollback';
}
export interface Receipt { target: string; backupId: string; at: string; action: string }
interface Backup {
  version: 1; target: string; root: string; before: string | null; afterHash: string; at: string; action: string;
}

async function assertNoSymlink(target: string): Promise<void> {
  let current = path.resolve(target);
  for (;;) {
    try {
      const entry = await fs.lstat(current);
      if (entry.isSymbolicLink()) throw new Error(`路径包含符号链接或联接，请使用真实路径：${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function readTarget(target: string): Promise<string | null> {
  await assertNoSymlink(target);
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('全局规则目标必须是普通文件。');
    if (stat.size > MAX_BYTES) throw new Error('规则文件超过 2 MB，请手工检查后再接入。');
    const bytes = await fs.readFile(target);
    // Buffer.toString would silently replace invalid bytes, risking unrelated content.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function validatePaths(agent: AgentId, target: string, root: string): string {
  if (!path.isAbsolute(target) || !path.isAbsolute(root) || /[\r\n\u0000]/.test(target + root)) {
    throw new Error('知识库和全局规则文件必须使用有效绝对路径。');
  }
  const resolved = path.resolve(target);
  if (path.basename(resolved) !== (agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md')) {
    throw new Error('目标文件名应为该工具的 AGENTS.md 或 CLAUDE.md。');
  }
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('全局入口应位于知识库外，请检查目标路径。');
  }
  return resolved;
}

export async function makePlan(agent: AgentId, target: string, root: string, autoSave = true, disconnect = false): Promise<Plan> {
  target = validatePaths(agent, target, root);
  root = path.resolve(root);
  const before = await readTarget(target);
  const block = findBlock(before ?? '');
  const warnings: string[] = [];
  if (block && !block.root) warnings.push('发现旧版 AI Box 入口；本次会替换这一段，原文件将先备份。');
  if (block?.root && block.root !== root) warnings.push(`此 Agent 当前绑定另一知识库：${block.root}。应用后将改为当前库。`);
  if (!before) warnings.push('目标规则文件尚无内容；接入不代表该 Agent 已安装。');
  let after = disconnect ? removeBlock(before ?? '', root) : mergeBlock(before ?? '', root, autoSave);
  if (agent === 'codex') {
    try {
      if ((await fs.readFile(path.join(path.dirname(target), 'AGENTS.override.md'), 'utf8')).trim()) {
        warnings.push('发现非空 AGENTS.override.md，Codex 可能优先加载它；本插件不会修改此覆盖文件。');
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const result: Plan = { agent, target, root, before, after, beforeHash: digest(before), warnings, action: disconnect ? 'disconnect' : 'connect' };
  if (disconnect && before === null) result.after = null;
  return result;
}

export async function rollbackPlan(agent: AgentId, receipt: Receipt, root: string): Promise<Plan> {
  const target = validatePaths(agent, receipt.target, root);
  if (!/^[0-9a-f-]{36}\.json$/.test(receipt.backupId)) throw new Error('备份编号无效。');
  const file = path.join(path.dirname(target), '.ai-box-backups', receipt.backupId);
  await assertNoSymlink(file);
  const record: Backup = JSON.parse(await fs.readFile(file, 'utf8'));
  if (record.version !== 1 || record.target !== target || record.root !== path.resolve(root) ||
      !(record.before === null || typeof record.before === 'string') || typeof record.afterHash !== 'string') {
    throw new Error('备份不属于此入口或当前知识库。');
  }
  const before = await readTarget(target);
  if (digest(before) !== record.afterHash) throw new Error('入口在操作后已被修改；为保留新内容，不能自动恢复整个文件。可使用解除当前库或手工合并备份。');
  return { agent, target, root: path.resolve(root), before, after: record.before, beforeHash: digest(before), warnings: [], action: 'rollback' };
}

export async function applyPlan(plan: Plan): Promise<Receipt | undefined> {
  validatePaths(plan.agent, plan.target, plan.root);
  if (plan.before === plan.after) return undefined;
  await assertNoSymlink(plan.target);
  await fs.mkdir(path.dirname(plan.target), { recursive: true });
  const lockPath = `${plan.target}.ai-box.lock`;
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('此入口正由另一个操作使用；若上次异常退出，请核查后移除旁边的 .ai-box.lock 文件。');
    throw error;
  }
  const temp = `${plan.target}.${randomUUID()}.tmp`;
  try {
    const current = await readTarget(plan.target);
    if (digest(current) !== plan.beforeHash) throw new Error('预览后文件已经变化，请重新预览再应用。');
    const directory = path.join(path.dirname(plan.target), '.ai-box-backups');
    await assertNoSymlink(directory);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const backupId = `${randomUUID()}.json`;
    const at = new Date().toISOString();
    const backup: Backup = { version: 1, target: plan.target, root: plan.root, before: current, afterHash: digest(plan.after), at, action: plan.action };
    await fs.writeFile(path.join(directory, backupId), JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (plan.after !== null) {
      const mode = current === null ? 0o600 : (await fs.stat(plan.target)).mode & 0o777;
      await fs.writeFile(temp, plan.after, { flag: 'wx', mode });
    }
    // Recheck immediately before the atomic replacement; the lock serializes AI Box writers.
    if (digest(await readTarget(plan.target)) !== plan.beforeHash) throw new Error('写入前文件再次变化，请重新预览。');
    if (plan.after === null) await fs.unlink(plan.target);
    else await fs.rename(temp, plan.target);
    return { target: plan.target, backupId, at, action: plan.action };
  } finally {
    await fs.unlink(temp).catch(() => {});
    await lock.close();
    await fs.unlink(lockPath);
  }
}

export async function inspectTarget(agent: AgentId, target: string, root: string): Promise<string[]> {
  const plan = await makePlan(agent, target, root);
  const block = findBlock(plan.before ?? '');
  return [block?.root === path.resolve(root) ? '入口已绑定当前库（配置检查）' : block ? '入口绑定旧版或其他库' : '未接入',
    ...plan.warnings, '实际检索、写回与新会话复用：需在 Agent 新会话中验收。'];
}
