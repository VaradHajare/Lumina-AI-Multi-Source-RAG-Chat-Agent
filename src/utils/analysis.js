// ── Document analysis pipeline (OpenRouter) ───────────────────────────────────
//
//   PDF        → pdf.js (in-browser extraction) → Gemini 2.5 Flash
//   Article URL→ Jina Reader (fallback: allorigins + DOM) → Gemini 2.5 Flash
//   YouTube    → oEmbed metadata + timed transcript → Gemini 2.5 Flash
//   Video file → Web Audio → WAV → Whisper (OpenRouter) → Gemini 2.5 Flash
//
// RAG (see rag.js): OpenRouter embeddings + BM25 hybrid retrieval + cited Q&A.

import { buildRagIndex } from './rag.js';
import { chatCompletion, transcribeAudio } from './openrouter.js';
import { getChatModel } from './settings.js';

// pdf.js (~1 MB) is loaded on demand the first time a PDF is added, keeping it
// out of the initial bundle.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist/build/pdf');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatFileSize(bytes) {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getYouTubeId(url) {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function formatMediaTimestamp(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatDurationHuman(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m ${r}s`;
  }
  return `${m}m ${r}s`;
}

/**
 * Duration and resolution from the file (no extra decode beyond metadata).
 */
function readVideoFileTechnicalMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      cleanup();
      resolve({
        durationSec: Number.isFinite(video.duration) ? video.duration : null,
        width:       video.videoWidth || null,
        height:      video.videoHeight || null,
      });
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}

function transcriptFromWhisperVerboseJson(rawJson, offsetSec = 0) {
  let data;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return null;
  }

  const segments = data?.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    const lines = segments
      .map((seg) => {
        // Offset by the chunk's start so stitched-together windows keep
        // absolute timestamps relative to the whole recording.
        const stamp = formatMediaTimestamp((seg.start ?? 0) + offsetSec);
        const txt   = String(seg.text ?? '').replace(/\s+/g, ' ').trim();
        return txt ? `[${stamp}] ${txt}` : '';
      })
      .filter(Boolean);
    const out = lines.join('\n');
    if (out.trim().length >= 20) return out;
  }

  const plain = String(data?.text ?? '').trim();
  return plain.length >= 20 ? plain : null;
}

// Transcribe a single WAV blob. `offsetSec` shifts segment timestamps so a
// chunk of a longer recording keeps absolute times. Returns null for an empty
// transcript (a silent chunk) rather than throwing, so the caller can decide
// whether the whole recording came back empty; throws only on an API error.
async function transcribeWavWithWhisper(apiKey, wavBlob, offsetSec = 0) {
  const post = (verbose) => transcribeAudio(apiKey, wavBlob, { verbose });

  const extractTranscript = (body) => {
    const t = String(body || '').trim();
    if (!t) return null;
    if (t.startsWith('{')) {
      return transcriptFromWhisperVerboseJson(body, offsetSec);
    }
    return t.length >= 20 ? t : null;
  };

  let whisperResp = await post(true);
  let raw         = await whisperResp.text();
  let out         = whisperResp.ok ? extractTranscript(raw) : null;

  if (!out) {
    whisperResp = await post(false);
    raw         = await whisperResp.text();
    if (!whisperResp.ok) {
      const err = await whisperResp.json().catch(() => ({}));
      throw new Error(`Whisper transcription error: ${err?.error?.message || err?.message || whisperResp.status}`);
    }
    out = extractTranscript(raw);
  }

  return out;
}

// ── System prompt / JSON schema ───────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert content analyst and educator.

Analyse the provided content and return ONLY a valid JSON object.
No markdown fences, no preamble, no trailing commentary — just the raw JSON.

Use this exact schema:
{
  "title": "<concise title inferred from the content>",
  "source_type": "<pdf | video | article>",
  "summary": "<a clear, self-contained summary of the whole content, 200-300 words>"
}

Rules for "summary":
- Write 200 to 300 words of plain, cohesive prose in 2 to 3 short paragraphs.
- Capture the main thesis, the key points/arguments, and the takeaway a reader most needs.
- Do NOT use headings, bullet points, markdown, or lists — just readable paragraphs.
- For video sources, use metadata and transcript together; do not claim to have seen visuals unless the transcript implies them.
- For article sources, the text is extracted from a web page—ignore navigation, ads, and cookie banners.
- Respond with ONLY the JSON object — nothing else.`;

// ── Core analysis chat call ───────────────────────────────────────────────────

/**
 * Send extracted text to OpenRouter for structured analysis.
 * Returns the parsed JSON result object.
 */
export async function callAnalysisChat(apiKey, userText, sourceType, onProgress) {
  const chatModel = getChatModel();
  onProgress?.(60, `Analysing with ${chatModel}...`);

  const videoPreamble =
    sourceType === 'video'
      ? 'This is VIDEO material. The payload includes public or file metadata plus an automatic speech transcript (timestamps mark approximate segments). You cannot see the video—do not invent on-screen text, slides, or shots unless speakers describe them. Use metadata for context and the transcript for substance.\n\n'
      : '';

  const articlePreamble =
    sourceType === 'article'
      ? 'This is a WEB ARTICLE extracted from a URL (plain or markdown text). Focus on the author’s arguments and facts; treat boilerplate and UI chrome as noise.\n\n'
      : '';

  const data = await chatCompletion(apiKey, {
    model:       chatModel,
    temperature: 0.2,
    max_tokens:  1200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role:    'user',
        content:
          `Source type: ${sourceType}\n\n${videoPreamble}${articlePreamble}Content to analyse:\n\n${userText}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  onProgress?.(82, 'Parsing AI response...');

  const rawText = data?.choices?.[0]?.message?.content ?? '';

  if (!rawText) {
    throw new Error('OpenRouter returned an empty response. Check your API key and quota.');
  }

  // Strip any accidental fences (response_format: json_object should prevent
  // them, but be defensive)
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { ...parsed, source_type: sourceType };
  } catch {
    console.error('Raw analysis response:', rawText);
    throw new Error(
      'Could not parse model response as JSON. ' +
      'The model may have returned unexpected output — try again.'
    );
  }
}

/** Run structured analysis and RAG indexing in parallel on extracted text. */
async function analyseAndIndex(apiKey, text, sourceType, onProgress) {
  const [analysis, ragIndex] = await Promise.all([
    callAnalysisChat(apiKey, text, sourceType, onProgress),
    buildRagIndex(apiKey, text, sourceType, onProgress),
  ]);
  // The index builds in parallel with analysis, so back-fill the human title
  // onto every chunk now that we know it — keeps citations source-aware.
  const title = analysis?.title || null;
  if (title && ragIndex?.chunks) {
    ragIndex.chunks.forEach((c) => { c.sourceTitle = title; });
    if (ragIndex.sources?.[0]) ragIndex.sources[0].title = title;
  }
  return { analysis, sourceText: text, ragIndex };
}

// ── PDF extraction via pdf.js ─────────────────────────────────────────────────

/**
 * Extract all text from the PDF file using pdf.js.
 * Returns a plain string of the document's text content.
 */
async function extractPdfText(file, onProgress) {
  onProgress?.(15, 'Loading PDF parser...');
  const pdfjsLib = await loadPdfjs();
  onProgress?.(25, 'Reading PDF pages...');

  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages    = pdf.numPages;

  const textChunks = [];

  for (let i = 1; i <= numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) textChunks.push(`[Page ${i}]\n${pageText}`);

    // Update progress as pages are read (15% → 50%)
    const pct = 25 + Math.round((i / numPages) * 25);
    onProgress?.(pct, `Reading page ${i} of ${numPages}...`);
  }

  const fullText = textChunks.join('\n\n');

  if (!fullText.trim()) {
    throw new Error(
      'No readable text found in this PDF. ' +
      'It may be a scanned image-only PDF. Try an OCR tool first.'
    );
  }

  // Truncate to ~100k characters to stay well within 128k token context
  const MAX_CHARS = 100_000;
  return fullText.length > MAX_CHARS
    ? fullText.slice(0, MAX_CHARS) + '\n\n[Content truncated for length]'
    : fullText;
}

// ── Article / blog URL ────────────────────────────────────────────────────────

/**
 * Normalise user input into an absolute http(s) URL, or null if invalid.
 */
export function normalizeArticleUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  let u = t;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function fetchArticleTextJina(href, onProgress) {
  onProgress?.(16, 'Fetching article…');
  const readerUrl = `https://r.jina.ai/${encodeURIComponent(href)}`;
  const resp = await fetch(readerUrl, {
    headers: { Accept: 'text/plain' },
    signal:  AbortSignal.timeout(90_000),
  });
  if (!resp.ok) {
    throw new Error(`reader HTTP ${resp.status}`);
  }
  const text = (await resp.text()).trim();
  if (text.length < 80) throw new Error('extracted text too short');
  return text;
}

async function fetchArticleTextProxy(href, onProgress) {
  onProgress?.(22, 'Fetching article (alternate)…');
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(href)}`;
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`proxy HTTP ${resp.status}`);
  const html = await resp.text();
  if (!html || html.length < 80) throw new Error('empty page');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, svg, iframe').forEach((el) => el.remove());

  const root =
    doc.querySelector(
      'article, [role="main"], main, .post-content, .entry-content, .article-body, .markdown-body'
    ) || doc.body;
  if (!root) throw new Error('no document body');

  let text = (root.innerText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 120) {
    text = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
  }
  if (text.length < 80) throw new Error('no readable article text');
  return text;
}

/**
 * Fetch readable text from a public article/blog URL and analyse it.
 */
export async function analyseArticleUrl(apiKey, rawInput, onProgress) {
  const href = normalizeArticleUrl(rawInput);
  if (!href) {
    throw new Error('Enter a valid http(s) URL (article or blog post).');
  }

  let text;
  try {
    text = await fetchArticleTextJina(href, onProgress);
  } catch (e1) {
    try {
      text = await fetchArticleTextProxy(href, onProgress);
    } catch (e2) {
      const hint = e2?.message || e1?.message || 'fetch failed';
      throw new Error(
        `Could not read this URL (${hint}). Try another link, or upload a PDF.`
      );
    }
  }

  const MAX_CHARS = 100_000;
  const trimmed =
    text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS)}\n\n[Content truncated for length]`
      : text;

  const bundle = `Article URL: ${href}\n\nExtracted article text:\n\n${trimmed}`;
  onProgress?.(50, 'Analysing content…');
  return analyseAndIndex(apiKey, bundle, 'article', onProgress);
}

// ── Public: analyse PDF ───────────────────────────────────────────────────────

export async function analysePDF(apiKey, file, onProgress) {
  const text = await extractPdfText(file, onProgress);
  onProgress?.(52, 'Text extracted — analysing & indexing…');
  return analyseAndIndex(apiKey, text, 'pdf', onProgress);
}

// ── YouTube: public metadata (no API key) ─────────────────────────────────────

/**
 * Title and channel from oEmbed (noembed.com first for CORS, then YouTube).
 */
async function fetchYouTubePublicMetadata(videoUrl, onProgress) {
  onProgress?.(14, 'Fetching video title and channel…');

  const endpoints = [
    `https://noembed.com/embed?url=${encodeURIComponent(videoUrl)}`,
    `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, { signal: AbortSignal.timeout(12_000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.error) continue;
      const title = String(data.title || '').trim();
      if (!title) continue;
      return {
        title,
        author: String(data.author_name || data.author || '').trim(),
      };
    } catch {
      /* try next endpoint */
    }
  }

  return null;
}

function parseYoutubeTranscriptXml(raw) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(raw, 'text/xml');
    const texts  = Array.from(xmlDoc.querySelectorAll('text'));
    if (texts.length === 0) return null;

    const hasStart = texts.some((t) => t.getAttribute('start') != null);
    if (!hasStart) {
      const flat = texts
        .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      return flat.length > 80 ? flat : null;
    }

    const lines = [];
    for (const t of texts) {
      const start = parseFloat(t.getAttribute('start') || '0');
      const stamp = formatMediaTimestamp(start);
      const line  = t.textContent.replace(/\s+/g, ' ').trim();
      if (line) lines.push(`[${stamp}] ${line}`);
    }
    const out = lines.join('\n');
    return out.length > 80 ? out : null;
  } catch {
    return null;
  }
}

// ── YouTube transcript via proxy ──────────────────────────────────────────────

/**
 * Transcript from third-party endpoints; includes approximate timestamps when the
 * XML provides them.
 */
async function fetchYouTubeTranscript(videoId, videoUrl, onProgress) {
  onProgress?.(26, 'Fetching YouTube transcript...');

  try {
    const resp = await fetch(
      `https://youtubetranscript.com/?server_vid2=${videoId}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (resp.ok) {
      const raw = await resp.text();
      const parsed = parseYoutubeTranscriptXml(raw);
      if (parsed) return parsed;
    }
  } catch {
    /* try next approach */
  }

  try {
    const resp = await fetch(
      `https://kome.ai/api/transcript?video_id=${videoId}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ video_id: videoId, format: true }),
        signal:  AbortSignal.timeout(20_000),
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      const transcript = data?.transcript || data?.data || '';
      if (typeof transcript === 'string' && transcript.length > 100) {
        return transcript.trim();
      }
    }
  } catch {
    /* fall through */
  }

  onProgress?.(38, 'Transcript unavailable — using metadata and URL only…');
  return (
    `[No speech transcript available for this video]\n\n` +
    `YouTube URL: ${videoUrl}\nVideo ID: ${videoId}\n\n` +
    `Use the metadata section above (title/channel) and this URL. If the topic is unclear, say what is missing. ` +
    `Do not invent dialogue or scenes.`
  );
}

// ── Public: analyse YouTube ───────────────────────────────────────────────────

export async function analyseYouTube(apiKey, videoUrl, onProgress) {
  const videoId = getYouTubeId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL.');

  onProgress?.(12, 'Fetching video metadata and transcript…');
  const [meta, transcript] = await Promise.all([
    fetchYouTubePublicMetadata(videoUrl, () => {}),
    fetchYouTubeTranscript(videoId, videoUrl, onProgress),
  ]);
  onProgress?.(52, 'Preparing analysis…');

  const parts = [];
  parts.push('## Video metadata (public)');
  if (meta) {
    parts.push(`Title: ${meta.title}`);
    if (meta.author) parts.push(`Channel: ${meta.author}`);
    parts.push(`URL: ${videoUrl}`);
  } else {
    parts.push('(Title/channel could not be loaded from YouTube oEmbed.)');
    parts.push(`URL: ${videoUrl}`);
  }

  parts.push('');
  parts.push('## Transcript (auto-captions / speech; timestamps are approximate when present)');
  parts.push(transcript);

  const content = parts.join('\n');
  return analyseAndIndex(apiKey, content, 'video', onProgress);
}

// ── Audio extraction + Whisper transcription ──────────────────────────────────

// Whisper caps each request at 25 MB. 16 kHz mono 16-bit PCM (~32 KB/s) keeps a
// ~10-minute window near ~18 MB, well under the cap; windows are stitched back
// with absolute timestamps, so the old "trim your video / 25 MB" limit is gone.
const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 600;

/**
 * Transcribe a video's audio with Whisper.
 *
 * Memory is the real constraint, not Whisper's size limit: decodeAudioData
 * expands the whole audio track into RAM, so we avoid every extra full-size copy
 * (no arrayBuffer.slice) and release the full-rate PCM before the upload loop.
 * We downmix to 16 kHz mono and transcribe in ~10-minute windows, stitching the
 * segments back with absolute timestamps. A genuinely long (multi-hour)
 * recording can still exceed browser memory and fails with a clear message —
 * for that, add the video as a YouTube URL instead.
 */
async function transcribeVideoFile(apiKey, file, onProgress) {
  onProgress?.(18, 'Decoding video audio...');

  // Pass the ArrayBuffer straight to decodeAudioData (it detaches it) rather
  // than copying with slice(0) — for a large file that copy alone doubled peak
  // memory and was the crash.
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(
      'Could not extract audio from this video. Make sure it has an audio track ' +
      '(MP4, WebM, or MOV). A very long recording can also exceed the browser’s ' +
      'memory — try a shorter clip or add it as a YouTube URL.'
    );
  } finally {
    await audioCtx.close();
  }

  onProgress?.(28, 'Resampling audio for transcription...');

  // Downmix to 16 kHz mono once, then drop the full-rate decoded buffer so it
  // can be collected while we upload windows (the loop below is network-bound).
  let samples;
  try {
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE),
      TARGET_SAMPLE_RATE
    );
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start(0);
    samples = (await offline.startRendering()).getChannelData(0);
  } catch {
    throw new Error(
      'This recording is too long to process in the browser. ' +
      'Try a shorter clip or add it as a YouTube URL instead.'
    );
  } finally {
    audioBuffer = null; // release the full-rate PCM before the upload loop
  }

  const chunkSamples = CHUNK_SECONDS * TARGET_SAMPLE_RATE;
  const totalChunks  = Math.max(1, Math.ceil(samples.length / chunkSamples));

  const pieces = [];
  for (let i = 0; i < totalChunks; i += 1) {
    const start   = i * chunkSamples;
    const slice   = samples.subarray(start, start + chunkSamples);
    const wavBlob = encodeWavFromSamples(slice, TARGET_SAMPLE_RATE);

    // Progress across the 32→48 band, one step per window.
    const pct = 32 + Math.round(((i + 1) / totalChunks) * 16);
    onProgress?.(
      pct,
      totalChunks > 1
        ? `Transcribing audio with Whisper (part ${i + 1} of ${totalChunks})...`
        : 'Transcribing audio with Whisper (OpenRouter)...'
    );

    const part = await transcribeWavWithWhisper(apiKey, wavBlob, start / TARGET_SAMPLE_RATE);
    if (part) pieces.push(part);
  }

  if (!pieces.length) {
    throw new Error('Whisper returned an empty transcript. The video may have no audible speech.');
  }

  return pieces.join('\n');
}

// ── Public: analyse video file ────────────────────────────────────────────────

export async function analyseVideoFile(apiKey, file, onProgress) {
  onProgress?.(10, 'Reading video metadata…');
  const tech = await readVideoFileTechnicalMeta(file);

  const transcript = await transcribeVideoFile(apiKey, file, onProgress);
  onProgress?.(56, 'Preparing analysis…');

  const parts = [];
  parts.push('## Video file');
  parts.push(`File name: ${file.name}`);
  parts.push(`Size: ${formatFileSize(file.size)}`);
  if (tech?.durationSec != null) {
    parts.push(
      `Duration: ${Math.round(tech.durationSec)}s (${formatDurationHuman(tech.durationSec)})`
    );
  }
  if (tech?.width && tech?.height) {
    parts.push(`Resolution: ${tech.width}×${tech.height}`);
  }

  parts.push('');
  parts.push('## Transcript (Whisper speech-to-text; timestamps are approximate segments)');
  parts.push(transcript);

  const content = parts.join('\n');
  return analyseAndIndex(apiKey, content, 'video', onProgress);
}

// ── WAV encoder ──────────────────────────────────────────────────────────────
// Encodes a mono 16-bit PCM WAV from a Float32 sample array.

function encodeWavFromSamples(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSamp = 16;
  const bytesPerSamp = bitsPerSamp / 8;
  const dataLen     = samples.length * bytesPerSamp;
  const wavBuffer   = new ArrayBuffer(44 + dataLen);
  const view        = new DataView(wavBuffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                        // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSamp, true);
  view.setUint16(32, numChannels * bytesPerSamp, true);
  view.setUint16(34, bitsPerSamp, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}
