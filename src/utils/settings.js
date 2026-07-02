// ── User settings (persisted in localStorage) ─────────────────────────────────

const MODEL_KEY = 'lumina-chat-model';

/** Curated OpenRouter chat models. First entry is the default. */
export const CHAT_MODELS = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Fast · long context' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', hint: 'Fast · reliable' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', hint: 'Strong reasoning' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', hint: 'Great writing' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', hint: 'Open model' },
];

export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id;

export function getChatModel() {
  try {
    return localStorage.getItem(MODEL_KEY) || DEFAULT_CHAT_MODEL;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}

export function setChatModel(id) {
  try {
    localStorage.setItem(MODEL_KEY, id || DEFAULT_CHAT_MODEL);
  } catch {
    /* ignore */
  }
}
