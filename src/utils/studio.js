// ── Studio: generative study tools on top of indexed sources ──────────────────
//
// These turn passive sources into active study material — the core of what makes
// Lumina more than a "chat with your docs" clone:
//   • suggested questions  → smart starter prompts after a source is added
//   • flashcards           → spaced-recall Q/A pairs
//   • quiz                 → multiple-choice questions with explanations

import { chatCompletion } from './openrouter.js';
import { getChatModel } from './settings.js';

/** Trim a source corpus so generation stays inside a comfortable context budget. */
function clampContext(text, max = 18_000) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max)}\n\n[Content truncated for length]` : t;
}

function parseJsonLoose(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/** Coerce a model response into a clean list of question strings. */
export function normalizeQuestions(parsed) {
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list.map((q) => String(q).trim()).filter(Boolean).slice(0, 4);
}

/** Validate/normalize a study-kit payload, dropping malformed items. */
export function normalizeStudyKit(parsed) {
  const flashcards = (Array.isArray(parsed?.flashcards) ? parsed.flashcards : [])
    .map((c) => ({ front: String(c?.front || '').trim(), back: String(c?.back || '').trim() }))
    .filter((c) => c.front && c.back);

  const quiz = (Array.isArray(parsed?.quiz) ? parsed.quiz : [])
    .map((q) => ({
      question: String(q?.question || '').trim(),
      options: (Array.isArray(q?.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
      answerIndex: Number.isInteger(q?.answerIndex) ? q.answerIndex : 0,
      explanation: String(q?.explanation || '').trim(),
    }))
    .filter((q) => q.question && q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4);

  return { flashcards, quiz };
}

/**
 * Generate 4 short, specific starter questions a curious reader would ask.
 * Returns string[] (empty array on any failure — this is a non-critical nicety).
 */
export async function generateSuggestedQuestions(apiKey, sourceText, { signal } = {}) {
  if (!apiKey || !sourceText?.trim()) return [];

  try {
    const data = await chatCompletion(
      apiKey,
      {
        model: getChatModel(),
        temperature: 0.4,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You generate insightful starter questions about a document. ' +
              'Return ONLY JSON: {"questions": ["...", "...", "...", "..."]}. ' +
              'Each question must be answerable from the content, specific (not "what is this about"), ' +
              'and under 12 words.',
          },
          { role: 'user', content: `Content:\n\n${clampContext(sourceText, 12_000)}` },
        ],
      },
      { signal }
    );
    const raw = data?.choices?.[0]?.message?.content ?? '';
    return normalizeQuestions(parseJsonLoose(raw));
  } catch {
    return [];
  }
}

/**
 * Generate a study kit: flashcards + a multiple-choice quiz.
 * Returns { flashcards: [{front, back}], quiz: [{question, options[4], answerIndex, explanation}] }.
 */
export async function generateStudyKit(apiKey, sourceText, { signal, counts } = {}) {
  if (!apiKey) throw new Error('Add your OpenRouter API key first.');
  if (!sourceText?.trim()) throw new Error('Add a source before generating study material.');

  const cardCount = counts?.flashcards ?? 8;
  const quizCount = counts?.quiz ?? 5;

  const data = await chatCompletion(
    apiKey,
    {
      model: getChatModel(),
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an expert tutor. Create study material STRICTLY from the provided content. ' +
            'Return ONLY valid JSON with this exact schema:\n' +
            '{\n' +
            '  "flashcards": [{ "front": "<question/term>", "back": "<concise answer>" }],\n' +
            '  "quiz": [{ "question": "<question>", "options": ["a","b","c","d"], "answerIndex": <0-3>, "explanation": "<why>" }]\n' +
            '}\n' +
            `Create exactly ${cardCount} flashcards and ${quizCount} quiz questions. ` +
            'Every quiz item must have exactly 4 plausible options and one correct answerIndex. ' +
            'Do not invent facts beyond the content.',
        },
        { role: 'user', content: `Content:\n\n${clampContext(sourceText)}` },
      ],
    },
    { signal }
  );

  const raw = data?.choices?.[0]?.message?.content ?? '';
  let parsed;
  try {
    parsed = parseJsonLoose(raw);
  } catch {
    throw new Error('Could not generate study material — the model returned unexpected output. Try again.');
  }

  const { flashcards, quiz } = normalizeStudyKit(parsed);

  if (!flashcards.length && !quiz.length) {
    throw new Error('No study material could be generated from these sources.');
  }

  return { flashcards, quiz };
}
