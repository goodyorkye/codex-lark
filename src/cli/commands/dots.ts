import { dirname, join, resolve } from 'node:path';
import { resolveAppPaths } from '../../config/app-paths';
import { loadRootConfig, readActiveProfile } from '../../config/profile-store';
import { initializeDots, loadDotsConfig } from '../../dots/storage';

async function resolveDotsProfile(opts: { profile?: string; config?: string }) {
  const configPath = opts.config ? resolve(opts.config) : resolveAppPaths().configFile;
  const rootDir = dirname(configPath);
  const root = await loadRootConfig(configPath);
  if (!root) throw new Error('Configure your Feishu bot with codex-lark before enabling Dots');
  const profile = opts.profile ?? await readActiveProfile(rootDir) ?? root.activeProfile;
  const profileConfig = root.profiles[profile];
  if (!profileConfig) throw new Error('Dots profile was not found');
  return { profileConfig, appPaths: resolveAppPaths({ rootDir, profile }) };
}

export async function runDotsInit(opts: { profile?: string; config?: string }): Promise<void> {
  const runtime = await resolveDotsProfile(opts);
  if (runtime.profileConfig.agentKind !== 'codex') throw new Error('Dots switching currently requires a Codex profile');
  await initializeDots(join(runtime.appPaths.profileDir, 'dots'), runtime.profileConfig.accounts.app.id);
  console.log('Dots 原会话直连已启用（实验）。重启 codex-lark 后，在本人飞书私聊点“切换到 Dots”。\n\n复用本机已登录 ChatGPT 客户端的登录态，文字、图片、文件与语音进入原 Dot 会话，无需 Tunnel、自定义 MCP 插件或配对码。语音转写可选配置 DASHSCOPE_API_KEY；未配置时会在飞书提示。生成语音由 Dot 或其他工具负责，codex-lark 不提供 TTS。\n完整步骤见 docs/DOTS.md。');
}
export async function runDotsStatus(opts: { profile?: string; config?: string }): Promise<void> {
  const runtime = await resolveDotsProfile(opts);
  const config = await loadDotsConfig(join(runtime.appPaths.profileDir, 'dots'), runtime.profileConfig.accounts.app.id);
  console.log(config ? `Dots 后端：本机 ChatGPT 原会话直连（实验）。\n阿里云语音识别：${process.env.DASHSCOPE_API_KEY?.trim() ? '已配置环境变量' : '未配置 DASHSCOPE_API_KEY'}。\n实时连接与收件状态请在飞书点击“连接状态”。` : 'Dots 尚未启用。运行 codex-lark dots init。');
}
