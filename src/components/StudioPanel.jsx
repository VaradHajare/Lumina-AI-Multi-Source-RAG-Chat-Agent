import { useEffect, useState } from 'react';
import { IconClose, IconCards, IconQuiz, IconSparkle, IconCheck } from './Icons.jsx';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

function Flashcards({ cards }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!cards.length) return <p className="studio-empty">No flashcards generated.</p>;

  const card = cards[index];
  const go = (delta) => {
    setFlipped(false);
    setIndex((i) => (i + delta + cards.length) % cards.length);
  };

  return (
    <div className="flashcards">
      <button
        type="button"
        className={`flashcard${flipped ? ' flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-label="Flip card"
      >
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front">
            <span className="flashcard-tag">Question</span>
            <p>{card.front}</p>
            <span className="flashcard-hint">Click to reveal</span>
          </div>
          <div className="flashcard-face flashcard-back">
            <span className="flashcard-tag">Answer</span>
            <p>{card.back}</p>
          </div>
        </div>
      </button>

      <div className="flashcard-nav">
        <button type="button" className="btn btn-outline btn-compact" onClick={() => go(-1)}>
          ← Prev
        </button>
        <span className="flashcard-count">
          {index + 1} / {cards.length}
        </span>
        <button type="button" className="btn btn-outline btn-compact" onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  );
}

function Quiz({ items }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  if (!items.length) return <p className="studio-empty">No quiz questions generated.</p>;

  const score = items.reduce(
    (n, q, i) => (answers[i] === q.answerIndex ? n + 1 : n),
    0
  );
  const allAnswered = items.every((_, i) => answers[i] != null);

  return (
    <div className="quiz">
      {submitted && (
        <div className="quiz-score">
          <strong>{score} / {items.length}</strong> correct
          <button
            type="button"
            className="btn btn-outline btn-compact"
            onClick={() => { setAnswers({}); setSubmitted(false); }}
          >
            Retry
          </button>
        </div>
      )}

      {items.map((q, qi) => (
        <div key={qi} className="quiz-item">
          <p className="quiz-question">
            <span className="quiz-num">{qi + 1}</span>
            {q.question}
          </p>
          <div className="quiz-options">
            {q.options.map((opt, oi) => {
              const picked = answers[qi] === oi;
              const isCorrect = oi === q.answerIndex;
              let state = '';
              if (submitted) {
                if (isCorrect) state = ' correct';
                else if (picked) state = ' wrong';
              } else if (picked) {
                state = ' picked';
              }
              return (
                <button
                  key={oi}
                  type="button"
                  className={`quiz-option${state}`}
                  disabled={submitted}
                  onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                >
                  <span className="quiz-option-mark">{String.fromCharCode(65 + oi)}</span>
                  <span className="quiz-option-text">{opt}</span>
                  {submitted && isCorrect && <IconCheck className="quiz-option-icon" />}
                </button>
              );
            })}
          </div>
          {submitted && q.explanation && (
            <p className="quiz-explanation">{q.explanation}</p>
          )}
        </div>
      ))}

      {!submitted && (
        <button
          type="button"
          className="btn btn-primary btn-full"
          disabled={!allAnswered}
          onClick={() => setSubmitted(true)}
        >
          {allAnswered ? 'Check answers' : 'Answer all questions to submit'}
        </button>
      )}
    </div>
  );
}

export default function StudioPanel({ open, onClose, kit, loading, error, onGenerate }) {
  const [tab, setTab] = useState('flashcards');
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasKit = kit && (kit.flashcards?.length || kit.quiz?.length);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="studio"
        role="dialog"
        aria-label="Study studio"
        aria-modal="true"
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-header">
          <div className="studio-title">
            <IconSparkle />
            <div>
              <h3>Study Studio</h3>
              <p>Turn your sources into flashcards & quizzes</p>
            </div>
          </div>
          <button type="button" className="studio-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {!hasKit && !loading && (
          <div className="studio-cta">
            <p>
              Generate an interactive study kit from the sources in this conversation — flashcards
              for recall and a multiple-choice quiz to test yourself.
            </p>
            {error && <div className="studio-error">{error}</div>}
            <button type="button" className="btn btn-primary" onClick={onGenerate}>
              <IconSparkle /> Generate study kit
            </button>
          </div>
        )}

        {loading && (
          <div className="studio-loading">
            <div className="spinner" />
            <p>Building your study kit…</p>
          </div>
        )}

        {hasKit && !loading && (
          <>
            <div className="studio-tabs">
              <button
                type="button"
                className={`studio-tab${tab === 'flashcards' ? ' active' : ''}`}
                onClick={() => setTab('flashcards')}
              >
                <IconCards /> Flashcards ({kit.flashcards?.length || 0})
              </button>
              <button
                type="button"
                className={`studio-tab${tab === 'quiz' ? ' active' : ''}`}
                onClick={() => setTab('quiz')}
              >
                <IconQuiz /> Quiz ({kit.quiz?.length || 0})
              </button>
              <button
                type="button"
                className="studio-regen"
                onClick={onGenerate}
                title="Regenerate"
              >
                <IconSparkle />
              </button>
            </div>

            <div className="studio-body">
              {tab === 'flashcards' ? (
                <Flashcards cards={kit.flashcards || []} />
              ) : (
                <Quiz items={kit.quiz || []} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
