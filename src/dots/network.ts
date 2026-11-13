import { isIP } from 'node:net';

// Restrict IPv6 to global unicast; exclude special-use IPv4, mapped IPv6, and transition ranges.
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || !/^[23]/i.test(address)) return false;
  return !/^(?:2001:(?:0*:|0*2:|0*10:|0*20:|db8:)|2002:|3fff:)/i.test(address);
}

/** Explicit operator proxy: resolve the fixed OpenAI hostname at the trusted proxy,
 * keep end-to-end TLS verification, and never apply this to arbitrary tool URLs. */
export function dotsProxyUrl(env: NodeJS.ProcessEnv = process.env): URL | undefined {
  const raw = env.CODEX_LARK_DOTS_PROXY ?? env.HTTPS_PROXY ?? env.https_proxy;
  if (!raw) return undefined;
  const proxy = new URL(raw);
  if (!['http:', 'https:'].includes(proxy.protocol) || proxy.hash || proxy.search || proxy.pathname !== '/') {
    throw new Error('Dots proxy must be an HTTP(S) proxy origin');
  }
  return proxy;
}
