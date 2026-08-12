import * as p from '@clack/prompts';
import type { RegistrationProgress } from '../bot/wizard';

export type TerminalPhase = 'loading' | 'checking' | 'connecting' | 'online';

/** Small foreground UI used by `npx codex-lark` and `codex-lark run`. */
export class TerminalUi {
  readonly registrationProgress: RegistrationProgress;

  private readonly interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  private readonly activity = p.spinner();
  private spinning = false;
  private online = false;

  constructor() {
    this.registrationProgress = {
      onQRCodeReady: () => {
        if (!this.interactive) return;
        this.stopSpinner('请用飞书扫描下面的二维码');
      },
      onStatusChange: ({ status }) => {
        if (!this.interactive || status === 'slow_down' || status === 'domain_switched') return;
        this.startSpinner('扫码已确认，正在创建飞书助手…');
      },
    };
  }

  start(): void {
    if (!this.interactive) {
      console.log('Codex Lark 正在启动');
      return;
    }
    p.intro('Codex Lark · 飞书遥控 Codex Desktop');
    this.startSpinner('正在读取本机配置…');
  }

  status(phase: TerminalPhase, detail?: string): void {
    const message = detail ?? phaseLabel(phase);
    if (!this.interactive) {
      console.log(`${phase === 'online' ? '✓' : '•'} ${message}`);
      return;
    }
    if (phase !== 'online') {
      this.startSpinner(message);
      return;
    }

    this.online = true;
    this.stopSpinner(message);
    p.note(
      [
        '飞书消息会直接续接 Mac 上的 Codex 任务',
        '保持这个终端窗口打开',
        '按 Ctrl+C 停止',
      ].join('\n'),
      '运行状态',
    );
  }

  fail(error: unknown): void {
    if (!this.interactive || this.online) return;
    const message = error instanceof Error ? error.message : String(error);
    if (this.spinning) {
      this.activity.error(message);
      this.spinning = false;
    } else {
      p.log.error(message);
    }
  }

  private startSpinner(message: string): void {
    if (this.spinning) {
      this.activity.message(message);
      return;
    }
    this.activity.start(message);
    this.spinning = true;
  }

  private stopSpinner(message: string): void {
    if (!this.spinning) return;
    this.activity.stop(message);
    this.spinning = false;
  }
}

function phaseLabel(phase: TerminalPhase): string {
  if (phase === 'loading') return '正在读取本机配置…';
  if (phase === 'checking') return '正在检查 Codex Desktop…';
  if (phase === 'connecting') return '正在连接飞书…';
  return '飞书助手已在线';
}
