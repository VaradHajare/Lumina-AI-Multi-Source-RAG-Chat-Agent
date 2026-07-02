// ── RAG pipeline: chunking, hybrid retrieval, citations ───────────────────────
//
// Architecture (browser-native, no vector DB):
//   1. Semantic chunking with overlap + page/timestamp metadata
//   2. Dense retrieval  → OpenRouter text-embedding-3-small + cosine similarity
//   3. Sparse retrieval → BM25 over tokenized chunks
//   4. Fusion           → Reciprocal Rank Fusion (RRF, k=60)
//   5. Generation       → Gemini 2.5 Flash with citation prompts

import { streamChatCompletion, EMBED_MODEL } from './openrouter.js';
import { embedTexts } from './embeddings.js';
import { getChatModel } from './settings.js';
import { condenseQuestion } from './condense.js';

export { EMBED_MODEL };

const RRF_K = 60;
// Higher top-K improves recall for "list everything" questions where one relevant
// section (e.g. one phase of a lifecycle) would otherwise fall just below the cut.
const DEFAULT_TOP_K = 10;

const PAGE_RE = /^\[Page (\d+)\]/;
const STAMP_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;

// ── Chunking ─────────────────────────────────────────────────────────────────

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Split source text into overlapping chunks with citation metadata.
 * Respects [Page N] and [M:SS] boundaries when possible.
 */
export function chunkSourceText(sourceText, options = {}) {
  const { targetSize = 900, overlap = 150, maxChunks = 250, onTruncate } = options;
  const text = String(sourceText || '').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const blocks = [];
  let currentPage = null;
  let currentStamp = null;
  let buffer = '';

  const flushBlock = () => {
    const body = buffer.trim();
    if (body) {
      blocks.push({ text: body, page: currentPage, timestamp: currentStamp });
    }
    buffer = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const pageMatch = line.match(PAGE_RE);
    const stampMatch = !pageMatch && line.match(STAMP_RE);

    if (pageMatch) {
      flushBlock();
      currentPage = Number(pageMatch[1]);
      currentStamp = null;
      const rest = line.replace(PAGE_RE, '').trim();
      buffer = rest;
      continue;
    }

    if (stampMatch) {
      flushBlock();
      currentStamp = stampMatch[1];
      const rest = line.replace(STAMP_RE, '').trim();
      buffer = rest;
      continue;
    }

    buffer = buffer ? `${buffer} ${line}` : line;
  }
  flushBlock();

  if (blocks.length === 0) {
    blocks.push({ text, page: null, timestamp: null });
  }

  const chunks = [];
  let carry = '';

  const pushChunk = (body, meta) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length < 40) return;
    chunks.push({
      id: chunks.length + 1,
      text: trimmed,
      page: meta.page,
      timestamp: meta.timestamp,
      label: chunkLabel(meta.page, meta.timestamp, chunks.length + 1),
    });
  };

  for (const block of blocks) {
    const combined = carry ? `${carry} ${block.text}` : block.text;
    carry = '';

    if (combined.length <= targetSize) {
      pushChunk(combined, block);
      continue;
    }

    const words = combined.split(/\s+/);
    let start = 0;

    while (start < words.length) {
      let end = start;
      let len = 0;
      while (end < words.length && len + words[end].length + 1 <= targetSize) {
        len += words[end].length + 1;
        end += 1;
      }
      if (end === start) end += 1;

      const slice = words.slice(start, end).join(' ');
      pushChunk(slice, block);

      if (end >= words.length) break;
      const overlapWords = Math.max(1, Math.floor(overlap / 5));
      start = Math.max(start + 1, end - overlapWords);
    }
  }

  // A source larger than the cap is silently truncated — let callers surface it
  // so the user knows part of a big document was not indexed.
  if (chunks.length > maxChunks) onTruncate?.(chunks.length, maxChunks);

  return chunks.slice(0, maxChunks);
}

export function chunkLabel(page, timestamp, index) {
  if (page != null) return `Page ${page}`;
  if (timestamp) return timestamp;
  return `Section ${index}`;
}

// ── BM25 sparse retrieval ─────────────────────────────────────────────────────

export class BM25Index {
  constructor(docs, { k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    const tokenized = docs.map((d) => tokenize(d.text));
    this.N = tokenized.length;
    // Precompute per-doc term-frequency maps and lengths once, so score() is a
    // cheap lookup per query term instead of rebuilding every tf map per query.
    this.docLengths = tokenized.map((t) => t.length);
    this.tfMaps = tokenized.map((tokens) => {
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      return tf;
    });
    this.avgDl =
      this.N === 0
        ? 0
        : this.docLengths.reduce((sum, len) => sum + len, 0) / this.N;
    this.df = new Map();

    for (const tf of this.tfMaps) {
      for (const t of tf.keys()) {
        this.df.set(t, (this.df.get(t) || 0) + 1);
      }
    }
  }

  score(query) {
    const qTokens = tokenize(query);
    if (!qTokens.length || !this.N) return new Array(this.N).fill(0);

    // Dedupe query terms so a repeated term isn't scored twice.
    const uniqueQ = [...new Set(qTokens)];

    return this.tfMaps.map((tf, i) => {
      const dl = this.docLengths[i];
      let s = 0;
      for (const term of uniqueQ) {
        const f = tf.get(term) || 0;
        if (!f) continue;
        const df = this.df.get(term) || 0;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const denom = f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgDl || 1));
        s += idf * ((f * (this.k1 + 1)) / denom);
      }
      return s;
    });
  }
}

// ── Dense retrieval ───────────────────────────────────────────────────────────

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// ── Hybrid retrieval (RRF) ────────────────────────────────────────────────────

export function reciprocalRankFusion(rankLists, k = RRF_K) {
  const scores = new Map();
  for (const ranks of rankLists) {
    ranks.forEach((docIdx, rank) => {
      scores.set(docIdx, (scores.get(docIdx) || 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([idx, score]) => ({ idx, score }));
}

export function hybridRetrieve(index, queryText, queryEmbedding, topK = DEFAULT_TOP_K, options = {}) {
  const { chunks, bm25 } = index;
  if (!chunks.length) return [];

  const { sourceId } = options;
  const allowed = (i) => !sourceId || chunks[i].sourceId === sourceId;

  const bm25Scores = bm25.score(queryText);
  const denseScores = chunks.map((c) => cosineSimilarity(queryEmbedding, c.embedding));

  const pool = Math.max(topK * 4, 30);
  const bm25Ranks = [...bm25Scores.keys()]
    .filter(allowed)
    .sort((a, b) => bm25Scores[b] - bm25Scores[a])
    .slice(0, pool);

  const denseRanks = [...denseScores.keys()]
    .filter(allowed)
    .sort((a, b) => denseScores[b] - denseScores[a])
    .slice(0, pool);

  const fused = reciprocalRankFusion([bm25Ranks, denseRanks]).slice(0, topK);

  return fused.map(({ idx, score }) => ({
    chunk: chunks[idx],
    score,
    bm25: bm25Scores[idx],
    dense: denseScores[idx],
  }));
}

// ── Index build ───────────────────────────────────────────────────────────────

/**
 * Build an in-memory RAG index: chunks + embeddings + BM25.
 *
 * `source` may be either:
 *   - a string  → single source (legacy/analysis path)
 *   - an array of { id, title, type, text } → multi-source, source-aware
 *
 * Every chunk is tagged with { sourceId, sourceTitle, sourceType } so citations
 * can point back to the exact document they came from.
 */
export async function buildRagIndex(apiKey, source, sourceType, onProgress) {
  onProgress?.(54, 'Chunking sources for retrieval…');

  const sourceList = typeof source === 'string'
    ? [{ id: 'default', title: null, type: sourceType, text: source }]
    : (source || []);

  let chunks = [];
  for (const s of sourceList) {
    const sChunks = chunkSourceText(s.text, {
      onTruncate: (produced, cap) => {
        const name = s.title || s.id || 'a source';
        onProgress?.(
          55,
          `Note: “${name}” produced ${produced} chunks; indexing the first ${cap}. Later pages may not be retrievable.`
        );
      },
    });
    for (const c of sChunks) {
      chunks.push({
        ...c,
        sourceId: s.id,
        sourceTitle: s.title || null,
        sourceType: s.type || sourceType,
      });
    }
  }
  // Re-number chunk ids globally so citation refs stay unique across sources.
  chunks = chunks.map((c, i) => ({ ...c, id: i + 1 }));

  const sources = sourceList.map((s) => ({ id: s.id, title: s.title || null, type: s.type || sourceType }));

  if (!chunks.length) {
    return { chunks: [], bm25: new BM25Index([]), sourceType, chunkCount: 0, sources };
  }

  onProgress?.(56, `Embedding ${chunks.length} chunks (hybrid RAG)…`);
  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    (msg) => onProgress?.(58, msg),
    apiKey
  );

  const enriched = chunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i],
  }));

  onProgress?.(62, 'Building BM25 index…');
  const bm25 = new BM25Index(enriched);

  return {
    chunks: enriched,
    bm25,
    sourceType,
    chunkCount: enriched.length,
    sources,
  };
}

// ── RAG Q&A ─────────────────────────────────────────────────────────────────

const RAG_ASK_SYSTEM = `You are a precise research assistant. Answer the user's question using ONLY the numbered source excerpts provided.

FORMAT every answer as clean, well-structured GitHub-Flavored Markdown:
- Open with a one-sentence direct answer to the question.
- Use "-" bullet lists for sets of items, and numbered lists ("1.", "2.") for ordered steps, phases, or sequences.
- Put each list item on its own line. Bold the key term or name of each item with **double asterisks**, e.g. "- **Discovery** — short description [1]".
- Use short paragraphs. Add a "## Heading" only when the answer has several distinct sections.
- Keep it scannable; do not write one dense block of text.

CITATIONS:
- Support each factual claim with an inline citation like [1] whose number matches the excerpt the information came from.
- Use the SINGLE most relevant excerpt per claim. Add a second citation ONLY when it provides genuinely different supporting information — never stack redundant citations (e.g. [1][2]) for the same fact.
- Cite ONLY excerpts that directly support the statement. Never cite an excerpt you did not actually use.
- Place the citation immediately after the claim it supports.

ACCURACY:
- If the question asks for a list or "all" of something (e.g. every phase, step, or item), scan ALL excerpts and include every item you can find — do not stop at the first excerpt.
- If the excerpts do not contain enough information, say so clearly.
- Do not invent facts or use outside knowledge.
- Do NOT add a trailing "Sources" list — the inline citations are sufficient.`;

/**
 * Rewrite an answer so citations are numbered 1..k in order of first appearance,
 * and drop retrieved passages the model never actually cited. Citation refs
 * inside code spans are left untouched. Returns { answer, citations }.
 */
export function renumberCitations(answer, citations) {
  const text = String(answer || '');
  const validRefs = new Set(citations.map((c) => c.ref));
  const mapping = new Map(); // original ref → new sequential ref
  let next = 1;

  // Split out code spans so array indices like arr[2] aren't rewritten.
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  const rewritten = parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code span
      return part.replace(/\[(\d+)\]/g, (full, numStr) => {
        const num = Number(numStr);
        if (!validRefs.has(num)) return full;
        if (!mapping.has(num)) mapping.set(num, next++);
        return `[${mapping.get(num)}]`;
      });
    })
    .join('');

  if (mapping.size === 0) {
    // Model produced no valid inline citations — keep the answer and all passages.
    return { answer: text, citations };
  }

  const newCitations = [...mapping.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([orig, neu]) => ({ ...citations.find((c) => c.ref === orig), ref: neu }));

  return { answer: rewritten, citations: newCitations };
}

/**
 * Drop passages that substantially overlap an already-kept one. Chunks are built
 * with overlap, so adjacent hits can be near-duplicates — without this, citations
 * show "the same source" several times over.
 */
function dedupeHits(hits, threshold = 0.55) {
  const kept = [];
  const tokenSets = [];
  for (const h of hits) {
    const toks = new Set(tokenize(h.chunk.text));
    if (!toks.size) continue;
    let dup = false;
    for (const ts of tokenSets) {
      let inter = 0;
      for (const t of toks) if (ts.has(t)) inter += 1;
      const union = toks.size + ts.size - inter;
      if (union && inter / union > threshold) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      kept.push(h);
      tokenSets.push(toks);
    }
  }
  return kept;
}

/** Run hybrid retrieval and assemble the chat payload + citation list. */
async function prepareRagRequest(apiKey, ragIndex, question, options = {}) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Please enter a question.');
  if (!ragIndex?.chunks?.length) {
    throw new Error('RAG index is empty. Re-run analysis on this document.');
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const chatModel = options.chatModel ?? getChatModel();

  // Resolve follow-ups ("explain the second one") into standalone questions so
  // both retrieval and generation see the full intent. Falls back to `q`.
  const standalone = options.history?.length
    ? await condenseQuestion(apiKey, options.history, q, {
        chatModel,
        signal: options.signal,
      })
    : q;

  const [queryEmbedding] = await embedTexts([standalone], null, apiKey, { signal: options.signal });
  // Over-fetch, then collapse near-duplicate passages down to topK distinct ones.
  const raw = hybridRetrieve(ragIndex, standalone, queryEmbedding, topK * 2, { sourceId: options.sourceId });
  const hits = dedupeHits(raw).slice(0, topK);

  if (!hits.length) {
    throw new Error('No relevant passages found. Try rephrasing your question.');
  }

  const excerptBlock = hits
    .map((h, i) => {
      const n = i + 1;
      const src = h.chunk.sourceTitle ? ` — ${h.chunk.sourceTitle}` : '';
      const loc = h.chunk.label ? ` (${h.chunk.label}${src})` : src;
      return `[${n}]${loc}\n${h.chunk.text}`;
    })
    .join('\n\n');

  const body = {
    model: chatModel,
    temperature: 0.15,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: RAG_ASK_SYSTEM },
      {
        role: 'user',
        content:
          `Source type: ${ragIndex.sourceType}\n\n` +
          `Retrieved excerpts:\n\n${excerptBlock}\n\n` +
          `Question:\n${standalone}`,
      },
    ],
  };

  const citations = hits.map((h, i) => ({
    ref: i + 1,
    chunkId: h.chunk.id,
    sourceId: h.chunk.sourceId ?? null,
    label: h.chunk.label,
    source: h.chunk.sourceTitle || null,
    sourceType: h.chunk.sourceType || null,
    excerpt: h.chunk.text.slice(0, 220) + (h.chunk.text.length > 220 ? '…' : ''),
    score: h.score,
    bm25: h.bm25,
    dense: h.dense,
  }));

  return { body, citations, hits };
}

/**
 * Ask a question against the index and stream the answer. Emits tokens via
 * options.onToken(delta, full) and supports options.signal (AbortSignal) so the
 * user can stop generation.
 */
export async function askWithRagStream(apiKey, ragIndex, question, options = {}) {
  const { body, citations, hits } = await prepareRagRequest(apiKey, ragIndex, question, options);

  const raw = await streamChatCompletion(apiKey, body, {
    onToken: options.onToken,
    signal: options.signal,
  });

  if (!raw && !options.allowEmpty) {
    throw new Error('OpenRouter returned an empty answer. Try again.');
  }

  // Finalize numbering once the full answer is known: renumber to order of
  // appearance and keep only the passages actually cited.
  const { answer, citations: cited } = renumberCitations(raw, citations);
  return { answer, citations: cited, retrievedCount: hits.length, chunkCount: ragIndex.chunkCount };
}
