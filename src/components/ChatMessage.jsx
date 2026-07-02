import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import AnalysisCard from './AnalysisCard.jsx';

const CodeBlock = lazy(() => import('./CodeBlock.jsx'));
import { IconCopy, IconSpeaker, IconSpeakerOff, IconRefresh } from './Icons.jsx';
import { useSpeech } from '../hooks/useSpeech.js';

export default function ChatMessage({ message, onOpenCitation, onRegenerate, onVariant, streamContent }) {
  const { role, kind, analysis, status } = message;
  // While regenerating, `streamContent` renders into this message in place.
  const isStreaming = message.streaming || streamContent !== undefined;
  const content = streamContent !== undefined ? streamContent : message.content;
  const citations = isStreaming ? undefined : message.citations;
  const citationByRef = (ref) => citations?.find((c) => String(c.ref) === String(ref));
  const speech = useSpeech(content);

  const variants = message.variants;
  const activeVariant = variants ? (message.activeVariant ?? variants.length - 1) : 0;
  const [copied, setCopied] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef(null);

  // Only animate once on mount, never replay on re-render
  useEffect(() => {
    const el = ref.current;
    if (!el || hasAnimated) return;
    const handleEnd = () => setHasAnimated(true);
    el.addEventListener('animationend', handleEnd, { once: true });
    return () => el.removeEventListener('animationend', handleEnd);
  }, [hasAnimated]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  if (status === 'thinking') {
    return (
      <div className="msg msg--assistant msg--thinking">
        <div className="msg-avatar">L</div>
        <div className="msg-body">
          <div className="msg-thinking">
            <span /><span /><span />
            <span className="msg-thinking-text">{content || 'Working…'}</span>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div
        ref={ref}
        className={`msg msg--user${!hasAnimated ? ' msg--animate' : ''}`}
      >
        <div className="msg-body">
          {message.attachment && (
            <div className="msg-attachment">
              {message.attachment.label}
            </div>
          )}
          <div className="msg-text">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`msg msg--assistant${!hasAnimated ? ' msg--animate' : ''}`}
    >
      <div className="msg-avatar">L</div>
      <div className="msg-body">
        {kind === 'analysis' && analysis ? (
          <AnalysisCard analysis={analysis} />
        ) : (
          <>
            <div className="msg-text msg-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: ({ node, ...props }) => {
                    if (props.href?.startsWith('#citation-')) {
                      const ref = props.href.replace('#citation-', '');
                      return (
                        <sup className="citation-link">
                          <a
                            {...props}
                            title="Open source passage"
                            onClick={(e) => {
                              e.preventDefault();
                              const cit = citationByRef(ref);
                              if (cit) onOpenCitation?.(cit);
                            }}
                          />
                        </sup>
                      );
                    }
                    return <a target="_blank" rel="noopener noreferrer" {...props} />;
                  },
                  code: ({ node, className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeStr = String(children).replace(/\n$/, '');
                    const isBlock = match || codeStr.includes('\n');
                    
                    if (isBlock) {
                      const lang = match ? match[1] : 'text';
                      return (
                        <Suspense
                          fallback={<pre className="code-block-fallback">{codeStr}</pre>}
                        >
                          <CodeBlock code={codeStr} lang={lang} />
                        </Suspense>
                      );
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }
                }}
              >
                {(() => {
                  let processedContent = content || '';
                  
                  // Fix AI appending citations directly to the closing backticks (e.g. ```[1])
                  processedContent = processedContent.replace(/```\s*\[(\d+)\]/g, '```\n[$1]');
                  
                  // Fix unclosed code blocks
                  const blockCount = (processedContent.match(/```/g) || []).length;
                  if (blockCount % 2 !== 0) {
                    if (processedContent.includes('\nSources:')) {
                      processedContent = processedContent.replace('\nSources:', '\n```\nSources:');
                    } else {
                      processedContent += '\n```';
                    }
                  }

                  if (citations && citations.length > 0) {
                    const validRefs = citations.map(c => String(c.ref));
                    const parts = processedContent.split(/(```[\s\S]*?```|`[^`]+`)/g);
                    processedContent = parts.map((part, i) => {
                      if (i % 2 === 0) {
                        return part.replace(/(^|[^\w])\[(\d+)\]/g, (match, prefix, num) => {
                          if (validRefs.includes(num)) {
                            return `${prefix}[\\[${num}\\]](#citation-${num})`;
                          }
                          return match;
                        });
                      }
                      return part;
                    }).join('');
                  }
                  return processedContent;
                })()}
              </ReactMarkdown>
              {isStreaming && <span className="stream-cursor" aria-hidden />}
            </div>
            {!isStreaming && (
              <div className="msg-actions">
                {variants && variants.length > 1 && (
                  <div className="msg-variants" role="group" aria-label="Answer versions">
                    <button
                      type="button"
                      className="msg-variant-nav"
                      onClick={() => onVariant?.(message.id, activeVariant - 1)}
                      disabled={activeVariant === 0}
                      aria-label="Previous version"
                    >
                      ‹
                    </button>
                    <span className="msg-variant-count">{activeVariant + 1}/{variants.length}</span>
                    <button
                      type="button"
                      className="msg-variant-nav"
                      onClick={() => onVariant?.(message.id, activeVariant + 1)}
                      disabled={activeVariant === variants.length - 1}
                      aria-label="Next version"
                    >
                      ›
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={handleCopy}
                  aria-label="Copy message"
                >
                  <IconCopy />
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                {speech.supported && (
                  <button
                    type="button"
                    className={`msg-action-btn${speech.speaking ? ' active' : ''}`}
                    onClick={speech.toggle}
                    aria-label={speech.speaking ? 'Stop reading' : 'Read aloud'}
                  >
                    {speech.speaking ? <IconSpeakerOff /> : <IconSpeaker />}
                    <span>{speech.speaking ? 'Stop' : 'Listen'}</span>
                  </button>
                )}
                {onRegenerate && (
                  <button
                    type="button"
                    className="msg-action-btn"
                    onClick={onRegenerate}
                    aria-label="Regenerate answer"
                  >
                    <IconRefresh />
                    <span>Regenerate</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {citations?.length > 0 && (() => {
          // Group passages under each source so the document name isn't repeated.
          const groups = [];
          const byKey = new Map();
          for (const c of citations) {
            const key = c.source || 'Source';
            if (!byKey.has(key)) {
              const g = { key, source: c.source, sourceType: c.sourceType, items: [] };
              byKey.set(key, g);
              groups.push(g);
            }
            byKey.get(key).items.push(c);
          }
          return (
            <details className="msg-sources">
              <summary>
                {citations.length} cited {citations.length === 1 ? 'passage' : 'passages'}
                {groups.length > 1 ? ` · ${groups.length} sources` : ''}
              </summary>
              <div className="cite-groups">
                {groups.map((g) => (
                  <div className="cite-group" key={g.key}>
                    {g.source && (
                      <div className={`cite-group-head cite-group-head--${g.sourceType || 'pdf'}`}>
                        {g.source}
                      </div>
                    )}
                    <ul>
                      {g.items.map((c) => (
                        <li key={c.ref} id={`citation-${c.ref}`}>
                          <button
                            type="button"
                            className="cite-item"
                            onClick={() => onOpenCitation?.(c)}
                            title="Open this passage in the source"
                          >
                            <span className="cite-ref">[{c.ref}]</span>
                            {c.label && <span className="cite-loc">{c.label}</span>}
                            <span className="cite-excerpt">{c.excerpt}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          );
        })()}
      </div>
    </div>
  );
}
