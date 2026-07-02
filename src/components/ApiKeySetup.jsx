import { useState } from 'react';
import { IconLock, IconAlert } from './Icons.jsx';

export default function ApiKeySetup({ onSave }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed.startsWith('sk-or-')) {
      setError('OpenRouter API keys start with sk-or-. Check your key and try again.');
      return;
    }
    setError('');
    onSave(trimmed);
  };

  return (
    <div className="api-banner">
      <div className="api-banner-row">
        <div className="api-banner-icon-wrap" aria-hidden>
          <IconLock />
        </div>
        <div className="api-banner-text">
          <strong>API key required</strong>
          <br />
          Stored in this browser only (localStorage). Used only to call OpenRouter.
          Get a key at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
          .
        </div>
      </div>

      <div className="api-banner-actions input-row">
        <input
          className="text-input"
          type="password"
          placeholder="sk-or-v1-…"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
          autoComplete="off"
        />
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!value.trim()}>
          Save
        </button>
      </div>

      {error && (
        <div className="field-error" role="alert">
          <IconAlert />
          <span>{error}</span>
        </div>
      )}

      <p className="api-banner-tip">
        Optional: set <code>VITE_OPENROUTER_API_KEY</code> in <code>.env</code> to skip this step in development.
      </p>
    </div>
  );
}
