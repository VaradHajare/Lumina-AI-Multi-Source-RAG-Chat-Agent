import { useRef } from 'react';
import { IconPdf, IconVideo, IconLink, IconClose, IconCards } from './Icons.jsx';

const TYPE_ICONS = {
  pdf: IconPdf,
  article: IconLink,
  youtube: IconLink,
  video: IconVideo,
};

function SourceIcon({ type }) {
  const Icon = TYPE_ICONS[type] || IconPdf;
  return <Icon className="sources-item-icon" />;
}

export default function SourcesPanel({
  sources,
  busy,
  disabled,
  onAddPdf,
  onAddUrl,
  onRemoveSource,
  panelOpen,
  onClosePanel,
  onOpenStudio,
  studioDisabled,
}) {
  const pdfRef = useRef(null);

  return (
    <>
      {panelOpen && (
        <button
          type="button"
          className="sources-backdrop"
          onClick={onClosePanel}
          aria-label="Close sources panel"
        />
      )}

      <aside className={`sources-panel${panelOpen ? ' open' : ''}`}>
        <div className="sources-header">
          <h2>Sources</h2>
          {sources.length > 0 && (
            <span className="sources-count">{sources.length}</span>
          )}
        </div>

        <div className="sources-list" aria-label="Added sources">
          {sources.length === 0 && (
            <p className="sources-empty">
              Add PDFs, links, or videos here. Lumina will analyze them so you can ask questions in chat.
            </p>
          )}

          {sources.map((source) => (
            <div
              key={source.id}
              className={`sources-item${source.status === 'loading' ? ' loading' : ''}`}
            >
              <SourceIcon type={source.type} />
              <div className="sources-item-body">
                <span className="sources-item-title">
                  {source.title || source.label}
                </span>
                <span className="sources-item-meta">
                  {source.status === 'loading'
                    ? source.message || 'Analyzing…'
                    : source.status === 'error'
                      ? source.error || 'Failed'
                      : source.type}
                </span>
                {source.status === 'loading' && (
                  <div className="sources-item-progress">
                    <div
                      className="sources-item-progress-fill"
                      style={{ width: `${Math.max(6, Math.min(100, source.progress || 0))}%` }}
                    />
                  </div>
                )}
              </div>
              {source.status !== 'loading' && onRemoveSource && (
                <button
                  type="button"
                  className="sources-item-remove"
                  onClick={() => onRemoveSource(source.id)}
                  aria-label={`Remove ${source.title || source.label}`}
                  disabled={busy}
                >
                  <IconClose />
                </button>
              )}
            </div>
          ))}
        </div>

        {onOpenStudio && (
          <div className="sources-studio">
            <button
              type="button"
              className="sources-studio-btn"
              onClick={onOpenStudio}
              disabled={studioDisabled}
            >
              <IconCards />
              <span>Study Studio</span>
            </button>
            <p className="sources-studio-hint">Flashcards &amp; quiz from your sources</p>
          </div>
        )}

        <div className="sources-add">
          <p className="sources-add-label">Add source</p>
          <div className="sources-add-grid">
            <button
              type="button"
              className="sources-add-btn"
              disabled={disabled || busy}
              onClick={() => pdfRef.current?.click()}
            >
              <IconPdf />
              <span>PDF</span>
            </button>
            <button
              type="button"
              className="sources-add-btn"
              disabled={disabled || busy}
              onClick={onAddUrl}
            >
              <IconLink />
              <span>Link</span>
            </button>
          </div>
          <p className="sources-add-hint">Link supports web articles &amp; YouTube videos</p>
        </div>

        <input
          ref={pdfRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAddPdf(file);
            e.target.value = '';
          }}
        />
      </aside>
    </>
  );
}
