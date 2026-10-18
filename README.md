# AI Box · Obsidian 本地知识库接入

Create a local knowledge base and connect DeepSeek Harness, Claude Code, and Codex through their global instruction files. Desktop only. Existing notes are preserved; connecting an agent does not initialize the vault.

Requires Obsidian 1.13.0 or later. The settings page uses Obsidian's searchable settings definitions.

License: [MIT](LICENSE). Maintainer: [baeauty](https://github.com/baeauty).

## Privacy and external file access

AI Box makes no network requests, calls no model APIs, and collects no telemetry. It does not require an account or payment. Separately installed agents may have their own account, network, and payment requirements.

After you review a local preview and choose Apply, AI Box writes a marked instruction block to the selected agent's **global instruction file outside the vault**. This makes the current vault discoverable from other project directories. It stores the original file and rollback metadata in `.ai-box-backups` beside that global instruction file. Local settings also retain your selected paths and operation receipts. These files are never uploaded by the plugin.

The plugin does not grant filesystem permissions, configure credentials, install agents, or change their model providers. Before uninstalling, use Disconnect if you want to remove the managed global instruction block. Disabling the Obsidian plugin alone leaves those instructions in place.

在 Obsidian 内初始化个人知识库，通过 Agent **全局规则文件**接入 DeepSeek Harness、Claude Code 和 Codex。Agent 使用自身文件工具直接读写知识库；不需要 MCP、模型 API Key 或常驻服务。

每台电脑可以从空库独立建立自己的知识库。不上传笔记，不同步电脑，不附带作者个人知识或账号配置。

## 第一版功能

- 当前库初始化：`raw / wiki / schema`、首页、导航、公共规则、来源与交接模板。只创建缺失文件，保留已有内容。
- DSH、Claude Code、Codex 全局入口：识别对应环境变量，可设置实际入口文件位置。
- 修改前预览完整文件、原文件备份、标记段合并、重复安装幂等。
- 检测改绑其他库、旧版 AI Box 标记、Codex 全局覆盖文件、预览后的文件变化。
- 解除当前库；入口未发生后续修改时，可撤销上次操作、恢复整个原文件。
- 自动精选沉淀默认关闭。启用后重新应用入口；只检索模式明确禁止未经本次要求自动写回。
- 结构与配置检查，以及真实新会话验收指南。配置完成不等于模型行为已验收。

## 安装

当前可通过 GitHub Release **手动安装**；社区市场条目提交后需完成官方审核，只有正式发布后才能在市场搜索安装。

1. 在 Obsidian 新建并打开空白库，或打开已有库。
2. 将发布包中的 `ai-box` 文件夹复制到当前库的 `.obsidian/plugins/`。最终应有 `.obsidian/plugins/ai-box/main.js`、`manifest.json`、`styles.css`。
3. 在 Obsidian 的“设置 → 第三方插件”中允许并启用 AI Box。必要时重启 Obsidian。
4. 已有知识库：直接跳到第5步，无需初始化。新建空库或确实需要补充模板时，打开“设置 → AI Box → 预览补齐模板”，核对后应用。
5. 按需开启“自动精选沉淀”。选择 Agent，核对全局规则文件路径，点击“预览接入 → 备份并应用”。
6. 新建 Agent 会话，按插件提供的“验收指南”验证实际检索、写回和跨会话复用。

当前库位置由插件读取，无需填知识库地址。移动库后需要重新应用入口。关闭 Obsidian 后，已接入 Agent 仍可直接使用本地知识文件。

**接入已有知识库不会重新初始化。**Agent 接入只检查 SCHEMA.md、wiki/index.md、schema/规则/自动知识库规则.md 三个入口是否存在，并修改库外的全局规则文件。缺入口时报告缺项并停止，不自动生成模板。插件启动也不自动创建或改写知识文件。可选的“补齐模板”是另一个操作，且始终保留已有文件。

已有库初始化时不会覆盖规则，可能与模板存在差异，请检查自己的 SCHEMA.md 和自动知识库规则。新电脑重复以上步骤即可独立建库。

## 接入机制与权限

| Agent | 默认入口 | 可识别的目录环境变量 |
| --- | --- | --- |
| DeepSeek Harness | `~/.dsh/AGENTS.md` | `DSH_HOME` |
| Claude Code | `~/.claude/CLAUDE.md` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/AGENTS.md` | `CODEX_HOME` |

插件只修改 `<!-- AI-BOX-KB:BEGIN -->` 到 `<!-- AI-BOX-KB:END -->` 的托管段，或者在没有托管段时追加；其他原文保留。一个全局入口同一时间绑定一个库，切换会在预览中提示。旧版同名标记会被迁移，原文先备份。

**规则入口不授予跨目录文件权限。**实际文件访问由各 Agent 的运行环境决定。插件不修改沙箱、供应商、凭据、Agent 权限文件或 CC Switch 数据库。若被拦截，请按工具官方机制授权当前库，并重新验收。仅写入全局入口不能声称“所有项目均可读写”。

Obsidian 从桌面启动时可能未继承终端环境变量。使用自定义配置目录、便携安装或配置管理器时，在插件中填写 Agent 实际使用的入口路径。非空 `AGENTS.override.md` 可能使 Codex 不加载默认全局入口；插件会提示但不改写覆盖文件。项目规则也可能影响行为。

## 备份、恢复与卸载

- 每次实际变更前，在目标规则文件旁的 `.ai-box-backups/<编号>.json` 保存原文件和恢复元数据。备份包含原有全局指令，仅保存在本机；请自行保管，不上传到公开仓库。
- “撤销上次操作”要求当前文件仍与该次操作结果完全一致；若后来被人工或其他工具修改，则拒绝整文件恢复，避免覆盖新内容。可使用解除当前库或手工合并备份。撤销本身也有备份，因此可撤销刚才的撤销。
- “解除当前库”只移除当前库的托管段，保留段外内容和知识文件。若入口已改绑别的库，当前库不能将其移除。
- **禁用或卸载 Obsidian 插件不会自动撤回全局指令。**卸载前按需解除各 Agent；之后可删除插件目录，保留知识文件。
- 多进程写入用锁串行化，写入前复核内容并原子替换。不能与不遵守锁的外部程序构成跨进程事务；尽量避免同时编辑同一入口。异常退出遗留 `.ai-box.lock` 时先核查无正在进行的操作，再手工处理。
- 第一版拒绝符号链接、目录联接和超过 2 MB 或无效 UTF-8 的规则文件，不猜测应当修改哪个实际目标。失败会提示具体原因。

## 开发与打包

需要 Node.js 22 或更高版本：

```sh
npm ci
npm test
npm run package
```

安装文件生成于 `dist/ai-box/`。将这三个文件打包后即可在其他电脑手动安装。

```sh
npm run dev
```

开发监听只重新构建，不会自动重载 Obsidian 插件。

## 验证边界

测试覆盖初始化与保留已有文件、三工具入口路径、标记合并、备份与撤销、并行锁、外部编辑冲突、不同库绑定、异常编码和符号链接拒绝。真实 Obsidian 加载、DSH 及其他 Agent 的新会话行为需按 `docs/验收.md` 实测。Windows 是本轮开发环境；其他桌面系统需额外实测。

第一版没有自动定时整理、语义搜索、聊天侧栏、模型调用或手机支持。插件升级不会在启动时自动改写用户规则；更换规则模板需显式预览和合并。

## 官方依据

- [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [DSH 全局规则加载](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Codex 全局指令](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

DSH 处于开发者预览阶段，升级后应重新验收全局规则机制。发布本插件不代表获得任何上游项目背书。
# Maintenance in 0.2.0

AI Box now provides a vault-owned maintenance dashboard under **Settings → AI Box → 维护计划与状态**. Save schedules, record the responsible tool and external task IDs, and inspect last-success evidence, failures, and overdue work. Defaults are daily incremental inbox processing at 20:30, Monday structure and incremental content review at 20:00, and monthly full content review on day 1 at 19:00, in the displayed timezone.

The plugin does not start background agents, call model APIs, or install external schedules. Saving a plan does not activate a timer. Use the generated instructions with a capable external scheduler, then record the actual task ID. External tools must run on an available computer with the required permissions. A shared maintenance lock prevents overlapping compliant workers. The optional `scripts/maintenance-runner.py` in this source repository records token-owned runs and validates report evidence; it does not perform semantic review. Run it with Python 3.10+.

Reports distinguish manual checks from scheduled execution. Monthly content review must cover every listed page in batches; a partial run is not recorded as complete. Editing a schedule marks the external registration as needing synchronization. The UI does not infer success from a task ID or pretend to monitor the external scheduler's enabled state. Malformed plans and concurrently changed records are preserved and reported.

Manual maintenance and catch-up buttons generate instructions for your tool; they do not silently launch it. Plans and worker reports live in `schema/维护/AI Box维护.json`, and disabling the plugin does not disable already-created external schedules.

