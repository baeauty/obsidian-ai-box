import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultMaintenance, maintenanceStatus, parseMaintenance, scheduleKey, maintenancePrompt } from '../src/maintenance';

test('维护计划按本库时区和日程判断逾期，不把登记误当执行成功', () => {
  const plan = defaultMaintenance(new Date('2026-10-18T07:00:00Z'));
  plan.timezone = 'Asia/Shanghai';
  assert.match(maintenanceStatus(plan, 'inbox', new Date('2026-10-18T12:29:00Z')), /尚未验证/);
  assert.doesNotMatch(maintenanceStatus(plan, 'inbox', new Date('2026-10-18T12:29:00Z')), /逾期/);
  assert.match(maintenanceStatus(plan, 'inbox', new Date('2026-10-18T12:30:00Z')), /逾期/);
  plan.jobs.inbox.automationId = 'example';
  plan.jobs.inbox.registeredSchedule = scheduleKey(plan, 'inbox');
  assert.match(maintenanceStatus(plan, 'inbox', new Date('2026-10-18T12:31:00Z')), /尚未验证/);
  plan.jobs.inbox.lastSuccess = '2026-10-18T12:31:00Z';
  plan.jobs.inbox.evidence = 'schema/维护/报告.md';
  assert.doesNotMatch(maintenanceStatus(plan, 'inbox', new Date('2026-10-18T12:32:00Z')), /逾期/);
  plan.jobs.inbox.time = '21:00';
  assert.match(maintenanceStatus(plan, 'inbox'), /需同步调度/);
  assert.match(maintenanceStatus(plan, 'weekly', new Date('2026-10-19T12:01:00Z')), /逾期/);
  assert.match(maintenanceStatus(plan, 'monthly', new Date('2026-11-01T11:01:00Z')), /逾期/);
});

test('损坏计划拒绝覆盖；成功记录必须有证据；指令不冒充已启用或已完成', () => {
  const plan = defaultMaintenance();
  assert.deepEqual(parseMaintenance(plan), plan);
  assert.throws(() => parseMaintenance({}), /无效/);
  plan.jobs.monthly.day = 31;
  assert.throws(() => parseMaintenance(plan), /无效/);
  plan.jobs.monthly.day = 1;
  plan.jobs.weekly.lastSuccess = new Date().toISOString();
  assert.throws(() => parseMaintenance(plan), /证据/);
  delete plan.jobs.weekly.lastSuccess;
  const prompt = maintenancePrompt(plan, 'monthly', 'example-vault', true);
  assert.match(prompt, /全部批次/);
  assert.match(prompt, /独占创建/);
  assert.match(prompt, /不重复创建/);
  assert.match(prompt, /只生成计划不算启用/);
});
