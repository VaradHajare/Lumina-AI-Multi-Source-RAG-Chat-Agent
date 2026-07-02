import { useEffect } from 'react';
import { CHAT_MODELS } from '../utils/settings.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { IconClose, IconSettings } from './Icons.jsx';

export default function SettingsModal({ open, onClose, model, onChangeModel }) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <div className="settings-title">
            <IconSettings />
            <h3>Settings</h3>
          </div>
          <button type="button" className="sv-close" onClick={onClose} aria-label="Close settings">
            <IconClose />
          </button>
        </div>

        <div className="settings-section">
          <p className="settings-label">Chat model</p>
          <p className="settings-desc">
            Used for answers, analysis, and study material. Routed through OpenRouter.
          </p>
          <div className="settings-models">
            {CHAT_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`settings-model${model === m.id ? ' active' : ''}`}
                onClick={() => onChangeModel(m.id)}
              >
                <span className="settings-model-name">{m.label}</span>
                <span className="settings-model-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
