import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import QRCode from 'qrcode';
import { registerCodexLarkApp } from '../bot/wizard';
import { runStart } from '../cli/commands/start';
import { resolveAppPaths } from '../config/app-paths';
import { discoverDesktopBinary } from '../codex/desktop-binary';

type Phase =
  | 'starting'
  | 'scan'
  | 'authorizing'
  | 'checking'
  | 'connecting'
  | 'online'
  | 'error';

interface DashboardState {
  phase: Phase;
  title: string;
  detail: string;
  qrDataUrl?: string;
  registrationUrl?: string;
  expiresAt?: number;
  desktopApp?: string;
  updatedAt: number;
}

export interface DesktopDashboardOptions {
  openBrowser?: boolean;
  port?: number;
  host?: string;
}

/** Start the no-terminal macOS experience and keep running until stopped. */
export async function runDesktopDashboard(
  options: DesktopDashboardOptions = {},
): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const rootDir = resolveAppPaths({ profile: 'codex' }).rootDir;
  const locatorFile = join(rootDir, 'dashboard.json');
  const existing = await readLiveLocator(locatorFile);
  if (existing) {
    if (options.openBrowser !== false) openUrl(existing.url);
    console.log(`codex-lark 已在运行，控制面板：${existing.url}`);
    return;
  }
  const token = randomBytes(24).toString('base64url');
  let flowStarted = false;
  let state: DashboardState = status(
    'starting',
    '正在启动 codex-lark',
    '正在寻找 ChatGPT / Codex Desktop…',
  );

  const server = createServer((req, res) => {
    void route(req, res, token, () => state, (next) => { state = next; }, () => startFlow());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地控制面板');
  const pageUrl = `http://${host}:${address.port}/?token=${encodeURIComponent(token)}`;
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  await writeFile(
    locatorFile,
    `${JSON.stringify({ url: pageUrl, token, pid: process.pid })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  if (options.openBrowser !== false) openUrl(pageUrl);
  console.log(`codex-lark 控制面板：${pageUrl}`);

  const startFlow = async (): Promise<void> => {
    if (flowStarted) return;
    flowStarted = true;
    try {
      const desktop = await discoverDesktopBinary();
      state = {
        ...status('starting', '已找到 Codex Desktop', `正在使用 ${desktop.appName} 内置核心`),
        desktopApp: desktop.appName,
      };
      const paths = resolveAppPaths({ profile: 'codex' });
      const hasConfig = await fileExists(paths.configFile);
      let credentials: Awaited<ReturnType<typeof registerCodexLarkApp>> | undefined;
      if (!hasConfig) {
        credentials = await registerCodexLarkApp({
          onQRCodeReady: (info) => {
            void QRCode.toDataURL(info.url, {
              width: 300,
              margin: 1,
              errorCorrectionLevel: 'M',
            }).then((qrDataUrl) => {
              state = {
                ...status('scan', '请用飞书扫码', '只需这一次：扫码后会自动创建个人助手并连接。'),
                qrDataUrl,
                registrationUrl: info.url,
                expiresAt: Date.now() + info.expireIn * 1000,
                desktopApp: desktop.appName,
              };
            });
          },
          onStatusChange: (info) => {
            if (info.status === 'domain_switched') {
              state = {
                ...state,
                detail: '已识别为 Lark 国际版，正在切换服务地址…',
                updatedAt: Date.now(),
              };
            } else if (info.status !== 'slow_down') {
              state = {
                ...state,
                phase: 'authorizing',
                detail: '扫码已确认，正在完成飞书应用配置…',
                updatedAt: Date.now(),
              };
            }
          },
        });
      }

      state = {
        ...status('checking', '配置完成', '正在检查本机环境…'),
        desktopApp: desktop.appName,
      };
      const appSecret = credentials?.accounts.app.secret;
      if (appSecret !== undefined && typeof appSecret !== 'string') {
        throw new Error('扫码注册没有返回可用的 App Secret');
      }
      await runStart({
        profile: 'codex',
        agent: 'codex',
        skipCheckLarkCli: true,
        ...(credentials
          ? {
              appId: credentials.accounts.app.id,
              appSecret,
              tenant: credentials.accounts.app.tenant,
            }
          : {}),
        confirmStopRuntimeLockProcess: () => false,
        onStatus: (phase, detail) => {
          const mapped: Phase = phase === 'loading' ? 'checking' : phase;
          state = {
            ...status(
              mapped,
              mapped === 'online' ? 'codex-lark 已连接' : '正在连接',
              detail ?? '请稍候…',
            ),
            desktopApp: desktop.appName,
          };
        },
      });
    } catch (error) {
      flowStarted = false;
      state = status(
        'error',
        '暂时没能连接',
        friendlyError(error),
      );
    }
  };

  void startFlow();
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await removeOwnLocator(locatorFile);
}

interface DashboardLocator {
  url: string;
  token: string;
  pid: number;
}

async function readLiveLocator(path: string): Promise<DashboardLocator | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<DashboardLocator>;
    if (!parsed.url || !parsed.token || typeof parsed.pid !== 'number') throw new Error('invalid');
    const response = await fetch(`${parsed.url.split('?')[0]}api/status`, {
      headers: { 'x-codex-lark-token': parsed.token },
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) throw new Error('stale');
    return parsed as DashboardLocator;
  } catch {
    await unlink(path).catch(() => {});
    return undefined;
  }
}

async function removeOwnLocator(path: string): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<DashboardLocator>;
    if (parsed.pid === process.pid) await unlink(path);
  } catch {
    // Best effort on shutdown.
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  getState: () => DashboardState,
  setState: (state: DashboardState) => void,
  retry: () => Promise<void>,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/' && req.method === 'GET') {
    return html(res, dashboardHtml(token));
  }
  const supplied = req.headers['x-codex-lark-token'] ?? url.searchParams.get('token');
  if (supplied !== token) return json(res, 403, { error: 'forbidden' });
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { ...getState(), localOnly: true, network: networkInterfaces() ? 'ready' : 'unknown' });
  }
  if (url.pathname === '/api/retry' && req.method === 'POST') {
    setState(status('starting', '正在重试', '正在重新检查 Codex Desktop…'));
    void retry();
    return json(res, 202, { ok: true });
  }
  if (url.pathname === '/api/stop' && req.method === 'POST') {
    json(res, 200, { ok: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
    return;
  }
  json(res, 404, { error: 'not found' });
}

function status(phase: Phase, title: string, detail: string): DashboardState {
  return { phase, title, detail, updatedAt: Date.now() };
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|未找到|executable/i.test(message)) {
    return '没有找到 ChatGPT / Codex Desktop。安装并登录官方桌面应用后，点“重新检查”即可。';
  }
  if (/locked|已有 bridge|占用/i.test(message)) {
    return 'codex-lark 已经在运行，无需重复启动。';
  }
  return message.replace(/cli_[A-Za-z0-9_-]+/g, '飞书应用').slice(0, 500);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function openUrl(url: string): void {
  const command = process.platform === 'darwin'
    ? '/usr/bin/open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

export function dashboardHtml(token: string): string {
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>codex-lark</title><style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6fb;color:#17213a}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#e8edff 0,#f7f8fb 52%,#eef2f8 100%)}main{width:min(560px,100%);background:rgba(255,255,255,.9);border:1px solid #dfe5f0;border-radius:28px;box-shadow:0 28px 80px rgba(43,59,98,.16);padding:36px;text-align:center}.brand{display:flex;align-items:center;justify-content:center;gap:12px;font-weight:750;font-size:26px}.logo{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#111827,#5865f2);color:white;display:grid;place-items:center}.pill{display:inline-flex;gap:8px;align-items:center;background:#eef2ff;color:#4251c5;border-radius:999px;padding:8px 12px;margin-top:22px;font-size:13px}.dot{width:9px;height:9px;border-radius:50%;background:#f4a323;box-shadow:0 0 0 5px rgba(244,163,35,.14)}.online .dot{background:#24a865}.error .dot{background:#dc4c64}h1{font-size:28px;margin:24px 0 8px}p{line-height:1.6;color:#58647d;margin:0 auto;max-width:430px}.qr{margin:24px auto 8px;width:304px;max-width:100%;padding:12px;background:white;border:1px solid #e5e9f2;border-radius:22px}.qr img{display:block;width:100%;border-radius:12px}.actions{display:flex;justify-content:center;gap:12px;margin-top:26px;flex-wrap:wrap}button,a.button{border:0;border-radius:12px;padding:12px 18px;font:inherit;font-weight:650;cursor:pointer;text-decoration:none;background:#4d5de5;color:white}.secondary{background:#edf0f7!important;color:#34405c!important}.foot{margin-top:26px;font-size:12px;color:#8993a7}.hidden{display:none}@media(prefers-color-scheme:dark){:root{background:#0d1220;color:#f1f4ff}body{background:radial-gradient(circle at top,#1f2945,#0d1220 60%)}main{background:rgba(19,26,43,.94);border-color:#2d3853}p{color:#aeb8ce}.pill{background:#202944;color:#aeb8ff}.secondary{background:#283149!important;color:#d8deee!important}.foot{color:#7f8aa2}}
</style></head><body><main id="card"><div class="brand"><span class="logo">C</span> codex-lark</div><div class="pill"><span class="dot"></span><span id="phase">正在启动</span></div><h1 id="title">正在启动 codex-lark</h1><p id="detail">正在寻找 ChatGPT / Codex Desktop…</p><div id="qr" class="qr hidden"><img id="qrimg" alt="飞书扫码二维码"></div><div class="actions"><a id="open" class="button hidden" target="_blank" rel="noreferrer">在浏览器打开授权页</a><button id="retry" class="hidden">重新检查</button><button id="stop" class="secondary">停止 codex-lark</button></div><div class="foot">只监听本机 127.0.0.1 · App Secret 不会发送到浏览器或云端</div></main><script>
const token=${safeToken};
const card=document.querySelector('#card'),phase=document.querySelector('#phase'),title=document.querySelector('#title'),detail=document.querySelector('#detail'),qr=document.querySelector('#qr'),qrimg=document.querySelector('#qrimg'),open=document.querySelector('#open'),retry=document.querySelector('#retry');
const labels={starting:'正在启动',scan:'等待扫码',authorizing:'正在授权',checking:'正在检查',connecting:'正在连接',online:'已在线',error:'需要处理'};
async function poll(){
  try{
    const r=await fetch('/api/status',{headers:{'x-codex-lark-token':token}});
    const s=await r.json();
    phase.textContent=labels[s.phase]||s.phase;
    title.textContent=s.title;
    detail.textContent=s.detail;
    card.className=s.phase;
    qr.classList.toggle('hidden',!s.qrDataUrl);
    if(s.qrDataUrl)qrimg.src=s.qrDataUrl;
    open.classList.toggle('hidden',!s.registrationUrl);
    if(s.registrationUrl)open.href=s.registrationUrl;
    retry.classList.toggle('hidden',s.phase!=='error');
  }catch(e){
    detail.textContent='本地服务正在退出…';
  }
  setTimeout(poll,700);
}
void poll();
retry.onclick=async()=>{retry.classList.add('hidden');await fetch('/api/retry',{method:'POST',headers:{'x-codex-lark-token':token}});};
document.querySelector('#stop').onclick=async()=>{await fetch('/api/stop',{method:'POST',headers:{'x-codex-lark-token':token}});title.textContent='codex-lark 已停止';detail.textContent='可以关闭这个页面。'};
</script></body></html>`;
}
