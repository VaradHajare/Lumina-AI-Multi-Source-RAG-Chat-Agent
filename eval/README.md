# Lumina RAG Evaluation

Measures retrieval and citation quality on a fixed dataset so pipeline changes (chunk size, top-K, fusion, reranking) can be compared with numbers instead of vibes.

## Metrics

**Hit rate @ k** (retrieval). Each question lists `answerSpans`: verbatim substrings from the source that a correct retrieval must surface. A question is a hit when any of the top-k retrieved chunks contains any span. Reported separately for BM25-only, dense-only, and hybrid (RRF) so the fusion gain is visible.

**Citation precision** (generation). The full pipeline answers each question, then an LLM judge checks every cited claim: does excerpt [n] actually support the sentence citing it? Precision = supported claims / total cited claims.

## Usage

```bash
OPENROUTER_API_KEY=sk-or-... node eval/run-eval.js eval/dataset.example.json
# retrieval-only (no generation or judge calls, much cheaper):
OPENROUTER_API_KEY=sk-or-... node eval/run-eval.js --skip-judge
# different cutoff:
node eval/run-eval.js --k 10
```

Requires Node 18+.

## Building a real dataset

1. Pick 2 or 3 documents you know well (a paper, a long article, a lecture transcript).
2. Write 20 to 30 questions spanning easy lookups, "list all X" questions, and questions whose answer lives in a single sentence.
3. For each, copy one or two short verbatim spans from the source text into `answerSpans`. Keep spans distinctive (8+ words) so containment matching does not false-positive.
4. Commit the dataset. It is the regression suite for every future retrieval change.

## Caveats

- Span containment measures retrieval only; it says nothing about answer quality on its own, which is why citation precision is judged separately.
- The judge model (`gpt-4o-mini`) is imperfect. Treat precision as a relative signal between pipeline versions, not an absolute truth.
- Chunking with overlap means a span can appear in multiple chunks; that is fine, any containing chunk counts.
