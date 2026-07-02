import { useRef, useEffect } from 'react';
import { IconSend, IconStop, IconFocus } from './Icons.jsx';

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  busy,
  hasSources,
  sources = [],
  focusSourceId,
  onChangeFocus,
}) {
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [value]);

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !busy && value.trim()) {
        onSend();
      }
    }
  };

  const canSend = !disabled && !busy && value.trim();
  const showFocus = hasSources && sources.length > 1;

  return (
    <div className="composer">
      {showFocus && (
        <div className="composer-focus">
          <IconFocus />
          <label htmlFor="focus-select">Ask</label>
          <select
            id="focus-select"
            className="composer-focus-select"
            value={focusSourceId || ''}
            onChange={(e) => onChangeFocus(e.target.value || null)}
            disabled={busy}
          >
            <option value="">all sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="composer-row">
        <textarea
          ref={textareaRef}
          id="composer-input"
          className="composer-input"
          rows={1}
          placeholder={
            hasSources
              ? 'Ask a question about your sources…'
              : 'Add sources, then ask questions here…'
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || busy}
        />

        {busy ? (
          <button
            type="button"
            className="composer-send composer-stop ready"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <IconStop />
          </button>
        ) : (
          <button
            type="button"
            className={`composer-send${canSend ? ' ready' : ''}`}
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <IconSend />
          </button>
        )}
      </div>

      <p className="composer-hint">
        Lumina answers only from your sources, with citations. Press Enter to send.
      </p>
    </div>
  );
}
