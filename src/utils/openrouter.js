// ── OpenRouter API client ─────────────────────────────────────────────────────
//
// Single provider for chat, embeddings, and transcription in this RAG pipeline.

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Long-context analysis + structured JSON; strong reasoning for RAG answers. */
export const CHAT_MODEL = 'google/gemini-2.5-flash';

/** OpenAI embeddings via OpenRouter — standard for semantic retrieval. */
export const EMBED_MODEL = 'openai/text-embedding-3-small';

/** Accurate speech-to-text for uploaded video files. */
export const WHISPER_MODEL = 'openai/whisper-large-v3';

const APP_TITLE = 'Lumina';

export function openRouterHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
    'X-OpenRouter-Title': APP_TITLE,
  };
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/**
 * fetch() with exponential backoff on rate-limit (429) and transient 5xx errors.
 * Honors Retry-After when present. Never retries aborted requests.
 */
async function fetchWithRetry(url, init, { signal } = {}) {
  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      if (attempt >= MAX_RETRIES) throw e;
      await sleep(2 ** attempt * 500, signal);
      attempt += 1;
      continue;
    }

    if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 600;
      await sleep(wait, signal);
      attempt += 1;
      continue;
    }

    return response;
  }
}

export async function chatCompletion(apiKey, body, { signal } = {}) {
  const response = await fetchWithRetry(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
    },
    { signal }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter API error: ${msg}`);
  }

  return response.json();
}

/**
 * Stream a chat completion via Server-Sent Events.
 * Calls onToken(deltaText, fullText) as tokens arrive and resolves with the
 * complete answer. Pass an AbortSignal to allow the user to stop generation.
 */
export async function streamChatCompletion(apiKey, body, { onToken, signal } = {}) {
  const response = await fetchWithRetry(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({ ...body, stream: true }),
    },
    { signal }
  );

  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter API error: ${msg}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { deltas, rest } = parseSSEChunk(buffer);
      buffer = rest;
      for (const delta of deltas) {
        full += delta;
        onToken?.(delta, full);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return full.trim();
}

/**
 * Parse a buffered SSE text chunk into content deltas. Any trailing partial line
 * (an incomplete frame) is returned as `rest` to be prepended to the next chunk.
 * Pure and side-effect free so it can be unit-tested.
 */
export function parseSSEChunk(buffer) {
  const deltas = [];
  const parts = String(buffer || '').split('\n');
  const rest = parts.pop() ?? '';

  for (const raw of parts) {
    const line = raw.trim();
    if (!line || !line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      const delta = json?.choices?.[0]?.delta?.content ?? '';
      if (delta) deltas.push(delta);
    } catch {
      /* skip malformed frame */
    }
  }

  return { deltas, rest };
}

export async function createEmbeddings(apiKey, input, { signal } = {}) {
  const texts = Array.isArray(input) ? input : [input];
  if (!texts.length) return [];

  const response = await fetchWithRetry(
    `${OPENROUTER_BASE}/embeddings`,
    {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts,
        encoding_format: 'float',
      }),
    },
    { signal }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `HTTP ${response.status}`;
    throw new Error(`Embedding API error: ${msg}`);
  }

  const data = await response.json();
  const sorted = [...(data?.data || [])].sort((a, b) => a.index - b.index);
  return sorted.map((row) => row.embedding);
}

export async function transcribeAudio(apiKey, audioBlob, { verbose = true } = {}) {
  const formData = new FormData();
  formData.append('file', new File([audioBlob], 'audio.wav', { type: 'audio/wav' }));
  formData.append('model', WHISPER_MODEL);
  if (verbose) {
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
  } else {
    formData.append('response_format', 'text');
  }

  const response = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
      'X-OpenRouter-Title': APP_TITLE,
    },
    body: formData,
  });

  return response;
}
