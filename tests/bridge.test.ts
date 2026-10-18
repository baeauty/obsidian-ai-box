import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyPlan, makePlan, rollbackPlan, inspectTarget } from '../src/bridge';
import { BEGIN, END, defaultTarget, findBlock, mergeBlock, removeBlock } from '../src/instructions';
import { initializeVault, templateFiles } from '../src/templates';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-box-test-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '我的独立知识库');
  await fs.mkdir(root);
  const target = path.join(dir, '.dsh', 'AGENTS.md');
  return { dir, root, target };
}

test('合并保留 BOM、CRLF 和非托管内容，重复安装幂等', () => {
  const before = '\ufeff# 我的偏好\r\n保持此行\r\n';
  const once = mergeBlock(before, 'D:/独立库');
  assert.ok(once.startsWith(before));
  assert.equal(mergeBlock(once, 'D:/独立库'), once);
  assert.equal(once.replace(/\r\n/g, '').includes('\n'), false);
  const extra = once + '\r\n# 后续人工规则\r\n';
  const updated = mergeBlock(extra, 'E:/新库');
  assert.ok(updated.endsWith('\r\n# 后续人工规则\r\n'));
  assert.equal(findBlock(updated)?.root, 'E:/新库');
});

test('旧版入口只替换标记内的内容', () => {
  const old = `before\n${BEGIN}\n旧版\n${END}\nafter`;
  const result = mergeBlock(old, '/独立库');
  assert.ok(result.startsWith(`before\n${BEGIN}`));
  assert.ok(result.endsWith(`${END}\nafter`));
  assert.ok(!result.includes('旧版'));
});

test('损坏、重复、倒序标记均拒绝修改', () => {
  for (const text of [BEGIN, END, `${END}\n${BEGIN}`, `${BEGIN}${END}${BEGIN}${END}`]) {
    assert.throws(() => mergeBlock(text, '/vault'));
  }
});

test('只读模式明确覆盖库内沉淀规则，切换后更新一次', () => {
  const readonly = mergeBlock('', '/vault', false);
  assert.match(readonly, /不得自动保存/);
  assert.doesNotMatch(readonly, /切换会话时保存必要交接/);
  const writable = mergeBlock(readonly, '/vault', true);
  assert.match(writable, /用户已在本机启用自动精选沉淀/);
  assert.equal(writable.split(BEGIN).length, 2);
});

test('另一知识库不能解除当前绑定', () => {
  const text = mergeBlock('人工规则', '/one');
  assert.throws(() => removeBlock(text, '/two'));
  assert.ok(removeBlock(text, '/one').includes('人工规则'));
});

test('默认位置识别各工具环境变量，拒绝相对目录', () => {
  const home = path.resolve('fake-home');
  assert.equal(defaultTarget('dsh', {}, home), path.join(home, '.dsh/AGENTS.md'));
  for (const [agent, env, file] of [['dsh', 'DSH_HOME', 'AGENTS.md'], ['claude', 'CLAUDE_CONFIG_DIR', 'CLAUDE.md'], ['codex', 'CODEX_HOME', 'AGENTS.md']] as const) {
    assert.equal(defaultTarget(agent, { [env]: home }), path.join(home, file));
    assert.throws(() => defaultTarget(agent, { [env]: 'relative' }, home));
  }
});

test('真实文件：预览不写入，备份后接入，重复接入不产生备份', async t => {
  const { root, target } = await fixture(t);
  const plan = await makePlan('dsh', target, root);
  await assert.rejects(fs.stat(target));
  const receipt = await applyPlan(plan);
  assert.ok(receipt);
  const backup = JSON.parse(await fs.readFile(path.join(path.dirname(target), '.ai-box-backups', receipt.backupId), 'utf8'));
  assert.equal(backup.before, null);
  assert.equal(await applyPlan(await makePlan('dsh', target, root)), undefined);
  assert.equal((await fs.readdir(path.join(path.dirname(target), '.ai-box-backups'))).length, 1);
  assert.match((await inspectTarget('dsh', target, root)).join(), /配置检查/);
});

test('真实文件：旧规则完整备份、精确恢复，新增文件撤销后消失', async t => {
  const { root, target } = await fixture(t);
  await fs.mkdir(path.dirname(target));
  const original = '\ufeff人工偏好\r\n不要改我\r\n';
  await fs.writeFile(target, original);
  const receipt = await applyPlan(await makePlan('dsh', target, root));
  assert.ok(receipt);
  await applyPlan(await rollbackPlan('dsh', receipt, root));
  assert.equal(await fs.readFile(target, 'utf8'), original);
  await fs.unlink(target);
  const fresh = await applyPlan(await makePlan('dsh', target, root));
  assert.ok(fresh);
  await applyPlan(await rollbackPlan('dsh', fresh, root));
  await assert.rejects(fs.stat(target));
});

test('预览后外部编辑阻止写入，操作后外部编辑阻止快照恢复', async t => {
  const { root, target } = await fixture(t);
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, 'original');
  const stale = await makePlan('dsh', target, root);
  await fs.writeFile(target, 'new changes');
  await assert.rejects(applyPlan(stale), /已经变化/);
  assert.equal(await fs.readFile(target, 'utf8'), 'new changes');
  const receipt = await applyPlan(await makePlan('dsh', target, root));
  assert.ok(receipt);
  await fs.appendFile(target, '\n后续规则');
  await assert.rejects(rollbackPlan('dsh', receipt, root), /已被修改/);
  await applyPlan(await makePlan('dsh', target, root, true, true));
  assert.ok((await fs.readFile(target, 'utf8')).endsWith('\n后续规则'));
});

test('单个 Agent 改绑另一库前有明确警告', async t => {
  const { dir, root, target } = await fixture(t);
  await applyPlan(await makePlan('dsh', target, root));
  const second = await makePlan('dsh', target, path.join(dir, 'another-vault'));
  assert.match(second.warnings.join(), /另一知识库/);
  await applyPlan(second);
  await assert.rejects(makePlan('dsh', target, root, true, true), /未绑定当前知识库/);
});

test('拒绝错误目标、库内伪全局入口和无效 UTF-8', async t => {
  const { root, target } = await fixture(t);
  await assert.rejects(makePlan('dsh', 'relative/AGENTS.md', root));
  await assert.rejects(makePlan('dsh', path.join(root, 'AGENTS.md'), root));
  await assert.rejects(makePlan('dsh', target.replace('AGENTS.md', 'settings.json'), root));
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, Buffer.from([0xff, 0xfe, 0x20]));
  await assert.rejects(makePlan('dsh', target, root));
});

test('Codex 覆盖文件存在时告警，不修改覆盖文件', async t => {
  const { root, target } = await fixture(t);
  await fs.mkdir(path.dirname(target));
  const override = path.join(path.dirname(target), 'AGENTS.override.md');
  await fs.writeFile(override, 'keep');
  const plan = await makePlan('codex', target, root);
  assert.match(plan.warnings.join(), /AGENTS.override.md/);
  await applyPlan(plan);
  assert.equal(await fs.readFile(override, 'utf8'), 'keep');
});

test('锁阻止并行写入，其他操作的锁不会被移除', async t => {
  const { root, target } = await fixture(t);
  await fs.mkdir(path.dirname(target));
  const plan = await makePlan('dsh', target, root);
  await fs.writeFile(`${target}.ai-box.lock`, 'another writer');
  await assert.rejects(applyPlan(plan), /另一个操作/);
  assert.equal(await fs.readFile(`${target}.ai-box.lock`, 'utf8'), 'another writer');
});

test('备份路径不能穿越或恢复其他库的快照', async t => {
  const { dir, root, target } = await fixture(t);
  const receipt = await applyPlan(await makePlan('dsh', target, root));
  assert.ok(receipt);
  await assert.rejects(rollbackPlan('dsh', { ...receipt, backupId: '../../bad.json' }, root));
  await assert.rejects(rollbackPlan('dsh', receipt, path.join(dir, 'wrong-vault')));
});

test('符号链接或目录联接被拒绝，不修改真实目标', async t => {
  const { dir, root } = await fixture(t);
  const real = path.join(dir, 'real');
  const link = path.join(dir, 'link');
  await fs.mkdir(real);
  await fs.writeFile(path.join(real, 'AGENTS.md'), 'preserve');
  await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(makePlan('dsh', path.join(link, 'AGENTS.md'), root), /符号链接或联接/);
  assert.equal(await fs.readFile(path.join(real, 'AGENTS.md'), 'utf8'), 'preserve');
});

test('初始化在独立文件夹生成完整模板，重跑不覆盖已有笔记', async t => {
  const { root } = await fixture(t);
  const io = {
    exists: async (file: string) => { try { await fs.stat(path.join(root, file)); return true; } catch { return false; } },
    mkdir: async (folder: string) => { await fs.mkdir(path.join(root, folder)); },
    create: async (file: string, text: string) => { await fs.writeFile(path.join(root, file), text, { flag: 'wx' }); },
  };
  const first = await initializeVault(io);
  assert.equal(first.created.length, Object.keys(templateFiles()).length);
  await fs.writeFile(path.join(root, 'SCHEMA.md'), '我的自定义规范');
  const second = await initializeVault(io);
  assert.equal(second.created.length, 0);
  assert.equal(await fs.readFile(path.join(root, 'SCHEMA.md'), 'utf8'), '我的自定义规范');
  assert.equal((await fs.readdir(path.join(root, 'raw/收件箱'))).length, 0);
});

test('模板没有个人绝对路径、已完成案例和定时任务承诺；内部链接均存在', () => {
  const templates = templateFiles();
  const joined = Object.values(templates).join('\n');
  assert.doesNotMatch(joined, /chenhan|D:\/Obsidian|BL-12|FlowHub|automation-2/);
  for (const text of Object.values(templates)) {
    for (const match of text.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)) {
      assert.ok(templates[`${match[1]}.md`], `链接存在：${match[1]}`);
    }
  }
});
