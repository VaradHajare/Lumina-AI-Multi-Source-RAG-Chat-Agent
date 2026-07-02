// ── Conversational query condensation ────────────────────────────────────────
//
// Follow-up questions ("explain the second one", "why?") have no standalone
// meaning, so embedding them raw retrieves garbage. Before retrieval, rewrite
// the question into a self-contained one using recent chat history.
//
// A cheap heuristic gate skips the extra LLM round-trip when the question is
// clearly standalone (no history, or no anaphoric/elliptical markers).

import { chatCompletion } from './openrouter.js';
import { getChatModel } from './settings.js';

/** Most recent turns to include as rewrite context. */
const MAX_HISTORY_TURNS = 6;

/** Truncate long turns so the rewrite prompt stays small and cheap. */
const MAX_TURN_CHARS = 500;

// Anaphora / ellipsis markers that signal the question leans on prior turns.
const REFERENTIAL_RE =
  /\b(it|its|that|this|those|these|them|they|their|he|she|his|her|one|ones|both|former|latter|above|previous|earlier|same)\b/i;
const ELLIPTICAL_RE =
  /^\s*(and\b|also\b|what about\b|how about\b|why\b|why not\b|really\?|how so\b|more\b|again\b|elaborate\b|expand\b|continue\b|go on\b|ok(ay)?\b|so\b)/i;

const CONDENSE_SYSTEM = `You rewrite follow-up questions into standalone questions.

Given a conversation and a new question, rewrite the question so it is fully self-contained: resolve pronouns and references ("it", "the second one", "that phase") using the conversation, and carry over the topic when the question is elliptical ("why?", "what about cost?").

Rules:
- Preserve the user's intent exactly. Do not answer the question.
- Do not add constraints, opinions, or details the user did not ask for.
- If the question is already standalone, return it unchanged.
- Respond with ONLY the rewritten question. No quotes, no preamble.`;

/**
 * Heuristic gate: does this question likely depend on prior turns?
 * Errs toward condensing — a wasted rewrite call is cheaper than bad retrieval.
 */
export function needsCondensing(question, history) {
  const q = String(question || '').trim();
  if (!q || !history?.length) return false;
  if (REFERENTIAL_RE.test(q)) return true;
  if (ELLIPTICAL_RE.test(q)) return true;
  // Very short questions almost never stand alone ("why?", "and phase 3?").
  if (q.split(/\s+/).length <= 4) return true;
  return false;
}

/**
 * Format recent turns for the rewrite prompt. Only plain text Q&A turns are
 * useful context; attachments and empty turns are skipped.
 */
export function formatHistory(history, maxTurns = MAX_HISTORY_TURNS) {
  return (history || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-maxTurns)
    .map((m) => {
      const text = String(m.content).slice(0, MAX_TURN_CHARS);
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
    })
    .join('\n');
}

/**
 * Rewrite `question` into a standalone question using recent history.
 * Falls back to the original question on any failure — retrieval with the raw
 * question is degraded, not broken, so condensation must never throw.
 */
export async function condenseQuestion(apiKey, history, question, options = {}) {
  const q = String(question || '').trim();
  if (!needsCondensing(q, history)) return q;

  const transcript = formatHistory(history);
  if (!transcript) return q;

  try {
    const data = await chatCompletion(
      apiKey,
      {
        model: options.chatModel ?? getChatModel(),
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: CONDENSE_SYSTEM },
          {
            role: 'user',
            content: `Conversation:\n${transcript}\n\nNew question:\n${q}`,
          },
        ],
      },
      { signal: options.signal }
    );

    const rewritten = data?.choices?.[0]?.message?.content?.trim();
    // Guard against degenerate rewrites (empty, or the model answering instead
    // of rewriting — answers are usually much longer than questions).
    if (!rewritten || rewritten.length > Math.max(300, q.length * 8)) return q;
    return rewritten.replace(/^["'`]+|["'`]+$/g, '');
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return q;
  }
}
