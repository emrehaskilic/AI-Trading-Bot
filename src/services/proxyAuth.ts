export const PROXY_API_KEY = String(import.meta.env.VITE_PROXY_API_KEY || '').trim();
export const VIEWER_TOKEN_ENV = String((import.meta as any).env?.VITE_VIEWER_TOKEN || '').trim();

export function isProxyApiKeyConfigured(): boolean {
    return PROXY_API_KEY.length > 0;
}

function readQueryParam(name: string): string {
    if (typeof window === 'undefined') return '';
    try {
        return String(new URLSearchParams(window.location.search).get(name) || '').trim();
    } catch {
        return '';
    }
}

function isTruthy(value: string): boolean {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function getViewerToken(): string {
    const queryToken = readQueryParam('viewerToken');
    if (queryToken) return queryToken;
    return VIEWER_TOKEN_ENV;
}

export function isViewerModeEnabled(): boolean {
    return isTruthy(readQueryParam('viewer')) || isTruthy(readQueryParam('readonly')) || getViewerToken().length > 0;
}

function toBase64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function withProxyApiKey(init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers || {});
    if (isViewerModeEnabled()) {
        const viewerToken = getViewerToken();
        if (viewerToken) {
            headers.set('X-Viewer-Token', viewerToken);
        }
    } else if (isProxyApiKeyConfigured()) {
        headers.set('Authorization', `Bearer ${PROXY_API_KEY}`);
    }
    return {
        ...init,
        headers,
    };
}

export function proxyWebSocketProtocols(): string[] {
    const protocols = ['proxy-auth'];
    if (isViewerModeEnabled()) {
        const viewerToken = getViewerToken();
        if (viewerToken) {
            protocols.push(`viewer.${toBase64Url(viewerToken)}`);
        }
        return protocols;
    }
    if (isProxyApiKeyConfigured()) {
        protocols.push(`bearer.${toBase64Url(PROXY_API_KEY)}`);
    }
    return protocols;
}
