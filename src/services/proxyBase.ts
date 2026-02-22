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

  const { origin } = window.location;
  return trimTrailingSlash(origin);
}

export function getProxyWsBase(): string {
  const envBase = String((import.meta as any).env?.VITE_PROXY_WS || '').trim();
  if (envBase && shouldUseEnvBase(envBase)) {
    return trimTrailingSlash(envBase);
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port } = window.location;
  const suffix = port ? `:${port}` : '';
  return `${wsProtocol}//${hostname}${suffix}`;
}
