// Dense embeddings via OpenRouter (openai/text-embedding-3-small).

import { createEmbeddings, EMBED_MODEL } from './openrouter.js';

export { EMBED_MODEL };

const BATCH = 64;

/**
 * Embed texts in batches through OpenRouter.
 */
export async function embedTexts(texts, onStatus, apiKey, { signal } = {}) {
  if (!texts.length) return [];
  if (!apiKey) throw new Error('OpenRouter API key is required for embeddings.');

  onStatus?.(`Embedding ${texts.length} chunks via OpenRouter…`);

  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    if (texts.length > BATCH && i > 0) {
      onStatus?.(`Embedding chunk ${Math.min(i + BATCH, texts.length)} of ${texts.length}…`);
    }
    const batchVectors = await createEmbeddings(apiKey, batch, { signal });
    vectors.push(...batchVectors);
  }
  return vectors;
}
