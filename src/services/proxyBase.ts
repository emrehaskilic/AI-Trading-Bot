const DEV_PORTS = new Set(['5173', '5174', '5175']);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

export function getProxyApiBase(): string {
  const envBase = String((import.meta as any).env?.VITE_PROXY_API || '').trim();
  if (envBase && shouldUseEnvBase(envBase)) {
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
  if (envBase && shouldUseEnvBase(envBase)) {
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
