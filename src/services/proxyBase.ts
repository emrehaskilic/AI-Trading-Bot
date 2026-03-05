function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function toWsBase(value: string): string {
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  return value;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function shouldUseEnvBase(envBase: string): boolean {
  try {
    const pageHost = window.location.hostname;
    const envHost = new URL(envBase).hostname;
    // Prevent shipping localhost endpoints to external viewers.
    if (isLoopbackHost(envHost) && !isLoopbackHost(pageHost)) {
      return false;
    }
    return true;
  } catch {
    // If the value is not a full URL, keep previous behavior.
    return true;
  }
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = trimTrailingSlash(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function getProxyApiCandidates(): string[] {
  const candidates: string[] = [];
  const envBase = String((import.meta as any).env?.VITE_PROXY_API || '').trim();
  const isDev = Boolean((import.meta as any).env?.DEV);

  const { origin, hostname } = window.location;
  const envIsUsable = envBase && shouldUseEnvBase(envBase);

  // In local development, prefer direct backend first to avoid proxy/host resolution stalls.
  if (isDev && isLoopbackHost(hostname)) {
    if (envIsUsable) {
      candidates.push(envBase);
    }
    candidates.push('http://127.0.0.1:8787');
    candidates.push('http://localhost:8787');
    candidates.push(origin);
    return unique(candidates);
  }

  // For non-local contexts, try same-origin first and then configured env base.
  candidates.push(origin);
  if (envIsUsable) {
    candidates.push(envBase);
  }

  // Hard fallback for local development when proxy/env resolution fails.
  candidates.push('http://localhost:8787');
  candidates.push('http://127.0.0.1:8787');
  if (!isLoopbackHost(hostname)) {
    candidates.push(`http://${hostname}:8787`);
  }

  return unique(candidates);
}

export function getProxyApiBase(): string {
  return getProxyApiCandidates()[0];
}

export function getProxyWsCandidates(): string[] {
  const candidates: string[] = [];

  // Keep WS resolution aligned with API candidate order.
  for (const apiBase of getProxyApiCandidates()) {
    candidates.push(toWsBase(apiBase));
  }

  const envWsBase = String((import.meta as any).env?.VITE_PROXY_WS || '').trim();
  if (envWsBase && shouldUseEnvBase(envWsBase)) {
    candidates.push(toWsBase(envWsBase));
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port } = window.location;
  const suffix = port ? `:${port}` : '';
  candidates.push(`${wsProtocol}//${hostname}${suffix}`);

  return unique(candidates);
}

export function getProxyWsBase(): string {
  return getProxyWsCandidates()[0];
}
