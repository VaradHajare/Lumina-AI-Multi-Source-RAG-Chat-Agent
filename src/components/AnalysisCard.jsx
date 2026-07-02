import { IconSparkle, IconSpeaker, IconSpeakerOff } from './Icons.jsx';
import { useSpeech } from '../hooks/useSpeech.js';

/** Split summary prose into paragraphs for readable rendering. */
function toParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function AnalysisCard({ analysis }) {
  // New sources produce `summary`; fall back to legacy `overview` + topics.
  const summary =
    analysis?.summary ||
    [analysis?.overview, ...(analysis?.topics || []).map((t) => t.summary)]
      .filter(Boolean)
      .join('\n\n');

  const paragraphs = toParagraphs(summary);
  const wordCount = summary ? summary.trim().split(/\s+/).length : 0;
  const speech = useSpeech(summary);

  if (!paragraphs.length) return null;

  return (
    <div className="analysis-card">
      <div className="analysis-summary">
        <div className="analysis-summary-label">
          <IconSparkle /> Summary
          <span className="analysis-summary-count">{wordCount} words</span>
          {speech.supported && (
            <button
              type="button"
              className={`analysis-audio-btn${speech.speaking ? ' active' : ''}`}
              onClick={speech.toggle}
              aria-label={speech.speaking ? 'Stop audio overview' : 'Play audio overview'}
            >
              {speech.speaking ? <IconSpeakerOff /> : <IconSpeaker />}
              <span>{speech.speaking ? 'Stop' : 'Listen'}</span>
            </button>
          )}
        </div>
        <div className="analysis-summary-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
