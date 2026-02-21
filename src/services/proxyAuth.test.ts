import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModule() {
  vi.resetModules();
  return import('./proxyAuth');
}

describe('proxyAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
  });

  it('applies bearer auth when viewer mode is not enabled', async () => {
    const mod = await loadModule();

    const withAuth = mod.withProxyApiKey();
    const headers = new Headers(withAuth.headers);
    if (mod.isProxyApiKeyConfigured()) {
      expect(headers.get('Authorization')).toMatch(/^Bearer\s+/);
    } else {
      expect(headers.get('Authorization')).toBeNull();
    }
    expect(headers.get('X-Viewer-Token')).toBeNull();
    expect(mod.proxyWebSocketProtocols()[0]).toBe('proxy-auth');
  });

  it('uses viewer token in read-only mode', async () => {
    window.history.replaceState(null, '', '/?viewer=1&viewerToken=readonly-token');
    const mod = await loadModule();

    expect(mod.isViewerModeEnabled()).toBe(true);
    const withAuth = mod.withProxyApiKey();
    const headers = new Headers(withAuth.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Viewer-Token')).toBe('readonly-token');
    expect(mod.proxyWebSocketProtocols()[1]).toMatch(/^viewer\./);
  });
});
