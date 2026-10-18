import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('插件 API 集成：启动、设置、初始化预览与应用、只读接入、备份撤销', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-box-plugin-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'test-vault');
  await fs.mkdir(root);
  const notices: string[] = [];
  const modals: any[] = [];
  const buttons: any[] = [];
  const settings: any[] = [];
  const toggles: any[] = [];
  class Element {
    value = ''; readOnly = false;
    empty() {} addClass() {} setAttribute() {}
    createEl() { return new Element(); }
    createDiv() { return new Element(); }
  }
  class TFile { constructor(public path: string) {} }
  class Adapter {
    getBasePath() { return root; }
    async exists(file: string) { try { await fs.stat(path.join(root, file)); return true; } catch { return false; } }
  }
  const entries = new Map<string, any>();
  const app: any = { vault: {
    adapter: new Adapter(),
    getAbstractFileByPath: (file: string) => entries.get(file) ?? null,
    read: async (file: TFile) => await fs.readFile(path.join(root, file.path), 'utf8'),
    modify: async (file: TFile, text: string) => { await fs.writeFile(path.join(root, file.path), text); },
    createFolder: async (folder: string) => { await fs.mkdir(path.join(root, folder)); entries.set(folder, {}); },
    create: async (file: string, text: string) => {
      await fs.writeFile(path.join(root, file), text, { flag: 'wx' });
      const result = new TFile(file); entries.set(file, result); return result;
    },
  }, workspace: { getLeaf: () => ({ openFile: async () => {} }) } };
  class Plugin {
    app = app; tab: any; commands: any[] = [];
    async loadData() { return {}; } async saveData() {}
    addSettingTab(tab: any) { this.tab = tab; }
    addCommand(command: any) { this.commands.push(command); }
    addRibbonIcon() {}
  }
  class Modal {
    contentEl = new Element();
    constructor(public app: any) {}
    open() { modals.push(this); (this as any).onOpen(); }
    close() { (this as any).onClose(); }
  }
  class Setting {
    name = '';
    settingEl = new Element();
    constructor(el: any) { settings.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    addButton(fn: any) {
      const button: any = {
        text: '', disabled: false,
        setButtonText(text: string) { this.text = text; return this; },
        setCta() { return this; }, setDisabled(value: boolean) { this.disabled = value; return this; },
        onClick(click: any) { this.click = click; return this; },
      }; fn(button); buttons.push(button); return this;
    }
    addText(fn: any) {
      const control: any = { setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } };
      fn(control); return this;
    }
    addToggle(fn: any) {
      const toggle: any = { setValue() { return this; }, onChange(change: any) { this.change = change; return this; } }; fn(toggle); toggles.push(toggle); return this;
    }
  }
  class PluginSettingTab {
    containerEl = new Element();
    constructor(public app: any, plugin: any) {}
    update() { for (const definition of (this as any).getSettingDefinitions()) definition.render(new Setting(this.containerEl)); }
  }
  const obsidian = { Plugin, PluginSettingTab, Setting, Modal, TFile, FileSystemAdapter: Adapter,
    Notice: class { constructor(text: string) { notices.push(text); } } };
  const result = await build({ entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} as any };
  const realRequire = createRequire(path.join(process.cwd(), 'package.json'));
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (name: string) => name === 'obsidian' ? obsidian : realRequire(name), module, module.exports,
  );
  const plugin = new module.exports.default();
  const settle = async () => {
    for (let count = 0; plugin.busy && count < 500; count++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(plugin.busy, false, '异步操作完成');
  };
  await plugin.onload();
  assert.equal(plugin.settings.autoSave, false);
  assert.equal(plugin.commands.length, 2);
  plugin.tab.update();
  assert.equal(buttons.filter(b => b.text === '预览接入').length, 3);
  assert.equal(settings.filter(s => s.name === '自动精选沉淀').length, 1);
  plugin.previewInitialization(); await settle();
  assert.equal((await fs.readdir(root)).length, 0, '仅预览不写入');
  buttons.filter(b => b.text === '应用').at(-1).click(); await settle();
  assert.ok(entries.get('SCHEMA.md') instanceof TFile);
  await fs.writeFile(path.join(root, 'SCHEMA.md'), '# 我的已有知识库\n保留自定义规范与历史资料。\n');
  const snapshot = async (): Promise<Record<string, string>> => {
    const files: Record<string, string> = {};
    const walk = async (folder: string) => {
      for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
        const relative = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(relative);
        else files[relative] = (await fs.readFile(path.join(root, relative))).toString('base64');
      }
    };
    await walk('');
    return files;
  };
  const existingVault = await snapshot();
  const freshPlugin = new module.exports.default();
  await freshPlugin.onload();
  assert.deepEqual(await snapshot(), existingVault, '插件启动不初始化已有库');
  const target = path.join(dir, '.dsh', 'AGENTS.md');
  plugin.settings.targets.dsh = target;
  plugin.previewAgent('dsh', 'connect'); await settle();
  await assert.rejects(fs.stat(target));
  buttons.filter(b => b.text === '备份并应用').at(-1).click(); await settle();
  assert.match(await fs.readFile(target, 'utf8'), /不得自动保存/);
  assert.deepEqual(await snapshot(), existingVault, 'DSH 接入只修改库外全局入口，不新增或重写任何库内文件');
  assert.ok(plugin.settings.receipts.dsh);
  plugin.previewAgent('dsh', 'rollback'); await settle();
  buttons.filter(b => b.text === '备份并应用').at(-1).click(); await settle();
  await assert.rejects(fs.stat(target));
  await plugin.checkAgent('dsh');
  await plugin.checkVault();
  await plugin.openGuide();
  assert.ok(entries.get('schema/AI Box 接入验收.md') instanceof TFile);
  await toggles.at(-1).change(true);
  plugin.previewAgent('dsh', 'connect'); await settle();
  assert.match(modals.at(-1).plan.after, /用户已在本机启用自动精选沉淀/);
  assert.doesNotMatch(modals.at(-1).plan.after, /不得自动保存/);
  assert.equal(plugin.settings.autoSave, true);
  plugin.openMaintenance(); await settle();
  assert.equal(await app.vault.adapter.exists('schema/维护/AI Box维护.json'), false, '打开维护面板不创建计划或定时任务');
  buttons.filter(b => b.text === '保存维护计划').at(-1).click(); await settle();
  const maintenanceFile = path.join(root, 'schema/维护/AI Box维护.json');
  const maintenance = JSON.parse(await fs.readFile(maintenanceFile, 'utf8'));
  assert.equal(maintenance.jobs.weekly.day, 1);
  assert.equal(maintenance.jobs.inbox.automationId, '');
  assert.equal(maintenance.jobs.inbox.lastSuccess, undefined, '保存计划不伪造成功');
  plugin.openMaintenance(); await settle();
  maintenance.extra = 'externally changed';
  const concurrent = JSON.stringify(maintenance);
  await fs.writeFile(maintenanceFile, concurrent);
  buttons.filter(b => b.text === '保存维护计划').at(-1).click(); await settle();
  assert.equal(await fs.readFile(maintenanceFile, 'utf8'), concurrent, '并发修改拒绝覆盖');
  assert.match(notices.pop() ?? '', /已变化/);
  assert.equal(notices.filter(n => n.includes('AI Box：')).length, 0, notices.join('\n'));
});
