import type { DotsBackend } from './backend';

export function dotsCard(bridge?: DotsBackend, scope?: string, selected = false): object {
  const status = bridge?.status();
  const mode = selected ? 'dots' : scope ? bridge?.mode(scope) : undefined;
  const connection = status?.connected ? '已连接本机 ChatGPT 的原 Dot 会话（实验）' : '等待本机 ChatGPT 登录或连接，请点“连接 Dots”重试。';
  const button = (label: string, cmd: string) => ({ tag: 'button', text: { tag: 'plain_text', content: label }, type: 'default',
    behaviors: [{ type: 'callback', value: { cmd } }] });
  return { schema: '2.0', header: { title: { tag: 'plain_text', content: mode === 'dots' ? '当前：Dots' : 'Dots 连接' }, template: 'blue' },
    body: { elements: [
      { tag: 'markdown', content: status
        ? `🤖 **${status.name.replace(/[\\*_\[\]<>`]/g, '')}**\n\n${connection}\n\n文字、图片、文件进入 ChatGPT 原会话。\n语音：${status.speechTranscription === 'aliyun' ? '阿里云转写并保留原音频' : '未配置 DASHSCOPE_API_KEY，发送时会提示配置'}\n\n待回复：${status.pending} · 待核对：${status.uncertain} · 投递失败：${status.failed}${status.uncertain ? '\n请先在客户端及飞书核对；核对后可发送 /dots disconnect，再重新连接继续。旧消息不会重发。' : ''}${status.lastError ? `\n\n最近投递状态：${status.lastError}` : ''}\n\nCodex 的项目和任务已保留。`
        : '尚未启用 Dots。请在电脑上运行 `codex-lark dots init`，然后重启 codex-lark。' },
      { tag: 'column_set', columns: [{ tag: 'column', width: 'weighted', weight: 1, elements: [
        ...(mode === 'dots' && status?.connected ? [] : [button(status?.connected ? '切换到 Dots' : '连接 Dots', status?.connected ? 'dots.use' : 'dots.connect')]),
        button('返回 Codex', 'codex'), button('连接状态', 'dots.status'),
      ] }] },
    ] } };
}
