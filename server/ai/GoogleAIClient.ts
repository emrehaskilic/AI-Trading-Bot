export type GoogleAIConfig = {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type GoogleAIResponse = {
  text: string | null;
};

export async function generateContent(config: GoogleAIConfig, prompt: string): Promise<GoogleAIResponse> {
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  if (!model || !apiKey) {
    throw new Error('ai_config_missing');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ai_http_${res.status}:${text.slice(0, 200)}`);
  }

  const payload: any = await res.json();
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts) && parts.length > 0 ? String(parts[0]?.text || '') : '';
  return { text: text || null };
}
