# Lumina AI: Multi-Source RAG Study & Research Agent
<br>
<div align="center">
  <img width="1900" height="917" alt="image" src="https://github.com/user-attachments/assets/f4e1bf9b-4826-4700-a9dd-d4c8ec4c04ba" />
</div>
<br>

Lumina is a **citation-backed RAG research and study assistant**. Add your own sources (PDFs, web articles, YouTube videos) and chat with them through a hybrid retrieval pipeline that runs entirely in the browser (no external vector database). Every answer streams token-by-token with inline citations that link back to the exact passage they came from, and any source can be turned into flashcards and quizzes.

Powered by [OpenRouter](https://openrouter.ai/) for chat and embeddings.

## Retrieval pipeline

Everything below runs client-side; the only network calls are to OpenRouter for embeddings and generation.

```
Sources (PDF / URL / YouTube / video)
        │
        ▼
1. Chunking          overlapping chunks with [Page N] / [M:SS] metadata
        │
        ▼
2. Hybrid retrieval  ┌─ Dense   → text-embedding-3-small + cosine similarity
                     └─ Sparse  → BM25 over tokenized chunks
        │
        ▼
3. Fusion            Reciprocal Rank Fusion (RRF, k=60)
        │
        ▼
4. Condense + dedupe follow-ups rewritten to standalone; near-duplicate
                     passages collapsed (overlap creates them)
        │
        ▼
5. Generation        streamed answer with inline [n] citations, renumbered
                     to order of appearance
```

Implementation: [`src/utils/rag.js`](src/utils/rag.js) (chunking, BM25, RRF, dedupe, citation renumbering), [`src/utils/condense.js`](src/utils/condense.js) (conversational query rewriting), [`src/utils/embeddings.js`](src/utils/embeddings.js), [`src/utils/openrouter.js`](src/utils/openrouter.js) (client + retry).

### Retrieval design decisions

- **Hybrid beats dense-only.** Dense embeddings capture meaning but miss exact terms (names, error codes, acronyms); BM25 nails lexical matches but misses paraphrase. RRF fuses both rank lists without needing to calibrate score scales. Being rank-based, it stays robust even when the two retrievers produce scores on totally different ranges.
- **Conversational query condensation.** A follow-up like *"explain the second one"* has no standalone meaning, so embedding it raw retrieves garbage. Before retrieval, recent turns + the new question are rewritten into a self-contained question. A cheap heuristic gate (anaphora / ellipsis / short-question detection) skips the extra LLM round-trip when the question is already standalone.
- **Near-duplicate collapsing.** Chunking with overlap means adjacent hits are often near-identical, which would otherwise show "the same source" several times in the citation list. Overlapping passages above a Jaccard threshold are dropped before the top-K cut.
- **Citation integrity.** After generation, citations are renumbered to order of first appearance, passages the model never cited are dropped, and refs inside code spans are left untouched so `arr[2]` isn't rewritten into a citation.

## Features

### Research
- **Streaming answers + Stop control**: responses stream over SSE; stop at any time and the partial answer is preserved (retrieval and stream abort together).
- **Multi-modal ingestion**: PDFs, web articles, and YouTube videos (metadata + transcript). For any video, add it as a YouTube URL — the transcript path handles arbitrary length without in-browser audio decoding.
- **Source-aware citations**: with multiple sources, each citation is tagged with which document it came from and links to the passage.
- **Per-source focus**: scope a question to one source or ask across everything.

### Study
- **Study Studio**: one click turns sources into a flashcard deck and a scored multiple-choice quiz with per-question explanations.
- **Suggested questions**: smart starter questions proposed after adding a source.
- **Analysis cards**: each source auto-summarized into an overview plus expandable topic/key-point breakdowns.

### Product polish
- Light/dark mode, Markdown export of conversations, read-aloud (`SpeechSynthesis`), model picker (Gemini / GPT-4o / Claude / Llama), temporary in-memory chat, source viewer with passage highlighting, rename/retry/regenerate, keyboard shortcuts, KaTeX math + syntax-highlighted code blocks.

### Production hardening
- Exponential backoff on 429 / 5xx honoring `Retry-After`; `localStorage` quota detection; embedding cache on re-open; focus-trapped modals with `aria-live` streaming; code-split `pdfjs` and highlighter (~1.7 MB → ~656 KB initial JS).

## Evaluation

Retrieval and citation quality are measured on a fixed dataset so pipeline changes can be compared with numbers instead of vibes. See [`eval/README.md`](eval/README.md).

```bash
OPENROUTER_API_KEY=sk-or-... node eval/run-eval.js eval/dataset.example.json
# retrieval-only (no generation/judge calls, much cheaper):
node eval/run-eval.js --skip-judge
```

The harness reports **hit rate @ k** for BM25-only vs dense-only vs hybrid (so the fusion gain is visible) and **citation precision** via an LLM judge that checks whether each cited excerpt actually supports the sentence citing it. `dataset.example.json` is a placeholder; build a real 20 to 30 question set from documents you know well to turn this into a regression suite for future retrieval changes.

## Security & API keys

The recommended mode is **bring-your-own-key (BYOK)**: enter your OpenRouter key in the app's UI. It is stored in `localStorage` in your browser and sent only to OpenRouter.

⚠️ **Do not ship a hosted build with your own key in `.env`.** Any `VITE_`-prefixed variable is inlined into the client bundle at build time, so a deployed build exposes the key to anyone who views the JS, and they can drain your credits. The `.env` path exists only for local development. For a public deployment, put the key behind a small serverless proxy (e.g. a Vercel edge function) that holds it server-side and rate-limits requests, and point the client at that proxy instead.

## Quick start

**Prerequisites:** Node.js 18+ and an [OpenRouter API key](https://openrouter.ai/keys).

```bash
git clone https://github.com/VaradHajare/Lumina-AI-Multi-Source-RAG-Chat-Agent.git
cd Lumina-AI-Multi-Source-RAG-Chat-Agent
npm install
npm run dev        # start the dev server
```

Then enter your API key in the app UI. For local development you may instead copy `.env.example` to `.env` and set `VITE_OPENROUTER_API_KEY`, but see the security note above before deploying.

### Scripts

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # ESLint
npm test           # Vitest unit tests
```

## Tech stack

- **Frontend**: React 18, Vite, vanilla CSS (CSS variables + `[data-theme]`)
- **State**: custom observable store ([`src/lib/chatStore.js`](src/lib/chatStore.js)), persisted to `localStorage`
- **LLM provider**: OpenRouter (chat, embeddings, SSE streaming)
- **RAG**: [`src/utils/rag.js`](src/utils/rag.js) + [`src/utils/condense.js`](src/utils/condense.js)
- **Analysis & study**: [`src/utils/analysis.js`](src/utils/analysis.js), [`src/utils/studio.js`](src/utils/studio.js)
- **Parsing**: `pdfjs-dist`
- **Tooling**: Vitest, ESLint, GitHub Actions CI (lint + test + build)

## Known limitations

- **URL and YouTube ingestion depend on third parties.** Article extraction (Jina Reader) and the CORS proxies used for transcript fetching are external services that can rate-limit or break; those ingestion paths are the most fragile part of the app.
- **No cross-session index persistence.** Embeddings live in memory for the session and in the conversation cache, but a hard refresh re-embeds a source. Persisting the index (chunks + embeddings) in IndexedDB keyed by a content hash is a natural next step.
- **Large sources are capped.** Chunking stops at `maxChunks` (250) per source; the UI surfaces a note when a document is truncated, but later pages of a very large PDF may not be retrievable.
