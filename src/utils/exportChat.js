// ── Conversation export — turn a chat into a portable Markdown artifact ───────

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

/** Render a conversation (with its analysis cards and citations) to Markdown. */
export function conversationToMarkdown(conv, messages, sources = []) {
  const lines = [];
  const title = conv?.title || 'Lumina conversation';

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Exported from Lumina · ${fmtDate(Date.now())}_`);
  lines.push('');

  if (sources.length) {
    lines.push('## Sources');
    sources.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.title || s.label}** — ${s.type}`);
    });
    lines.push('');
  }

  lines.push('## Conversation');
  lines.push('');

  for (const m of messages) {
    if (m.role === 'user') {
      lines.push(`### 🧑 You`);
      if (m.attachment) lines.push(`> Added source: ${m.attachment.label}`);
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
      continue;
    }

    lines.push(`### ✨ Lumina`);
    lines.push('');

    if (m.kind === 'analysis' && m.analysis) {
      const a = m.analysis;
      const summary =
        a.summary ||
        [a.overview, ...(a.topics || []).map((t) => t.summary)].filter(Boolean).join('\n\n');
      if (summary) {
        lines.push('**Summary**');
        lines.push('');
        lines.push(summary);
        lines.push('');
      }
    } else {
      lines.push(m.content || '');
      lines.push('');
      if (m.citations?.length) {
        lines.push('**Sources**');
        m.citations.forEach((c) => {
          const src = c.source ? ` · ${c.source}` : '';
          lines.push(`- [${c.ref}] ${c.label || ''}${src} — ${c.excerpt}`);
        });
        lines.push('');
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Trigger a client-side download of a text file. */
export function downloadText(filename, text, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(s) {
  return String(s || 'conversation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'conversation';
}

export function exportConversationMarkdown(conv, messages, sources = []) {
  const md = conversationToMarkdown(conv, messages, sources);
  downloadText(`${slugify(conv?.title)}.md`, md);
}
