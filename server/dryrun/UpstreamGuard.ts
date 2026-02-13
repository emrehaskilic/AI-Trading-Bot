import { DryRunProxyConfig } from './types';

const MAINNET_REST_HOST = 'fapi.binance.com';
const MAINNET_WS_HOST = 'fstream.binance.com';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (e: any) {
    throw new Error(`invalid_url:${url}`);
  }
}

export function assertMainnetProxyConfig(proxy: DryRunProxyConfig): void {
  if (proxy.mode !== 'backend-proxy') {
    throw new Error(`invalid_proxy_mode:${proxy.mode}`);
  }

  const restHost = hostnameOf(proxy.restBaseUrl);
  const wsHost = hostnameOf(proxy.marketWsBaseUrl);

  if (restHost !== MAINNET_REST_HOST) {
    throw new Error(`upstream_guard_fail_rest:${restHost}`);
  }

  if (wsHost !== MAINNET_WS_HOST) {
    throw new Error(`upstream_guard_fail_ws:${wsHost}`);
  }
}
