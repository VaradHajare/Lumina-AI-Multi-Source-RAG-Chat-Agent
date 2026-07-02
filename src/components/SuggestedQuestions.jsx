import { IconSparkle } from './Icons.jsx';

/** Smart starter prompts derived from the active sources. */
export default function SuggestedQuestions({ questions, loading, onPick, disabled }) {
  if (!loading && (!questions || questions.length === 0)) return null;

  return (
    <div className="suggested" aria-label="Suggested questions">
      <div className="suggested-label">
        <IconSparkle /> Suggested questions
      </div>
      <div className="suggested-list">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className="suggested-chip suggested-chip--skeleton" />
            ))
          : questions.map((q, i) => (
              <button
                key={i}
                type="button"
                className="suggested-chip"
                onClick={() => onPick(q)}
                disabled={disabled}
              >
                {q}
              </button>
            ))}
      </div>
    </div>
  );
}
