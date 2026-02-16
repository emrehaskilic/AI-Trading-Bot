export type GoogleAIConfig = {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
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

export async function generateContent(config: GoogleAIConfig, prompt: string): Promise<GoogleAIResponse> {
  const model = config.model.trim().replace(/^models\//i, '');
  const apiKey = config.apiKey.trim();
  if (!model || !apiKey) {
    throw new Error('ai_config_missing');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    },
  };

  const bodyWithSchema = {
    ...bodyBase,
    generationConfig: {
      ...bodyBase.generationConfig,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        required: ['action'],
        properties: {
          action: { type: 'STRING', enum: ['HOLD', 'ENTRY', 'EXIT', 'REDUCE', 'ADD'] },
          side: { type: 'STRING', enum: ['LONG', 'SHORT'] },
          sizeMultiplier: { type: 'NUMBER' },
          reducePct: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
      },
    },
  };

  const execute = async (body: any): Promise<{ payload: any; status: number }> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ai_http_${res.status}:${text.slice(0, 300)}`);
    }
    const payload = await res.json();
    return { payload, status: res.status };
  };

  let payload: any;
  try {
    payload = (await execute(bodyWithSchema)).payload;
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
    payload = (await execute(bodyBase)).payload;
  }

  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

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
