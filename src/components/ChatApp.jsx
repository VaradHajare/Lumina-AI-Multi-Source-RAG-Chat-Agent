import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiKey } from '../hooks/useApiKey.js';
import { useTheme } from '../hooks/useTheme.js';
import {
  analysePDF,
  analyseArticleUrl,
  analyseYouTube,
  getYouTubeId,
  normalizeArticleUrl,
} from '../utils/analysis.js';
import { buildRagIndex, askWithRagStream } from '../utils/rag.js';
import { analysisTitle } from '../utils/formatAnalysis.js';
import { generateSuggestedQuestions, generateStudyKit } from '../utils/studio.js';
import { exportConversationMarkdown } from '../utils/exportChat.js';
import {
  addMessage,
  createConversation,
  deleteConversation,
  subscribeConversations,
  subscribeMessages,
  updateConversation,
  updateMessage,
} from '../lib/chatStore.js';

import Sidebar from './Sidebar.jsx';
import SourcesPanel from './SourcesPanel.jsx';
import ChatThread from './ChatThread.jsx';
import ChatComposer from './ChatComposer.jsx';
import ApiKeySetup from './ApiKeySetup.jsx';
import StudioPanel from './StudioPanel.jsx';
import SourceViewer from './SourceViewer.jsx';
import SettingsModal from './SettingsModal.jsx';
import { getChatModel, setChatModel } from '../utils/settings.js';
import { IconMoon, IconSun, IconCards, IconDownload, IconGhost, IconMenu, IconSettings } from './Icons.jsx';

function sourcesFromConversation(conv) {
  if (!conv) return [];
  if (Array.isArray(conv.sources) && conv.sources.length) {
    return conv.sources.map((s) => ({ ...s, status: s.status || 'ready' }));
  }
  if (conv.sourceText) {
    return [
      {
        id: `${conv.id}-legacy`,
        type: conv.sourceType || 'pdf',
        label: conv.sourceTitle || conv.title,
        title: conv.sourceTitle || conv.title,
        sourceText: conv.sourceText,
        status: 'ready',
      },
    ];
  }
  return [];
}

function combineSourceTexts(sources) {
  return sources
    .filter((s) => s.sourceText?.trim())
    .map((s) => `[Source: ${s.title || s.label}]\n${s.sourceText}`)
    .join('\n\n');
}

/** Structured source list for source-aware RAG indexing. */
function structuredSources(sources) {
  return sources
    .filter((s) => s.sourceText?.trim())
    .map((s) => ({ id: s.id, title: s.title || s.label, type: s.type, text: s.sourceText }));
}

export default function ChatApp() {
  const { apiKey, setApiKey, showInput } = useApiKey();
  const { theme, toggleTheme } = useTheme();

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [storeMessages, setStoreMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingSources, setPendingSources] = useState([]);
  const [ragIndex, setRagIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false);
  const [urlPromptOpen, setUrlPromptOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');

  const [suggested, setSuggested] = useState({ questions: [], loading: false });
  const [focusSourceId, setFocusSourceId] = useState(null);

  const [studioOpen, setStudioOpen] = useState(false);
  const [studioKit, setStudioKit] = useState(null);
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioError, setStudioError] = useState('');

  const [viewer, setViewer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState(getChatModel);
  const [lastFailed, setLastFailed] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);

  // Temporary chat — lives only in memory, never written to history.
  const [tempMode, setTempMode] = useState(false);
  const [tempMessages, setTempMessages] = useState([]);
  const [tempSources, setTempSources] = useState([]);

  const abortRef = useRef(null);
  const suggestRef = useRef(null);
  const ragCacheRef = useRef(new Map());

  const changeModel = (id) => {
    setChatModel(id);
    setModel(id);
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const messages = tempMode ? tempMessages : storeMessages;
  const persistedSources = useMemo(
    () => (tempMode ? tempSources : sourcesFromConversation(activeConv)),
    [tempMode, tempSources, activeConv]
  );
  const sources = useMemo(
    () => [...persistedSources, ...pendingSources],
    [persistedSources, pendingSources]
  );
  const readySources = persistedSources.filter((s) => s.status === 'ready' && s.sourceText);
  const hasReadySources = readySources.length > 0;

  useEffect(() => {
    return subscribeConversations(null, setConversations, (e) => console.error(e));
  }, []);

  useEffect(() => {
    if (!activeConvId || tempMode) {
      setStoreMessages([]);
      return undefined;
    }
    return subscribeMessages(null, activeConvId, setStoreMessages, (e) => console.error(e));
  }, [activeConvId, tempMode]);

  // Keep the source-focus selection valid as sources change.
  useEffect(() => {
    if (focusSourceId && !readySources.some((s) => s.id === focusSourceId)) {
      setFocusSourceId(null);
    }
  }, [focusSourceId, readySources]);

  const addTempMessage = useCallback((msg) => {
    setTempMessages((prev) => [...prev, { id: crypto.randomUUID(), createdAt: Date.now(), ...msg }]);
  }, []);

  // A signature that changes only when the set/content of sources changes, so we
  // can reuse an already-embedded index instead of paying to re-embed on reopen.
  const indexSignature = (structured) =>
    structured.map((s) => s.id).join('|') + '#' + structured.reduce((n, s) => n + s.text.length, 0);

  const cacheIndex = useCallback((sourceList, index) => {
    const structured = structuredSources(sourceList);
    if (structured.length && index) ragCacheRef.current.set(indexSignature(structured), index);
  }, []);

  const rebuildRag = useCallback(
    async (sourceList) => {
      const structured = structuredSources(sourceList);
      if (!apiKey || !structured.length) {
        setRagIndex(null);
        return null;
      }
      const sig = indexSignature(structured);
      const cached = ragCacheRef.current.get(sig);
      if (cached) {
        setRagIndex(cached);
        return cached;
      }
      const index = await buildRagIndex(apiKey, structured, 'mixed');
      ragCacheRef.current.set(sig, index);
      setRagIndex(index);
      return index;
    },
    [apiKey]
  );

  const refreshSuggestions = useCallback(
    async (sourceList, convId) => {
      const combined = combineSourceTexts(sourceList);
      if (!apiKey || !combined.trim()) {
        setSuggested({ questions: [], loading: false });
        return;
      }
      const token = {};
      suggestRef.current = token;
      setSuggested({ questions: [], loading: true });
      const questions = await generateSuggestedQuestions(apiKey, combined);
      if (suggestRef.current === token) {
        setSuggested({ questions, loading: false });
        // Persist so we don't regenerate (and re-pay) on every reopen.
        if (convId && questions.length) {
          updateConversation(null, convId, { suggested: questions }).catch(() => {});
        }
      }
    },
    [apiKey]
  );

  const resetTransient = () => {
    setInput('');
    setError('');
    setFocusSourceId(null);
    setSuggested({ questions: [], loading: false });
    setStudioKit(null);
    setStudioError('');
    setStreamingText('');
  };

  const loadConversationContext = useCallback(
    async (conv) => {
      // Restore any saved study kit for this conversation.
      setStudioKit(conv?.studioKit || null);

      const list = sourcesFromConversation(conv);
      if (list.length && apiKey) {
        setBusy(true);
        try {
          await rebuildRag(list);
        } finally {
          setBusy(false);
        }
        // Use stored suggestions if present; otherwise generate once and save.
        if (Array.isArray(conv?.suggested) && conv.suggested.length) {
          setSuggested({ questions: conv.suggested, loading: false });
        } else {
          void refreshSuggestions(list, conv?.id);
        }
      } else {
        setRagIndex(null);
        setSuggested({ questions: [], loading: false });
      }
    },
    [apiKey, rebuildRag, refreshSuggestions]
  );

  const selectConversation = async (convId) => {
    setTempMode(false);
    setTempMessages([]);
    setTempSources([]);
    setActiveConvId(convId);
    setSidebarOpen(false);
    setPendingSources([]);
    resetTransient();
    const conv = conversations.find((c) => c.id === convId);
    if (conv) await loadConversationContext(conv);
  };

  const startNewChat = () => {
    setTempMode(false);
    setTempMessages([]);
    setTempSources([]);
    setActiveConvId(null);
    setStoreMessages([]);
    setRagIndex(null);
    setPendingSources([]);
    setSidebarOpen(false);
    resetTransient();
  };

  const startTemporaryChat = () => {
    setActiveConvId(null);
    setStoreMessages([]);
    setTempMessages([]);
    setTempSources([]);
    setRagIndex(null);
    setPendingSources([]);
    setSidebarOpen(false);
    resetTransient();
    setTempMode(true);
  };

  const handleDeleteChat = async (convId) => {
    await deleteConversation(null, convId);
    if (activeConvId === convId) {
      startNewChat();
    }
  };

  const persistSources = async (convId, sourceList, title) => {
    const combined = combineSourceTexts(sourceList);
    await updateConversation(null, convId, {
      sources: sourceList.map(({ id, type, label, title: t, sourceText }) => ({
        id,
        type,
        label,
        title: t,
        sourceText,
      })),
      sourceText: combined || null,
      sourceType: sourceList.length > 1 ? 'mixed' : sourceList[0]?.type || null,
      sourceTitle: title,
      title,
    });
  };

  const addSource = async (attachment) => {
    if (!apiKey) {
      setError('Add your OpenRouter API key to continue.');
      return;
    }

    const pendingId = crypto.randomUUID();
    setPendingSources((prev) => [
      ...prev,
      { id: pendingId, type: attachment.type, label: attachment.label, status: 'loading' },
    ]);
    setBusy(true);
    setError('');

    try {
      // Surface real extraction/analysis progress on the pending source card.
      const onProgress = (pct, msg) => {
        setPendingSources((prev) =>
          prev.map((s) => (s.id === pendingId ? { ...s, progress: pct, message: msg } : s))
        );
      };
      let analysisResult;
      let attachLabel = attachment.label;

      if (attachment.type === 'pdf') {
        analysisResult = await analysePDF(apiKey, attachment.file, onProgress);
      } else if (attachment.type === 'article') {
        analysisResult = await analyseArticleUrl(apiKey, attachment.url, onProgress);
        attachLabel = attachment.url;
      } else if (attachment.type === 'youtube') {
        analysisResult = await analyseYouTube(apiKey, attachment.url, onProgress);
        attachLabel = attachment.url;
      } else {
        throw new Error('Unsupported source type.');
      }

      const { analysis, sourceText: src } = analysisResult;
      const title = analysisTitle(analysis);
      const readySource = {
        id: crypto.randomUUID(),
        type: analysis.source_type,
        label: attachLabel,
        title,
        sourceText: src,
        status: 'ready',
      };

      setPendingSources((prev) => prev.filter((s) => s.id !== pendingId));
      const nextSources = [...persistedSources, readySource];

      const userMsg = {
        role: 'user',
        content: `Added source: ${attachLabel}`,
        attachment: { label: attachLabel, type: attachment.type },
      };
      const analysisMsg = { role: 'assistant', kind: 'analysis', content: title, analysis };

      if (nextSources.length === 1) {
        setRagIndex(analysisResult.ragIndex);
        cacheIndex(nextSources, analysisResult.ragIndex);
      } else {
        await rebuildRag(nextSources);
      }

      let convId = activeConvId;
      if (tempMode) {
        setTempSources(nextSources);
        addTempMessage(userMsg);
        addTempMessage(analysisMsg);
      } else {
        if (!convId) {
          convId = await createConversation(null, {
            title,
            sources: nextSources.map(({ id, type, label, title: t, sourceText }) => ({
              id, type, label, title: t, sourceText,
            })),
            sourceType: analysis.source_type,
            sourceTitle: title,
            sourceText: src,
          });
          setActiveConvId(convId);
        } else {
          await persistSources(convId, nextSources, title);
        }

        await addMessage(null, convId, { ...userMsg, conversationTitle: title });
        await addMessage(null, convId, analysisMsg);
      }

      setStudioKit(null);
      void refreshSuggestions(nextSources, tempMode ? null : convId);
    } catch (e) {
      setPendingSources((prev) =>
        prev.map((s) =>
          s.id === pendingId
            ? { ...s, status: 'error', error: e.message || 'Analysis failed.' }
            : s
        )
      );
      setError(e.message || 'Analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const removeSource = async (sourceId) => {
    if (busy) return;
    if (!tempMode && !activeConvId) return;
    const nextSources = persistedSources.filter((s) => s.id !== sourceId);
    setBusy(true);
    setError('');
    try {
      if (tempMode) {
        setTempSources(nextSources);
      } else {
        const title = nextSources[0]?.title || activeConv?.title || 'New chat';
        await persistSources(activeConvId, nextSources, title);
      }
      await rebuildRag(nextSources);
      setStudioKit(null);
      void refreshSuggestions(nextSources, tempMode ? null : activeConvId);
    } catch (e) {
      setError(e.message || 'Could not remove source.');
    } finally {
      setBusy(false);
    }
  };

  const patchMessage = async (messageId, patch) => {
    if (tempMode) {
      setTempMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
    } else {
      await updateMessage(null, activeConvId, messageId, patch);
    }
  };

  // Switch which regenerated variant of an answer is shown (‹ 1/2 ›).
  const setMessageVariant = (messageId, index) => {
    const msg = messages.find((m) => m.id === messageId);
    const variant = msg?.variants?.[index];
    if (!variant) return;
    void patchMessage(messageId, {
      activeVariant: index,
      content: variant.content,
      citations: variant.citations,
    });
  };

  const runQuestion = async (question, { skipUserMessage = false, regenerateInto = null } = {}) => {
    if (!apiKey) {
      setError('Add your OpenRouter API key to continue.');
      return;
    }
    if (!ragIndex?.chunks?.length) {
      setError('Add a source first, then ask your question.');
      return;
    }
    if (!tempMode && !activeConvId) {
      setError('Add a source to start.');
      return;
    }

    setBusy(true);
    setError('');
    setLastFailed(null);
    setStreamingText('');
    if (regenerateInto) setRegeneratingId(regenerateInto);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';
    const convId = activeConvId;

    const append = async (msg) => {
      if (tempMode) addTempMessage(msg);
      else await addMessage(null, convId, msg);
    };

    // Append the result as a new variant of an existing answer, preserving prior ones.
    const writeVariant = async (messageId, answer, citations) => {
      const target = messages.find((m) => m.id === messageId);
      const existing = target?.variants || [
        { content: target?.content ?? '', citations: target?.citations ?? [] },
      ];
      const variants = [...existing, { content: answer, citations: citations || [] }];
      await patchMessage(messageId, {
        variants,
        activeVariant: variants.length - 1,
        content: answer,
        citations: citations || [],
      });
    };

    try {
      if (!skipUserMessage) await append({ role: 'user', content: question });

      // Prior turns give follow-ups ("explain the second one") standalone
      // meaning before retrieval. condenseQuestion filters non-text turns.
      const history = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: m.content }));

      const result = await askWithRagStream(apiKey, ragIndex, question, {
        sourceId: focusSourceId || undefined,
        history,
        signal: controller.signal,
        allowEmpty: true,
        onToken: (_delta, full) => {
          accumulated = full;
          setStreamingText(full);
        },
      });

      if (result.answer) {
        if (regenerateInto) {
          await writeVariant(regenerateInto, result.answer, result.citations);
        } else {
          await append({
            role: 'assistant',
            kind: 'text',
            content: result.answer,
            citations: result.citations,
          });
        }
      }

      setInput('');
    } catch (e) {
      if (e.name === 'AbortError' || controller.signal.aborted) {
        if (accumulated.trim()) {
          const stopped = `${accumulated.trim()}\n\n_(generation stopped)_`;
          if (regenerateInto) await writeVariant(regenerateInto, stopped, []);
          else await append({ role: 'assistant', kind: 'text', content: stopped });
        }
      } else {
        setError(e.message || 'Could not get an answer.');
        // Remember the question so the error banner can offer a one-click retry
        // without duplicating the user's message in the thread.
        setLastFailed(question);
      }
    } finally {
      setBusy(false);
      setStreamingText('');
      setRegeneratingId(null);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSend = async () => {
    if (busy) return;
    const q = input.trim();
    if (!q) return;
    await runQuestion(q);
  };

  const handleRetry = () => {
    if (busy || !lastFailed) return;
    void runQuestion(lastFailed, { skipUserMessage: true });
  };

  // Re-answer the last question in place, keeping the previous answer as a variant.
  const regenerateLast = () => {
    if (busy) return;
    let answerIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant' && messages[i].kind === 'text') { answerIdx = i; break; }
    }
    if (answerIdx < 0) return;
    let question = null;
    for (let i = answerIdx - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user' && !messages[i].attachment) { question = messages[i].content; break; }
    }
    if (question) void runQuestion(question, { skipUserMessage: true, regenerateInto: messages[answerIdx].id });
  };

  const handleRenameChat = async (convId, title) => {
    const clean = String(title || '').trim();
    if (!clean) return;
    await updateConversation(null, convId, { title });
  };

  const handlePickSuggestion = (q) => {
    if (busy) return;
    setInput('');
    void runQuestion(q);
  };

  const handleGenerateStudyKit = async () => {
    if (!apiKey) {
      setStudioError('Add your OpenRouter API key first.');
      return;
    }
    const combined = combineSourceTexts(readySources);
    if (!combined.trim()) {
      setStudioError('Add a source before generating study material.');
      return;
    }
    setStudioLoading(true);
    setStudioError('');
    try {
      const kit = await generateStudyKit(apiKey, combined);
      setStudioKit(kit);
      // Persist so the kit survives reloads and conversation switches.
      if (!tempMode && activeConvId) {
        updateConversation(null, activeConvId, { studioKit: kit }).catch(() => {});
      }
    } catch (e) {
      setStudioError(e.message || 'Could not generate study material.');
    } finally {
      setStudioLoading(false);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;
    const conv = tempMode
      ? { title: 'Temporary chat' }
      : activeConv || { title: 'Conversation' };
    exportConversationMarkdown(conv, messages, readySources);
  };

  const openStudio = () => {
    if (hasReadySources && !busy) setStudioOpen(true);
  };

  const openCitation = (citation) => {
    if (!citation || !ragIndex?.chunks?.length) return;

    const chunk = ragIndex.chunks.find((c) => c.id === citation.chunkId);
    const source =
      readySources.find((s) => s.id === citation.sourceId) ||
      readySources.find((s) => (s.title || s.label) === citation.source) ||
      (readySources.length === 1 ? readySources[0] : null);

    const base = {
      title: citation.source || source?.title || source?.label || 'Source',
      type: citation.sourceType || source?.type || 'pdf',
      label: citation.label,
    };

    // Preferred: show the full source document and highlight the exact passage.
    const passage = chunk?.text || citation.excerpt || '';
    if (source?.sourceText && passage) {
      setViewer({ ...base, text: source.sourceText, passage });
      return;
    }

    // Fallback: reconstruct from indexed chunks and highlight the target block.
    const chunks = ragIndex.chunks
      .filter((ch) =>
        citation.sourceId != null ? ch.sourceId === citation.sourceId : ch.sourceTitle === citation.source
      )
      .sort((a, b) => a.id - b.id);
    setViewer({ ...base, chunks: chunks.length ? chunks : ragIndex.chunks, targetId: citation.chunkId, passage });
  };

  const handleAttachUrl = () => {
    setUrlPromptOpen(true);
    setUrlInput('');
  };

  const confirmUrl = () => {
    const raw = urlInput.trim();
    const url = normalizeArticleUrl(raw);
    if (!url && !getYouTubeId(raw)) {
      setError('Enter a valid article or YouTube URL.');
      return;
    }
    const type = getYouTubeId(raw) ? 'youtube' : 'article';
    setUrlPromptOpen(false);
    setUrlInput('');
    setError('');
    void addSource({ type, url: raw, label: raw });
  };

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = /^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.target?.isContentEditable;

      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        startNewChat();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startTemporaryChat();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleTheme();
      } else if (!mod && !typing && e.key === '/') {
        e.preventDefault();
        document.getElementById('composer-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, tempMode, activeConvId]);

  const canUseTools = hasReadySources && !busy;
  const headerTitle = tempMode
    ? 'Temporary chat'
    : activeConvId
      ? activeConv?.title || 'Chat'
      : 'New chat';

  return (
    <div className="chat-app">
      <Sidebar
        conversations={conversations}
        activeId={tempMode ? null : activeConvId}
        onSelect={selectConversation}
        onNewChat={startNewChat}
        onTemporaryChat={startTemporaryChat}
        onDeleteChat={handleDeleteChat}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        onRenameChat={handleRenameChat}
        theme={theme}
        onToggleTheme={toggleTheme}
        tempMode={tempMode}
      />

      <main className="chat-main">
        <header className="chat-header">
          <button
            type="button"
            className="chat-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <IconMenu />
          </button>
          <button
            type="button"
            className="chat-sources-btn"
            onClick={() => setSourcesPanelOpen(true)}
            aria-label="Open sources"
          >
            Sources{sources.length > 0 ? ` (${sources.length})` : ''}
          </button>
          <div className="chat-header-title">
            {tempMode && <IconGhost className="chat-header-temp-icon" />}
            <span>{headerTitle}</span>
          </div>

          <div className="chat-header-actions">
            {busy && (
              <span className="chat-header-status chat-header-status--warn">Processing</span>
            )}
            <button
              type="button"
              className="header-icon-btn"
              onClick={openStudio}
              disabled={!canUseTools}
              title="Study Studio — flashcards & quiz"
              aria-label="Open study studio"
            >
              <IconCards />
            </button>
            <button
              type="button"
              className="header-icon-btn"
              onClick={handleExport}
              disabled={messages.length === 0}
              title="Export conversation as Markdown"
              aria-label="Export conversation"
            >
              <IconDownload />
            </button>
            <button
              type="button"
              className="header-icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              <IconSettings />
            </button>
          </div>
        </header>

        {showInput && !apiKey && (
          <div className="chat-api-banner">
            <ApiKeySetup onSave={setApiKey} />
          </div>
        )}

        {tempMode && (
          <div className="chat-temp-banner">
            <IconGhost />
            <span>
              Temporary chat — sources and messages stay in memory only and won&apos;t be saved to your history.
            </span>
          </div>
        )}

        {error && (
          <div className="chat-error-banner" role="alert">
            <span className="chat-error-text">{error}</span>
            {lastFailed && !busy && (
              <button type="button" className="chat-error-retry" onClick={handleRetry}>
                Retry
              </button>
            )}
            <button type="button" className="chat-error-close" onClick={() => setError('')} aria-label="Dismiss">×</button>
          </div>
        )}

        <ChatThread
          messages={messages}
          busy={busy}
          streamingText={streamingText}
          suggested={suggested}
          onPickSuggestion={handlePickSuggestion}
          hasSources={hasReadySources}
          onOpenStudio={openStudio}
          onOpenCitation={openCitation}
          onRegenerate={regenerateLast}
          onVariant={setMessageVariant}
          regeneratingId={regeneratingId}
          tempMode={tempMode}
        />

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          disabled={!apiKey}
          busy={busy}
          hasSources={hasReadySources}
          sources={readySources}
          focusSourceId={focusSourceId}
          onChangeFocus={setFocusSourceId}
        />
      </main>

      <SourcesPanel
        sources={sources}
        busy={busy}
        disabled={!apiKey}
        onAddPdf={(file) => addSource({ type: 'pdf', file, label: file.name })}
        onAddUrl={handleAttachUrl}
        onRemoveSource={removeSource}
        panelOpen={sourcesPanelOpen}
        onClosePanel={() => setSourcesPanelOpen(false)}
        onOpenStudio={openStudio}
        studioDisabled={!canUseTools}
      />

      <StudioPanel
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        kit={studioKit}
        loading={studioLoading}
        error={studioError}
        onGenerate={handleGenerateStudyKit}
      />

      <SourceViewer viewer={viewer} onClose={() => setViewer(null)} />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        model={model}
        onChangeModel={changeModel}
      />

      {urlPromptOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-label="Paste link">
            <h3>Add a link</h3>
            <p>Article, blog post, or YouTube URL</p>
            <input
              className="text-input"
              type="url"
              placeholder="https://…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmUrl()}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setUrlPromptOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmUrl}>
                Add source
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
