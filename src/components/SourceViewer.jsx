import { useEffect, useMemo, useRef } from 'react';
import { IconClose, IconPdf, IconVideo, IconLink } from './Icons.jsx';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { locatePassage } from '../utils/highlight.js';

const TYPE_ICON = { pdf: IconPdf, article: IconLink, youtube: IconLink, video: IconVideo };

/**
 * Opens a source document and highlights the exact passage a citation points to.
 * When the full source text is available (the common case) it renders the whole
 * document and marks the precise cited span; otherwise it falls back to rendering
 * the indexed chunks and highlighting the target block.
 */
export default function SourceViewer({ viewer, onClose }) {
  const markRef = useRef(null);
  const trapRef = useFocusTrap(!!viewer);

  const located = useMemo(
    () => (viewer?.text ? locatePassage(viewer.text, viewer.passage) : null),
    [viewer]
  );

  useEffect(() => {
    if (!viewer) return undefined;
    const id = requestAnimationFrame(() => {
      markRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [viewer, located]);

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, onClose]);

  if (!viewer) return null;

  const { title, type, text, chunks, targetId } = viewer;
  const Icon = TYPE_ICON[type] || IconPdf;

  return (
    <div className="sv-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="source-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Source: ${title}`}
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sv-header">
          <div className="sv-title">
            <span className={`sv-type sv-type--${type || 'pdf'}`}><Icon /></span>
            <div className="sv-title-text">
              <h3>{title}</h3>
              <p>{located || (chunks && targetId != null) ? 'Cited passage highlighted' : 'Source document'}</p>
            </div>
          </div>
          <button type="button" className="sv-close" onClick={onClose} aria-label="Close source">
            <IconClose />
          </button>
        </header>

        <div className="sv-body">
          {text ? (
            <div className="sv-doc">
              {located ? (
                <>
                  {located.before}
                  <mark className="sv-mark" ref={markRef}>{located.mark}</mark>
                  {located.after}
                </>
              ) : (
                text
              )}
            </div>
          ) : (
            (chunks || []).map((c) => {
              const isTarget = c.id === targetId;
              return (
                <div
                  key={c.id}
                  ref={isTarget ? markRef : null}
                  className={`sv-chunk${isTarget ? ' sv-target' : ''}`}
                >
                  {c.label && <span className="sv-loc">{c.label}</span>}
                  <p>{c.text}</p>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
