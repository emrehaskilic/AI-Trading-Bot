export type GoogleAIConfig = {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: Record<string, unknown>;
};

export type GoogleAIResponse = {
  text: string | null;
  raw?: any;
  meta?: {
    blockReason?: string;
    finishReason?: string | null;
    safety?: any;
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeModelAlias = (rawModel: string): string => {
  const model = String(rawModel || '').trim().replace(/^models\//i, '');
  if (!model) return model;

  const normalized = model
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases: Array<[RegExp, string]> = [
    [/^gemini 3 pro preview$/, 'gemini-3-pro-preview'],
    [/^gemini 3 flash preview$/, 'gemini-3-flash-preview'],
    [/^gemini 2\.5 pro stable$/, 'gemini-2.5-pro'],
    [/^gemini 2\.5 pro$/, 'gemini-2.5-pro'],
    [/^gemini 2\.5 flash stable$/, 'gemini-2.5-flash'],
    [/^gemini 2\.5 flash$/, 'gemini-2.5-flash'],
    [/^gemini 2\.5 flash lite stable$/, 'gemini-2.5-flash-lite'],
    [/^gemini 2\.5 flash lite$/, 'gemini-2.5-flash-lite'],
    [/^gemini 2\.0 flash$/, 'gemini-2.0-flash'],
  ];

  for (const [pattern, target] of aliases) {
    if (pattern.test(normalized)) {
      return target;
    }
  }

  return model;
};

const extractText = (payload: any): string | null => {
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || null;
};

const shouldRetryStatus = (status: number): boolean => {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
};

const parseRetryAfterMs = (raw: string | null): number | null => {
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
};

export async function generateContent(config: GoogleAIConfig, prompt: string): Promise<GoogleAIResponse> {
  const model = normalizeModelAlias(config.model);
  const apiKey = config.apiKey.trim();
  if (!model || !apiKey) {
    throw new Error('ai_config_missing');
  }

  const urls = [
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  ];
  const bodyBase = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: typeof config.temperature === 'number' ? config.temperature : 0,
      maxOutputTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : 256,
      responseMimeType: 'application/json',
    },
  };

  const requestedSchema = config.responseSchema && typeof config.responseSchema === 'object'
    ? config.responseSchema
    : {
      type: 'OBJECT',
      required: ['version', 'nonce', 'intent'],
      properties: {
        version: { type: 'NUMBER' },
        nonce: { type: 'STRING' },
        intent: { type: 'STRING', enum: ['HOLD', 'ENTER', 'MANAGE', 'EXIT'] },
        side: { type: 'STRING', enum: ['LONG', 'SHORT'] },
        confidence: { type: 'NUMBER' },
      },
    };

  const bodyWithSchema = {
    ...bodyBase,
    generationConfig: {
      ...bodyBase.generationConfig,
      responseSchema: requestedSchema,
    },
  };

  const execute = async (url: string, body: any): Promise<{ payload: any; status: number }> => {
    const maxAttempts = 3;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const payload = await res.json();
        return { payload, status: res.status };
      }

      const text = await res.text().catch(() => '');
      lastError = new Error(`ai_http_${res.status}:${text.slice(0, 300)}`);
      if (!shouldRetryStatus(res.status) || attempt >= maxAttempts) {
        throw lastError;
      }
      const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
      const backoff = retryAfter ?? Math.min(6_000, 400 * Math.pow(2, attempt - 1));
      await sleep(backoff);
    }

    throw lastError || new Error('ai_http_unknown');
  };

  const runWithUrl = async (url: string): Promise<any> => {
    try {
      return (await execute(url, bodyWithSchema)).payload;
    } catch (err: any) {
      const message = String(err?.message || '');
      const unsupportedSchema =
        message.includes('responseSchema')
        || message.includes('responseMimeType')
        || message.includes('Invalid JSON payload')
        || message.includes('GenerateContentRequest.generation_config');
      if (!unsupportedSchema) {
        throw err;
      }
      return (await execute(url, bodyBase)).payload;
    }
  };

  let payload: any;
  let lastError: Error | null = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      payload = await runWithUrl(urls[i]);
      lastError = null;
      break;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err || 'ai_failed'));
      const message = String(lastError?.message || '');
      const retryNextUrl =
        message.includes('ai_http_404')
        || message.includes('ai_http_400')
        || message.includes('NOT_FOUND')
        || message.includes('not found');
      if (!retryNextUrl || i >= urls.length - 1) {
        throw lastError;
      }
    }
  }
  if (!payload) {
    throw lastError || new Error('ai_empty_payload');
  }

  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const text = extractText(payload);

  const blockReason = payload?.promptFeedback?.blockReason
    ? String(payload.promptFeedback.blockReason)
    : undefined;
  const finishReason = candidate?.finishReason ? String(candidate.finishReason) : null;
  const safety = payload?.promptFeedback?.safetyRatings ?? candidate?.safetyRatings ?? null;

  return {
    text: text || null,
    raw: payload,
    meta: {
      blockReason,
      finishReason,
      safety,
    },
  };
}
