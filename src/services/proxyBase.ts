const DEV_PORTS = new Set(['5173', '5174', '5175']);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getProxyApiBase(): string {
  const envBase = String((import.meta as any).env?.VITE_PROXY_API || '').trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }

  const { protocol, hostname, port, origin } = window.location;
  if (DEV_PORTS.has(port)) {
    return `${protocol}//${hostname}:8787`;
  }

  return trimTrailingSlash(origin);
}

export function getProxyWsBase(): string {
  const envBase = String((import.meta as any).env?.VITE_PROXY_WS || '').trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port } = window.location;
  if (DEV_PORTS.has(port)) {
    return `${wsProtocol}//${hostname}:8787`;
  }

  const suffix = port ? `:${port}` : '';
  return `${wsProtocol}//${hostname}${suffix}`;
}
