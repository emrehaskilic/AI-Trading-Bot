import { getProxyApiCandidates } from './proxyBase';

const DEFAULT_REQUEST_TIMEOUT_MS = 6000;

function buildUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function looksLikeHtml(value: string): boolean {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithBases<T>(path: string, init: RequestInit): Promise<T> {
  const bases = getProxyApiCandidates();
  let lastError: unknown = new Error(`No API candidates available for ${path}`);

  for (const base of bases) {
    try {
      const response = await fetchWithTimeout(buildUrl(base, path), init);
      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const payloadText = await response.text();
      if (!payloadText || looksLikeHtml(payloadText)) {
        throw new Error('INVALID_JSON_PAYLOAD');
      }

      return JSON.parse(payloadText) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${path}`);
}

async function fetchTextWithBases(path: string, init: RequestInit): Promise<string> {
  const bases = getProxyApiCandidates();
  let lastError: unknown = new Error(`No API candidates available for ${path}`);

  for (const base of bases) {
    try {
      const response = await fetchWithTimeout(buildUrl(base, path), init);
      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const payloadText = await response.text();
      if (!payloadText || looksLikeHtml(payloadText)) {
        throw new Error('INVALID_TEXT_PAYLOAD');
      }

      return payloadText;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${path}`);
}

export async function fetchApiJson<T>(path: string, init: RequestInit): Promise<T> {
  return fetchJsonWithBases<T>(path, init);
}

export async function fetchApiText(path: string, init: RequestInit): Promise<string> {
  return fetchTextWithBases(path, init);
}

export async function fetchApiBlob(path: string, init: RequestInit): Promise<Blob> {
  const bases = getProxyApiCandidates();
  let lastError: unknown = new Error(`No API candidates available for ${path}`);

  for (const base of bases) {
    try {
      const response = await fetchWithTimeout(buildUrl(base, path), init);
      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }
      return await response.blob();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${path}`);
}
