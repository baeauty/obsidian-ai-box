import { App, FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type SettingDefinitionItem } from 'obsidian';
import { AGENTS, defaultTarget, type AgentId } from './instructions';
import { applyPlan, inspectTarget, makePlan, rollbackPlan, type Plan } from './bridge';
import { initializeVault, templateFiles } from './templates';
import { parseSettings, type Settings } from './validation';

export default class AIBoxPlugin extends Plugin {
  settings: Settings = { autoSave: false, targets: {}, receipts: {} };
  busy = false;
  settingsTab?: AIBoxSettings;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = parseSettings(saved);
    this.settingsTab = new AIBoxSettings(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: 'initialize-vault', name: '创建或补齐知识库结构', callback: () => this.previewInitialization() });
    this.addCommand({ id: 'check-vault', name: '检查知识库结构', callback: () => { void this.run(() => this.checkVault()); } });
    this.addRibbonIcon('library', 'AI Box：知识库接入', () => new WelcomeModal(this.app, this).open());
  }

  root(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('第一版仅支持桌面本地文件夹知识库。');
    return adapter.getBasePath();
  }

  target(id: AgentId): string { return this.settings.targets[id]?.trim() || defaultTarget(id); }
  async save(): Promise<void> { await this.saveData(this.settings); }

  async run(work: () => Promise<void>): Promise<void> {
    if (this.busy) { new Notice('AI Box 正在处理上一项操作。'); return; }
    this.busy = true;
    try { await work(); }
    catch (error) { new Notice(`AI Box：${error instanceof Error ? error.message : String(error)}`, 12000); }
    finally { this.busy = false; }
  }

  async ready(): Promise<void> {
    for (const file of ['SCHEMA.md', 'wiki/index.md', 'schema/规则/自动知识库规则.md']) {
      if (!(this.app.vault.getAbstractFileByPath(file) instanceof TFile)) throw new Error(`缺少入口文件 ${file}。请补齐该入口后再接入；已有知识库不需要重建。`);
    }
  }

  previewInitialization(): void {
    void this.run(async () => {
      this.root();
      const missing = Object.keys(templateFiles()).filter(file => !this.app.vault.getAbstractFileByPath(file));
      new ConfirmModal(this.app, '创建或补齐知识库结构', [
        `位置：${this.root()}`,
        `将补充 ${missing.length} 个缺失模板文件。已有文件保持原样；不会清空、重建、导入其他电脑的笔记或创建定时任务。`,
        '已有知识库可取消此操作，直接在 工具 接入区域预览接入。接入操作不会调用这里的模板创建。',
        ...missing,
      ].join('\n'), async () => {
        const result = await initializeVault({
          exists: async file => await this.app.vault.adapter.exists(file),
          mkdir: async folder => { await this.app.vault.createFolder(folder); },
          create: async (file, text) => { await this.app.vault.create(file, text); },
        });
        new Notice(`已创建 ${result.created.length} 个文件，保留 ${result.skipped.length} 个已有文件。`, 8000);
      }, this).open();
    });
  }

  previewAgent(id: AgentId, action: 'connect' | 'disconnect' | 'rollback'): void {
    void this.run(async () => {
      const root = this.root();
      if (action === 'connect') await this.ready();
      let plan: Plan;
      if (action === 'rollback') {
        const receipt = this.settings.receipts[id];
        if (!receipt) throw new Error('没有可恢复的本机操作记录。');
        plan = await rollbackPlan(id, receipt, root);
      } else plan = await makePlan(id, this.target(id), root, this.settings.autoSave, action === 'disconnect');
      new PlanModal(this.app, plan, this).open();
    });
  }

  async checkVault(): Promise<void> {
    const missing: string[] = [];
    for (const file of Object.keys(templateFiles())) {
      if (!(this.app.vault.getAbstractFileByPath(file) instanceof TFile)) missing.push(file);
    }
    new ReportModal(this.app, '知识库结构检查', [
      `位置：${this.root()}`,
      missing.length ? `缺少 ${missing.length} 个模板文件（现有库也可以使用自己的模板）：\n${missing.join('\n')}` : '模板文件齐全。',
      '这只是文件存在性检查，不代表内容质量或 工具 行为已通过验收。',
    ].join('\n\n')).open();
  }

  async checkAgent(id: AgentId): Promise<void> {
    const result = await inspectTarget(id, this.target(id), this.root());
    new ReportModal(this.app, 'Agent 接入检查', [this.target(id), ...result,
      '入口不授予权限；如被沙箱拦截，按该工具机制配置当前库的访问权限。',
      '如果使用 CC Switch 等配置管理器，请核对其是否会覆盖此文件；本插件不修改配置管理器数据库。',
    ].join('\n\n')).open();
  }

  async openGuide(): Promise<void> {
    const file = 'schema/AI Box 接入验收.md';
    if (!await this.app.vault.adapter.exists(file)) {
      if (!await this.app.vault.adapter.exists('schema')) await this.app.vault.createFolder('schema');
      await this.app.vault.create(file, `# AI Box 接入验收\n\n状态：未验收。请按实际结果更新，不以配置写入成功替代行为验证。\n\n## 1. 权限\nAgent 的规则入口不扩大文件权限。若不能读取或写入当前库，按工具支持的机制授权此目录，不关闭沙箱。\n\n## 2. 新会话检索\n在知识库外的项目目录启动新会话，请它“检查个人知识库的结构，并说明实际读取了哪些入口，先不要修改”。确认真实文件读取成功。\n\n## 3. 精选写回\n启用自动精选沉淀并重新应用入口后，在新会话中说明：“这是虚构的长期回归演练：松果卡片 SG-n 按 n×2+7 计算，其他前缀不套用，仅用于测试。”让 工具 完成 SG-5。检查是否精选保存为明确标注测试用途的流程，以及索引、日志是否同步更新。若只启用检索，则应不自动保存。\n\n## 4. 另一新会话复用\n不重复算法，仅请求：“按松果卡片演练处理 SG-9 和 XY-9。”预期通过实际检索得到 25、待核查；猜对数字但未检索不算通过。\n\n## 5. 跨工具与重启\n如接入多个 Agent，换另一个新会话重复步骤4。关闭 Obsidian 后仍应能直接使用知识文件。\n\n## 验收记录\n- 日期 / 工具版本：\n- 全局入口与权限配置：\n- 实际读取证据：\n- 写回及索引日志：\n- 新会话 / 跨工具复用：\n- 未通过与下一步：\n\n完成后可移除测试笔记并维护索引，保留必要验收结果。\n`);
    }
    const found = this.app.vault.getAbstractFileByPath(file);
    if (found instanceof TFile) await this.app.workspace.getLeaf(false).openFile(found);
  }
}

class AIBoxSettings extends PluginSettingTab {
  constructor(app: App, private plugin: AIBoxPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ name: '知识库与工具接入', aliases: ['DSH', 'Claude Code', 'Codex', '全局规则', '模板', '备份', '自动沉淀'], render: setting => this.renderSettings(setting.settingEl) }];
  }
  private renderSettings(el: HTMLElement): void {
    el.empty(); el.addClass('ai-box-settings');
    new Setting(el).setName('本地知识库').setHeading();
    el.createEl('p', { text: '已有知识库可直接在下方接入工具，无需重新初始化。只有新建空库或明确需要补充模板时，才使用结构创建功能。' });
    el.createEl('p', { text: `当前知识库：${this.plugin.root()}`, cls: 'ai-box-path' });
    new Setting(el).setName('新建空库 / 补齐模板').setDesc('可选操作，与 工具 接入独立。只补充缺失模板，不覆盖、清空或重建当前库。')
      .addButton(b => b.setButtonText('预览补齐模板').onClick(() => this.plugin.previewInitialization()))
      .addButton(b => b.setButtonText('检查结构').onClick(() => { void this.plugin.run(() => this.plugin.checkVault()); }));
    new Setting(el).setName('自动精选沉淀').setDesc('允许 工具 在自身权限内保存有价值的新经验。关闭时只检索；切换后需要重新应用各工具入口。')
      .addToggle(t => t.setValue(this.plugin.settings.autoSave).onChange(async value => {
        this.plugin.settings.autoSave = value; await this.plugin.save();
        new Notice('设置已保存，请重新应用需要更新的 工具 入口。');
      }));
    new Setting(el).setName('工具接入').setHeading();
    el.createEl('p', { text: '每个 工具 的全局入口同一时间绑定一个库。接入另一个库会在预览中提示；不修改模型、凭据或沙箱配置。' });
    for (const agent of AGENTS) {
      const section = el.createDiv({ cls: 'ai-box-agent' });
      new Setting(section).setName(agent.label).setDesc(`全局规则文件；默认识别 ${agent.env}，也可填写该工具实际使用的绝对路径。`)
        .addText(t => t.setPlaceholder(defaultTarget(agent.id)).setValue(this.plugin.settings.targets[agent.id] ?? '')
          .onChange(async value => { this.plugin.settings.targets[agent.id] = value; await this.plugin.save(); }));
      new Setting(section).setName('入口操作').setDesc(this.plugin.target(agent.id))
        .addButton(b => b.setButtonText('预览接入').setCta().onClick(() => this.plugin.previewAgent(agent.id, 'connect')))
        .addButton(b => b.setButtonText('检查').onClick(() => { void this.plugin.run(() => this.plugin.checkAgent(agent.id)); }))
        .addButton(b => b.setButtonText('解除当前库').onClick(() => this.plugin.previewAgent(agent.id, 'disconnect')))
        .addButton(b => b.setButtonText('撤销上次操作').setDisabled(!this.plugin.settings.receipts[agent.id])
          .onClick(() => this.plugin.previewAgent(agent.id, 'rollback')));
    }
    new Setting(el).setName('新会话验收').setDesc('配置成功与实际行为分开检查。首次接入后在新会话验证检索、精选写回和复用。')
      .addButton(b => b.setButtonText('打开验收指南').onClick(() => { void this.plugin.run(() => this.plugin.openGuide()); }));
    el.createEl('p', { text: '备份保存在全局规则文件旁的 .ai-box-backups 中。卸载插件不会自动删除全局入口；需要时请先解除当前库。移动知识库后需重新应用入口。', cls: 'setting-item-description' });
  }
}

class ReportModal extends Modal {
  constructor(app: App, private heading: string, private report: string) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: this.heading });
    this.contentEl.createEl('pre', { text: this.report, cls: 'ai-box-report' });
  }
  onClose(): void { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
  constructor(app: App, private heading: string, private report: string, private apply: () => Promise<void>, private plugin: AIBoxPlugin) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: this.heading });
    this.contentEl.createEl('pre', { text: this.report, cls: 'ai-box-report' });
    new Setting(this.contentEl).addButton(b => b.setButtonText('取消').onClick(() => this.close()))
      .addButton(b => b.setButtonText('应用').setCta().onClick(() => {
        this.close(); void this.plugin.run(this.apply);
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class PlanModal extends Modal {
  constructor(app: App, private plan: Plan, private plugin: AIBoxPlugin) { super(app); }
  onOpen(): void {
    const el = this.contentEl;
    el.addClass('ai-box-preview');
    const labels = { connect: '接入', disconnect: '解除当前库', rollback: '撤销上次操作' };
    el.createEl('h2', { text: `预览：${labels[this.plan.action]}` });
    el.createEl('p', { text: `目标：${this.plan.target}`, cls: 'ai-box-path' });
    for (const warning of this.plan.warnings) el.createEl('p', { text: warning, cls: 'ai-box-warning' });
    el.createEl('p', { text: '应用前会保存原文件备份。仅变更 AI Box 管理的入口；撤销操作仅在文件未发生后续修改时恢复原快照。' });
    for (const [label, text] of [['修改前', this.plan.before], ['修改后', this.plan.after]]) {
      el.createEl('h3', { text: label ?? '' });
      const area = el.createEl('textarea', { cls: 'ai-box-source' });
      area.readOnly = true; area.value = text ?? '（文件不存在）';
      area.setAttribute('aria-label', label ?? '规则预览');
    }
    new Setting(el).addButton(b => b.setButtonText('取消').onClick(() => this.close()))
      .addButton(b => b.setButtonText('备份并应用').setCta().setDisabled(this.plan.before === this.plan.after).onClick(() => {
        this.close(); void this.plugin.run(async () => {
          const receipt = await applyPlan(this.plan);
          if (receipt) {
            this.plugin.settings.receipts[this.plan.agent] = receipt;
            await this.plugin.save();
            this.plugin.settingsTab?.update();
          }
          new Notice('入口已更新。请启动 工具 新会话并执行验收；文件访问权限仍由 工具 管理。', 10000);
        });
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class WelcomeModal extends Modal {
  constructor(app: App, private plugin: AIBoxPlugin) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'AI Box' });
    this.contentEl.createEl('p', { text: '已有库直接到“设置 → AI Box”选择 工具 并预览接入，不需要重新初始化。以下结构创建操作仅供空库或补充缺失模板使用。' });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('预览补齐模板').onClick(() => { this.close(); this.plugin.previewInitialization(); }))
      .addButton(b => b.setButtonText('检查结构').onClick(() => { this.close(); void this.plugin.run(() => this.plugin.checkVault()); }));
  }
  onClose(): void { this.contentEl.empty(); }
}
