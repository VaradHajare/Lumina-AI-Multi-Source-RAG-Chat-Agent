// ── Locate a retrieved passage inside its original source text ────────────────
//
// Chunk text is whitespace-normalized and has [Page N] / [M:SS] markers stripped,
// so it rarely matches the raw source byte-for-byte. We build a whitespace-
// collapsed view of the source with an index map back to original offsets, find
// the passage there, and map the span back so the exact original text can be
// highlighted.

function buildNormalized(source) {
  let norm = '';
  const map = []; // map[i] = index in `source` of normalized char i
  let prevSpace = true; // treat start as space so leading whitespace is trimmed
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm += ' ';
        map.push(i);
        prevSpace = true;
      }
    } else {
      norm += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

/**
 * Find `passage` within `source`, tolerating whitespace differences. Returns
 * { before, mark, after } slices of the ORIGINAL source, or null if not found.
 * Falls back to progressively shorter prefixes so a partial match still anchors.
 */
export function locatePassage(source, passage) {
  const src = String(source || '');
  const target = String(passage || '').replace(/\s+/g, ' ').trim();
  if (!src || target.length < 12) return null;

  const { norm, map } = buildNormalized(src);

  // Longest prefix of `target` that occurs in the source. Whole passage when it
  // matches cleanly; a shorter anchor when the passage runs past a page/section
  // boundary the chunker stripped. Monotonic, so binary-search the length.
  let lo = 12;
  let hi = target.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (norm.indexOf(target.slice(0, mid)) >= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return null;

  const cand = target.slice(0, best);
  const idx = norm.indexOf(cand);
  const start = map[idx];
  const lastNorm = idx + cand.length - 1;
  const end = (lastNorm < map.length ? map[lastNorm] : src.length - 1) + 1;
  return {
    before: src.slice(0, start),
    mark: src.slice(start, end),
    after: src.slice(end),
  };
}
