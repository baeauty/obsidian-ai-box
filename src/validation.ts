import type { AgentId } from './instructions';
import { AGENTS } from './instructions';
import type { Receipt } from './bridge';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface Settings {
  autoSave: boolean;
  targets: Partial<Record<AgentId, string>>;
  receipts: Partial<Record<AgentId, Receipt>>;
}

export function parseSettings(value: unknown): Settings {
  const settings: Settings = { autoSave: false, targets: {}, receipts: {} };
  if (!isRecord(value)) return settings;
  settings.autoSave = value.autoSave === true;
  for (const { id } of AGENTS) {
    if (isRecord(value.targets) && typeof value.targets[id] === 'string') settings.targets[id] = value.targets[id];
    const receipt = isRecord(value.receipts) ? value.receipts[id] : undefined;
    if (isRecord(receipt) && typeof receipt.target === 'string' && typeof receipt.backupId === 'string' &&
        typeof receipt.at === 'string' && typeof receipt.action === 'string') {
      settings.receipts[id] = { target: receipt.target, backupId: receipt.backupId, at: receipt.at, action: receipt.action };
    }
  }
  return settings;
}
