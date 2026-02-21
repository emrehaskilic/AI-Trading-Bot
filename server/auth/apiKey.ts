import { timingSafeEqual } from 'crypto';
import { IncomingMessage } from 'http';
import { NextFunction, Request, Response } from 'express';

const API_KEY_SECRET = String(process.env.API_KEY_SECRET || '').trim();
if (!API_KEY_SECRET) {
    throw new Error('[auth] Missing API_KEY_SECRET. Set it in server/.env before starting the backend.');
}
const READONLY_VIEW_TOKEN = String(process.env.READONLY_VIEW_TOKEN || process.env.PUBLIC_VIEW_TOKEN || '').trim();
const EXTERNAL_READONLY_MODE = !['false', '0', 'no'].includes(
    String(process.env.EXTERNAL_READONLY_MODE || 'true').toLowerCase()
);

const ALLOW_LOCALHOST_NO_AUTH = !['false', '0', 'no'].includes(
    String(process.env.ALLOW_LOCALHOST_NO_AUTH || 'true').toLowerCase()
);
const ALLOW_PUBLIC_MARKET_DATA = !['false', '0', 'no'].includes(
    String(process.env.ALLOW_PUBLIC_MARKET_DATA || 'false').toLowerCase()
);
const PUBLIC_GET_PATHS = new Set<string>([
    '/exchange-info',
    '/testnet/exchange-info',
    '/dry-run/symbols',
    '/dry-run/status',
]);

function isLocalAddress(raw?: string): boolean {
    if (!raw) return false;
    const addr = raw.trim().toLowerCase();
    if (addr === '127.0.0.1' || addr === '::1') return true;
    if (addr.startsWith('::ffff:')) {
        const v4 = addr.slice('::ffff:'.length);
        return v4 === '127.0.0.1';
    }
    return false;
}

function isLocalRequest(req: IncomingMessage): boolean {
    if (!ALLOW_LOCALHOST_NO_AUTH) return false;
    return isLocalAddress(req.socket?.remoteAddress);
}

function parseQueryParam(urlRaw: string | undefined, key: string): string {
    try {
        const url = new URL(urlRaw || '', 'http://localhost');
        return String(url.searchParams.get(key) || '').trim();
    } catch {
        return '';
    }
}

function isPublicMarketDataRequest(req: Request): boolean {
    if (!ALLOW_PUBLIC_MARKET_DATA) return false;
    if (req.method !== 'GET') return false;
    return PUBLIC_GET_PATHS.has(req.path);
}

function safeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}

function getApiKeyFromAuthorization(headers: IncomingMessage['headers']): string {
    const authRaw = headers.authorization;
    const auth = Array.isArray(authRaw) ? String(authRaw[0] || '') : String(authRaw || '');
    const [scheme, token] = auth.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
        return token.trim();
    }
    return '';
}

function decodeBase64UrlToken(value: string): string {
    try {
        return Buffer.from(value, 'base64url').toString('utf8').trim();
    } catch {
        return '';
    }
}

function getTokenFromWebSocketProtocol(headers: IncomingMessage['headers'], prefix: 'bearer.' | 'viewer.'): string {
    const raw = headers['sec-websocket-protocol'];
    const protocolHeader = Array.isArray(raw) ? String(raw[0] || '') : String(raw || '');
    if (!protocolHeader) {
        return '';
    }

    const protocols = protocolHeader.split(',').map((p) => p.trim()).filter(Boolean);
    const prefixed = protocols.find((p) => p.startsWith(prefix));
    if (!prefixed) {
        return '';
    }

    return decodeBase64UrlToken(prefixed.slice(prefix.length));
}

function getApiKeyFromWebSocketProtocol(headers: IncomingMessage['headers']): string {
    return getTokenFromWebSocketProtocol(headers, 'bearer.');
}

function extractApiKey(req: IncomingMessage): string {
    return getApiKeyFromAuthorization(req.headers) || getApiKeyFromWebSocketProtocol(req.headers);
}

function getViewerTokenFromHeader(headers: IncomingMessage['headers']): string {
    const raw = headers['x-viewer-token'];
    return Array.isArray(raw) ? String(raw[0] || '').trim() : String(raw || '').trim();
}

function extractViewerToken(req: IncomingMessage): string {
    const byHeader = getViewerTokenFromHeader(req.headers);
    if (byHeader) return byHeader;
    const byWsProtocol = getTokenFromWebSocketProtocol(req.headers, 'viewer.');
    if (byWsProtocol) return byWsProtocol;
    return parseQueryParam(req.url, 'viewerToken');
}

function isReadOnlyMethod(method: string | undefined): boolean {
    const normalized = String(method || '').toUpperCase();
    return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

export function isApiKeyValid(apiKey: string): boolean {
    if (!apiKey) {
        return false;
    }
    return safeEquals(apiKey, API_KEY_SECRET);
}

export function isViewerTokenValid(req: IncomingMessage): boolean {
    if (!READONLY_VIEW_TOKEN) return false;
    const candidate = extractViewerToken(req);
    if (!candidate) return false;
    return safeEquals(candidate, READONLY_VIEW_TOKEN);
}

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const localRequest = isLocalRequest(req);
    if (localRequest) {
        next();
        return;
    }

    if (isViewerTokenValid(req)) {
        if (!isReadOnlyMethod(req.method)) {
            res.status(403).json({
                ok: false,
                error: 'readonly_access',
                message: 'Viewer token allows read-only access.',
            });
            return;
        }
        next();
        return;
    }

    if (isPublicMarketDataRequest(req)) {
        next();
        return;
    }

    const apiKey = extractApiKey(req);
    if (!isApiKeyValid(apiKey)) {
        res.status(401).json({
            ok: false,
            error: 'unauthorized',
            message: 'Provide a valid bearer token in the Authorization header.',
        });
        return;
    }

    if (EXTERNAL_READONLY_MODE && !isReadOnlyMethod(req.method)) {
        res.status(403).json({
            ok: false,
            error: 'external_readonly_mode',
            message: 'External access is read-only.',
        });
        return;
    }

    next();
}

export function validateWebSocketApiKey(req: IncomingMessage): { ok: boolean; reason?: string } {
    if (isLocalRequest(req)) {
        return { ok: true };
    }
    if (isViewerTokenValid(req)) {
        return { ok: true };
    }
    const apiKey = extractApiKey(req);
    if (isApiKeyValid(apiKey)) {
        return { ok: true };
    }
    if (ALLOW_PUBLIC_MARKET_DATA) {
        return { ok: true };
    }
    return { ok: false, reason: 'invalid_api_key_or_viewer_token' };
}
