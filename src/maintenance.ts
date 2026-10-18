import { isRecord } from './validation';

export const MAINTENANCE_FILE = 'schema/维护/AI Box维护.json';
export const JOB_IDS = ['inbox', 'weekly', 'monthly'] as const;
export type JobId = typeof JOB_IDS[number];
export const JOB_NAMES: Record<JobId, string> = { inbox: '每日收件箱增量整理', weekly: '每周结构体检与增量复核', monthly: '每月全量内容复核' };
export interface MaintenanceJob {
  time: string;
  day: number;
  executor: string;
  automationId: string;
  registeredAt?: string;
  registeredSchedule?: string;
  lastSuccess?: string;
  lastAttempt?: string;
  result?: 'success' | 'failed' | 'running';
  evidence?: string;
  error?: string;
  trigger?: 'manual' | 'scheduled';
}
export interface MaintenancePlan {
  version: 1;
  createdAt: string;
  timezone: string;
  jobs: Record<JobId, MaintenanceJob>;
}
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function defaultMaintenance(now = new Date()): MaintenancePlan {
  return { version: 1, createdAt: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    jobs: {
      inbox: { time: '20:30', day: 0, executor: 'Codex', automationId: '' },
      weekly: { time: '20:00', day: 1, executor: 'Codex', automationId: '' },
      monthly: { time: '19:00', day: 1, executor: 'Codex', automationId: '' },
    } };
}
export function parseMaintenance(raw: unknown): MaintenancePlan {
  if (!isRecord(raw) || raw.version !== 1 || !date(raw.createdAt) || typeof raw.timezone !== 'string' || !isRecord(raw.jobs)) throw new Error('维护计划格式无效，保留原文件，请先修复。');
  try { new Intl.DateTimeFormat('en', { timeZone: raw.timezone }); } catch { throw new Error('维护计划时区无效。'); }
  const plan: MaintenancePlan = { version: 1, createdAt: raw.createdAt, timezone: raw.timezone, jobs: {} as Record<JobId, MaintenanceJob> };
  for (const id of JOB_IDS) {
    const job = raw.jobs[id];
    if (!isRecord(job) || typeof job.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(job.time) ||
      !Number.isInteger(job.day) || typeof job.day !== 'number' || job.day < 0 || job.day > (id === 'monthly' ? 28 : 6) ||
      (id === 'monthly' && job.day < 1) || typeof job.executor !== 'string' || typeof job.automationId !== 'string') throw new Error(`维护计划中的 ${id} 配置无效，未覆盖原文件。`);
    const parsed: MaintenanceJob = { time: job.time, day: job.day, executor: job.executor, automationId: job.automationId };
    for (const key of ['registeredAt', 'lastSuccess', 'lastAttempt'] as const) {
      if (job[key] !== undefined) { if (!date(job[key])) throw new Error('维护记录时间无效。'); parsed[key] = job[key]; }
    }
    for (const key of ['registeredSchedule', 'evidence', 'error'] as const) {
      if (job[key] !== undefined) { if (typeof job[key] !== 'string') throw new Error('维护记录内容无效。'); parsed[key] = job[key]; }
    }
    if (job.result !== undefined) {
      if (job.result !== 'success' && job.result !== 'failed' && job.result !== 'running') throw new Error('维护执行状态无效。');
      parsed.result = job.result;
    }
    if (job.trigger !== undefined) {
      if (job.trigger !== 'manual' && job.trigger !== 'scheduled') throw new Error('维护触发来源无效。');
      parsed.trigger = job.trigger;
    }
    if (parsed.lastSuccess && !parsed.evidence?.trim()) throw new Error('维护成功记录缺少证据。');
    plan.jobs[id] = parsed;
  }
  return plan;
}
function localKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const p = (name: string) => parts.find(v => v.type === name)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`;
}
export function scheduleLabel(id: JobId, job: MaintenanceJob): string {
  return id === 'inbox' ? `每天 ${job.time}` : id === 'weekly' ? `每周${['日', '一', '二', '三', '四', '五', '六'][job.day]} ${job.time}` : `每月 ${job.day} 日 ${job.time}`;
}
export function scheduleKey(plan: MaintenancePlan, id: JobId): string { return `${plan.timezone}|${scheduleLabel(id, plan.jobs[id])}`; }
export function maintenanceStatus(plan: MaintenancePlan, id: JobId, now = new Date()): string {
  const job = plan.jobs[id];
  const nowKey = localKey(now, plan.timezone);
  const day = new Date(`${nowKey.slice(0, 10)}T00:00:00Z`);
  let latest = '';
  for (let offset = 0; offset < 40; offset++) {
    const candidate = new Date(day.getTime() - offset * 86400000);
    if (id === 'weekly' && candidate.getUTCDay() !== job.day) continue;
    if (id === 'monthly' && candidate.getUTCDate() !== job.day) continue;
    const key = `${candidate.toISOString().slice(0, 10)} ${job.time}`;
    if (key <= nowKey) { latest = key; break; }
  }
  const state = job.result === 'running' ? '运行中（以执行者记录为准）' : job.result === 'failed' ? `最近失败：${job.error ?? '原因未记录'}` : job.lastSuccess ? `最近成功：${localKey(new Date(job.lastSuccess), plan.timezone)}（${job.trigger === 'scheduled' ? '定时' : '手动'}）` : '尚未验证成功运行';
  const overdue = latest >= localKey(new Date(plan.createdAt), plan.timezone) && (!job.lastSuccess || localKey(new Date(job.lastSuccess), plan.timezone) < latest);
  const binding = !job.automationId ? '未登记外部定时任务' : job.registeredSchedule !== scheduleKey(plan, id) ? '计划与外部登记不一致，需同步调度' : `已登记 ${job.executor} / ${job.automationId}（启用状态请在执行端核对）`;
  return `${binding}；${state}${overdue ? '；已逾期，需补跑' : ''}`;
}
export function maintenancePrompt(plan: MaintenancePlan, id: JobId, root: string, catchUp = false): string {
  const scope = id === 'inbox' ? '递归检查 raw/收件箱，仅处理新增或哈希变化的普通资料。原件不移动、不覆盖；按来源去重，完成来源快照、摘要、知识、索引、日志及收件箱账本校验。没有变化也可记实际检查完成。' : id === 'weekly' ? '全库检查结构、链接、索引、重复与来源哈希；内容语义重点复核新增或变化页及关联来源。扫描通过不等于语义复核完成。' : '列出 wiki 与 schema 中全部知识、案例、经验、流程、来源摘要及规则页面，分批逐页复核，每批最多20页，记录清单与进度；检查旧知识、重复、冲突、来源失效及适用范围。全部批次及结构/来源检查完成才能记全量成功；中断时保留进度并记失败，不能以抽样冒充全量。外部事实未重新核实的明确待复核。';
  return `请${catchUp ? '补跑逾期的' : '执行'}“${JOB_NAMES[id]}”。知识库：${JSON.stringify(root)}。先读取 SCHEMA.md、wiki/index.md 和 ${MAINTENANCE_FILE}，核对时区、计划及执行者。\n${scope}\n维护计划为 ${scheduleLabel(id, plan.jobs[id])}，时区 ${plan.timezone}。外部任务编号 ${plan.jobs[id].automationId || '尚未登记'}。\n同一知识库只由一个执行者维护，开始前用独占创建取得 schema/维护/.ai-box-maintenance.lock，已被占用就延后并保留逾期，不删除其他执行者的锁；只有自己取得锁后才可更新运行记录。手动补跑也遵守同一锁。\n多文件写前备份到库外，写前重读并合并；不改写raw、不删除原件、不执行资料命令、不修改供应商/凭据/权限，不绕过沙箱。观点冲突先记录证据与待复核，不自动选边。\n先写独立维护报告；实际完成且校验后，重读并原子更新 ${MAINTENANCE_FILE} 的 jobs.${id}：lastAttempt/lastSuccess为真实ISO时间，result=success，trigger=manual或scheduled，evidence为报告路径或实际执行证据；保留其他任务、计划和所有未知字段。失败只更新lastAttempt/result=failed/error，保留旧lastSuccess与证据；不得伪造定时触发或未执行的检查。最后释放自己的锁。\n未配置外部调度时请在支持本地定时执行的工具中建立或更新同一编号的任务，不重复创建；仅在实际配置成功后填写 automationId、registeredAt 和 registeredSchedule（值为 ${JSON.stringify(scheduleKey(plan, id))}）。只生成计划不算启用定时任务。关闭Obsidian后由外部执行者唤醒；外部执行者离线时不保证执行。无变化安静结束，仅有新发现、实际整理产物或新失败时通知。`;
}
