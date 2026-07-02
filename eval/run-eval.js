#!/usr/bin/env node
// ── Lumina RAG evaluation harness ─────────────────────────────────────────────
//
// Measures, on a fixed dataset of documents + questions:
//   1. Retrieval hit rate @ k  → bm25-only vs dense-only vs hybrid (RRF)
//   2. Citation precision      → LLM judge: does each cited excerpt actually
//                                support the sentence that cites it?
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-... node eval/run-eval.js [dataset.json] [--k 5] [--skip-judge]
//
// Notes:
//   - Requires Node 18+ (uses global fetch / web streams).
//   - Dataset format: see eval/dataset.example.json. answerSpans are verbatim
//     substrings of the source text; retrieval "hits" when any retrieved chunk
//     contains any span (whitespace/case-normalized containment).

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  buildRagIndex,
  hybridRetrieve,
  cosineSimilarity,
  askWithRagStream,
} from '../src/utils/rag.js';
import { embedTexts } from '../src/utils/embeddings.js';
import { chatCompletion } from '../src/utils/openrouter.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Set OPENROUTER_API_KEY before running the eval.');
  process.exit(1);
}

const args = process.argv.slice(2);
const datasetPath = args.find((a) => !a.startsWith('--')) || 'eval/dataset.example.json';
const K = Number(args[args.indexOf('--k') + 1]) || 5;
const SKIP_JUDGE = args.includes('--skip-judge');
const JUDGE_MODEL = 'openai/gpt-4o-mini';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const pct = (x) => `${(100 * x).toFixed(1)}%`;

// ── Retrieval modes ───────────────────────────────────────────────────────────
// bm25 / dense reuse the index internals directly; hybrid uses the production
// path so the eval measures exactly what the app ships.

function retrieve(mode, index, question, queryEmbedding, k) {
  if (mode === 'hybrid') {
    return hybridRetrieve(index, question, queryEmbedding, k).map((h) => h.chunk);
  }
  const scores =
    mode === 'bm25'
      ? index.bm25.score(question)
      : index.chunks.map((c) => cosineSimilarity(queryEmbedding, c.embedding));
  return [...scores.keys()]
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, k)
    .map((i) => index.chunks[i]);
}

function isHit(chunks, answerSpans) {
  const texts = chunks.map((c) => norm(c.text));
  return answerSpans.some((span) => texts.some((t) => t.includes(norm(span))));
}

// ── Citation precision (LLM judge) ────────────────────────────────────────────
// For every citation marker [n] in the answer, pair the sentence containing it
// with excerpt n and ask a judge model for a supported / not-supported verdict.

function extractCitedClaims(answer, citations) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const sentences = String(answer)
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/);
  const pairs = [];
  for (const s of sentences) {
    for (const m of s.matchAll(/\[(\d+)\]/g)) {
      const cite = byRef.get(Number(m[1]));
      if (cite) pairs.push({ claim: s.replace(/\[\d+\]/g, '').trim(), excerpt: cite.excerpt });
    }
  }
  return pairs;
}

async function judgeCitations(pairs) {
  if (!pairs.length) return { supported: 0, total: 0 };
  const list = pairs
    .map((p, i) => `${i + 1}. CLAIM: ${p.claim}\n   EXCERPT: ${p.excerpt}`)
    .join('\n\n');
  const data = await chatCompletion(apiKey, {
    model: JUDGE_MODEL,
    temperature: 0,
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content:
          'For each numbered pair, answer whether the EXCERPT supports the CLAIM. ' +
          'Partial support counts only if the core fact of the claim appears in the excerpt. ' +
          'Respond with ONLY a JSON array of booleans, e.g. [true,false,true]. No other text.',
      },
      { role: 'user', content: list },
    ],
  });
  try {
    const raw = data?.choices?.[0]?.message?.content?.replace(/```json|```/g, '').trim();
    const verdicts = JSON.parse(raw);
    return {
      supported: verdicts.filter(Boolean).length,
      total: verdicts.length,
    };
  } catch {
    return { supported: 0, total: 0 };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
console.log(`Dataset: ${datasetPath} — ${dataset.sources.length} source(s), ${dataset.questions.length} question(s), k=${K}\n`);

console.log('Building index (chunk + embed + BM25)…');
const index = await buildRagIndex(apiKey, dataset.sources, 'pdf', null);
console.log(`Indexed ${index.chunkCount} chunks.\n`);

const modes = ['bm25', 'dense', 'hybrid'];
const hits = Object.fromEntries(modes.map((m) => [m, 0]));
let judged = { supported: 0, total: 0 };

for (const [qi, item] of dataset.questions.entries()) {
  const [queryEmbedding] = await embedTexts([item.q], null, apiKey);

  for (const mode of modes) {
    const chunks = retrieve(mode, index, item.q, queryEmbedding, K);
    if (isHit(chunks, item.answerSpans)) hits[mode] += 1;
  }

  if (!SKIP_JUDGE) {
    const { answer, citations } = await askWithRagStream(apiKey, index, item.q, { allowEmpty: true });
    const pairs = extractCitedClaims(answer, citations);
    const verdict = await judgeCitations(pairs);
    judged.supported += verdict.supported;
    judged.total += verdict.total;
  }

  process.stdout.write(`\rEvaluated ${qi + 1}/${dataset.questions.length} questions`);
}

const n = dataset.questions.length;
console.log('\n\n## Results\n');
console.log(`| Retrieval mode | Hit rate @ ${K} |`);
console.log('|---|---|');
for (const mode of modes) console.log(`| ${mode} | ${pct(hits[mode] / n)} (${hits[mode]}/${n}) |`);

if (!SKIP_JUDGE) {
  console.log(`\nCitation precision (LLM judge, ${JUDGE_MODEL}): ${judged.total ? pct(judged.supported / judged.total) : 'n/a'} (${judged.supported}/${judged.total} cited claims supported)`);
}
console.log('\nPaste the table above into your README under an "Evaluation" section.');
