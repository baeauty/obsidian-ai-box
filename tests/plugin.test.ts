import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('插件 API 集成：启动、设置、初始化预览与应用、只读接入、备份撤销', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-box-plugin-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'test-vault');
  await fs.mkdir(root);
  const notices: string[] = [];
  const modals: any[] = [];
  const buttons: any[] = [];
  const settings: any[] = [];
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
    constructor(el: any) { settings.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc() { return this; }
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
      const toggle: any = { setValue() { return this; }, onChange() { return this; } }; fn(toggle); return this;
    }
  }
  class PluginSettingTab {
    containerEl = new Element();
    constructor(public app: any, plugin: any) {}
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
  plugin.tab.display();
  assert.equal(buttons.filter(b => b.text === '预览接入').length, 3);
  assert.equal(settings.filter(s => s.name === '自动精选沉淀').length, 1);
  plugin.previewInitialization(); await settle();
  assert.equal((await fs.readdir(root)).length, 0, '仅预览不写入');
  buttons.filter(b => b.text === '应用').at(-1).click(); await settle();
  assert.ok(entries.get('SCHEMA.md') instanceof TFile);
  const target = path.join(dir, '.dsh', 'AGENTS.md');
  plugin.settings.targets.dsh = target;
  plugin.previewAgent('dsh', 'connect'); await settle();
  await assert.rejects(fs.stat(target));
  buttons.filter(b => b.text === '备份并应用').at(-1).click(); await settle();
  assert.match(await fs.readFile(target, 'utf8'), /不得自动保存/);
  assert.ok(plugin.settings.receipts.dsh);
  plugin.previewAgent('dsh', 'rollback'); await settle();
  buttons.filter(b => b.text === '备份并应用').at(-1).click(); await settle();
  await assert.rejects(fs.stat(target));
  await plugin.checkAgent('dsh');
  await plugin.checkVault();
  await plugin.openGuide();
  assert.ok(entries.get('schema/AI Box 接入验收.md') instanceof TFile);
  assert.equal(notices.filter(n => n.includes('AI Box：')).length, 0, notices.join('\n'));
});
