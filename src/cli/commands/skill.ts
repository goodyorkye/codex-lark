import {
  CODEX_LARK_NOTIFY_SKILL,
  ensureCodexLarkNotifySkill,
  inspectCodexLarkNotifySkill,
  removeCodexLarkNotifySkill,
  type ManagedSkillInstallResult,
} from '../../skills/codex-lark-notify';

export async function installCodexLarkNotifySkillOnStartup(): Promise<void> {
  try {
    const result = await ensureCodexLarkNotifySkill();
    if (result.action === 'installed') {
      console.log(`✓ 已安装 Codex 技能：${CODEX_LARK_NOTIFY_SKILL}`);
    } else if (result.action === 'updated') {
      console.log(`✓ 已更新 Codex 技能：${CODEX_LARK_NOTIFY_SKILL}`);
    } else if (result.action === 'preserved') {
      console.warn(startupPreservedMessage(result));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`⚠ 无法自动安装 Codex 技能（不影响飞书连接）：${detail}`);
  }
}

export async function runSkillInstall(): Promise<void> {
  const result = await ensureCodexLarkNotifySkill();
  if (result.action === 'installed') {
    console.log(`Installed ${CODEX_LARK_NOTIFY_SKILL} at ${result.targetDir}`);
    return;
  }
  if (result.action === 'updated') {
    console.log(`Updated ${CODEX_LARK_NOTIFY_SKILL} at ${result.targetDir}`);
    return;
  }
  if (result.action === 'unchanged') {
    console.log(`${CODEX_LARK_NOTIFY_SKILL} is current at ${result.targetDir}`);
    return;
  }
  throw new Error(preservedReason(result));
}

export async function runSkillStatus(): Promise<void> {
  const status = await inspectCodexLarkNotifySkill();
  console.log(`${CODEX_LARK_NOTIFY_SKILL}: ${status.state}\n${status.targetDir}`);
}

export async function runSkillRemove(): Promise<void> {
  const result = await removeCodexLarkNotifySkill();
  if (result.action === 'removed') {
    console.log(`Removed ${CODEX_LARK_NOTIFY_SKILL} from ${result.targetDir}`);
    return;
  }
  if (result.action === 'unchanged') {
    console.log(`${CODEX_LARK_NOTIFY_SKILL} is not installed at ${result.targetDir}`);
    return;
  }
  throw new Error(preservedReason(result));
}

function startupPreservedMessage(result: ManagedSkillInstallResult): string {
  return `⚠ 未自动更新 Codex 技能：${preservedReason(result)}（不影响飞书连接）`;
}

function preservedReason(result: Pick<ManagedSkillInstallResult, 'state' | 'targetDir'>): string {
  if (result.state === 'modified') {
    return `${result.targetDir} contains user changes`;
  }
  return `${result.targetDir} already exists and is not managed by codex-lark`;
}
