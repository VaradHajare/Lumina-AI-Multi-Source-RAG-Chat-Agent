import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage.jsx';
import SuggestedQuestions from './SuggestedQuestions.jsx';
import LogoMark from './LogoMark.jsx';
import { IconPdf, IconVideo, IconCards, IconSparkle } from './Icons.jsx';

export default function ChatThread({
  messages,
  busy,
  streamingText,
  suggested,
  onPickSuggestion,
  hasSources,
  onOpenStudio,
  onOpenCitation,
  onRegenerate,
  onVariant,
  regeneratingId,
  tempMode,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, streamingText]);

  const isEmpty = messages.length === 0 && !busy;
  const streaming = streamingText && streamingText.length > 0;
  // When regenerating, the stream renders INTO the existing message, so the
  // bottom streaming/thinking bubbles are suppressed.
  const inPlaceRegen = regeneratingId != null;

  // Index of the most recent assistant answer — only it gets a Regenerate button.
  let lastAnswerIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant' && messages[i].kind === 'text') { lastAnswerIdx = i; break; }
  }

  // Onboarding aids (suggestions + studio prompt) only show before the first
  // real question — once the user starts chatting, the thread stays clean.
  const hasAsked = messages.some((m) => m.role === 'user' && !m.attachment);
  const showOnboarding = hasSources && !busy && !streaming && !hasAsked;

  return (
    <div className="chat-thread">
      {isEmpty && (
        <div className="chat-welcome">
          <div className="chat-welcome-logo">
            <LogoMark size={56} />
          </div>
          <h1 className="chat-welcome-heading">
            {tempMode ? 'Temporary chat' : 'Your sources, made conversational.'}
          </h1>
          <p className="chat-welcome-sub">
            {tempMode
              ? 'Add a source from the panel to start a private, unsaved session. Nothing here is written to your history.'
              : 'Add a PDF, article, or YouTube link from the Sources panel. Lumina reads it, answers with exact citations, and turns it into flashcards & quizzes.'}
          </p>
          <div className="chat-welcome-features">
            <div className="chat-welcome-feature">
              <IconPdf className="chat-welcome-feature-icon" />
              <span>PDF &amp; Articles</span>
            </div>
            <div className="chat-welcome-feature">
              <IconVideo className="chat-welcome-feature-icon" />
              <span>YouTube Videos</span>
            </div>
            <div className="chat-welcome-feature">
              <IconSparkle className="chat-welcome-feature-icon" />
              <span>Cited Q&amp;A</span>
            </div>
            <div className="chat-welcome-feature">
              <IconCards className="chat-welcome-feature-icon" />
              <span>Flashcards &amp; Quiz</span>
            </div>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, index) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            index={index}
            onOpenCitation={onOpenCitation}
            onRegenerate={index === lastAnswerIdx && !busy ? onRegenerate : undefined}
            onVariant={onVariant}
            streamContent={msg.id === regeneratingId ? streamingText : undefined}
          />
        ))}

        {streaming && !inPlaceRegen && (
          <div aria-live="polite" aria-atomic="false">
            <ChatMessage
              message={{ role: 'assistant', kind: 'text', content: streamingText, streaming: true }}
            />
          </div>
        )}

        {busy && !streaming && !inPlaceRegen && messages[messages.length - 1]?.status !== 'thinking' && (
          <ChatMessage
            message={{ role: 'assistant', status: 'thinking', content: 'Thinking…' }}
          />
        )}

        {showOnboarding && (
          <div className="onboarding">
            <SuggestedQuestions
              questions={suggested?.questions}
              loading={suggested?.loading}
              onPick={onPickSuggestion}
              disabled={busy}
            />
            {onOpenStudio && (
              <button type="button" className="onboarding-studio" onClick={onOpenStudio}>
                <IconCards />
                <span>Or turn these sources into flashcards &amp; a quiz</span>
              </button>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
