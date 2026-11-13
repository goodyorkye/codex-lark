import { request } from 'node:https';

export class AliyunAsrError extends Error {}
export function aliyunAsrHelp(): string {
  return '尚未配置阿里云语音识别，这条语音尚未转交给 Dots。\n\n请在运行 codex-lark 的电脑上配置阿里云百炼 API Key：环境变量 DASHSCOPE_API_KEY（北京地域），然后重启 codex-lark 并重发语音。已有同名环境变量可直接复用，无需安装 Python 或下载模型。\n\n不要把 Key 发到飞书聊天；现在也可以改发文字。获取 Key：https://help.aliyun.com/zh/model-studio/get-api-key';
}
function settings(env: NodeJS.ProcessEnv): { key: string; host: string } {
  const key = env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new AliyunAsrError(aliyunAsrHelp());
  const region = env.CODEX_LARK_DOTS_ASR_REGION ?? 'cn-beijing', workspace = env.CODEX_LARK_DOTS_ASR_WORKSPACE?.trim();
  if (!['cn-beijing', 'ap-southeast-1'].includes(region) || workspace && !/^[A-Za-z0-9-]{1,80}$/.test(workspace)) throw new AliyunAsrError('阿里云 ASR 地域或业务空间配置无效，请核对 CODEX_LARK_DOTS_ASR_REGION / CODEX_LARK_DOTS_ASR_WORKSPACE。');
  return { key, host: workspace ? `${workspace}.${region}.maas.aliyuncs.com` : region === 'cn-beijing' ? 'dashscope.aliyuncs.com' : 'dashscope-intl.aliyuncs.com' };
}
export interface NativeAudioTranscriber {
  configured(): boolean;
  check(): void;
  transcribe(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<string>;
}
/** Direct, bounded HTTPS to Aliyun. No SDK, subprocess, public file hosting or persisted key. */
export function aliyunAsr(env: NodeJS.ProcessEnv = process.env): NativeAudioTranscriber {
  return {
    configured: () => Boolean(env.DASHSCOPE_API_KEY?.trim()),
    check: () => { settings(env); },
    async transcribe(bytes, mimeType, signal) {
      const { key, host } = settings(env);
      if (!bytes.length || bytes.length > 6 * 1024 * 1024 || !/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) throw new AliyunAsrError('语音识别支持非空音频，原文件最多 6 MiB、时长最多 5 分钟，请缩短后重新发送。');
      const body = JSON.stringify({ model: 'qwen3-asr-flash', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mimeType};base64,${bytes.toString('base64')}` } }] }], stream: false, asr_options: { enable_itn: true } });
      return new Promise<string>((resolve, reject) => {
        const req = request(`https://${host}/compatible-mode/v1/chat/completions`, { method: 'POST', signal, agent: false,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' } }, res => {
          if (res.statusCode !== 200) {
            res.resume();
            const status = res.statusCode ?? 0;
            reject(new AliyunAsrError(status === 401 || status === 403 ? '阿里云语音识别鉴权失败，请检查 DASHSCOPE_API_KEY、地域与模型权限，然后重发语音。' : status === 429 ? '阿里云语音识别额度不足或请求过多，请检查用量或稍后重发语音。' : `阿里云语音识别失败（HTTP ${status}），请检查音频格式、额度及网络后重试。`)); return;
          }
          let size = 0; const parts: Buffer[] = [];
          res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) { res.destroy(); reject(new AliyunAsrError('阿里云识别结果过长，请缩短语音后重发。')); } else parts.push(chunk); });
          res.on('error', () => reject(new AliyunAsrError('阿里云语音识别连接中断，请重发语音。')));
          res.on('end', () => {
            try {
              const result = JSON.parse(Buffer.concat(parts).toString('utf8')), text = result.choices?.[0]?.message?.content;
              if (typeof text !== 'string' || !text.trim() || text.length > 16_000) throw new Error();
              resolve(text.trim());
            } catch { reject(new AliyunAsrError('阿里云未返回可用转写文字，请确认音频有清晰语音，或改发文字。')); }
          });
        });
        const timer = setTimeout(() => req.destroy(), 90_000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => reject(new AliyunAsrError('阿里云语音识别连接失败或超时，请检查网络后重发语音。')));
        req.end(body);
      });
    },
  };
}
