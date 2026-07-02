import { useState } from 'react';

const STORAGE_KEY = 'lumina_openrouter_api_key';
const ENV_KEY     = import.meta.env.VITE_OPENROUTER_API_KEY;

/**
 * Manages the OpenRouter API key — prefers .env, then localStorage, then user input.
 */
export function useApiKey() {
  const [apiKey, setApiKeyState] = useState(() => {
    if (ENV_KEY && ENV_KEY !== 'your_openrouter_api_key_here') return ENV_KEY;
    return localStorage.getItem(STORAGE_KEY) || localStorage.getItem('lumina_groq_api_key') || '';
  });

  const [showInput, setShowInput] = useState(!apiKey);

  const setApiKey = (key) => {
    const trimmed = key.trim();
    setApiKeyState(trimmed);
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
      localStorage.removeItem('lumina_groq_api_key');
      setShowInput(false);
    }
  };

  const clearApiKey = () => {
    setApiKeyState('');
    localStorage.removeItem(STORAGE_KEY);
    setShowInput(true);
  };

  return { apiKey, setApiKey, clearApiKey, showInput, setShowInput };
}
