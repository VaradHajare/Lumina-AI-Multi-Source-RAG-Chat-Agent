import { describe, it, expect } from 'vitest';
import { conversationToMarkdown } from './exportChat.js';

describe('conversationToMarkdown', () => {
  const conv = { title: 'My Research' };
  const sources = [{ title: 'Paper A', type: 'pdf', label: 'a.pdf' }];
  const messages = [
    { role: 'user', content: 'What is the thesis?' },
    {
      role: 'assistant',
      kind: 'text',
      content: 'The thesis is X [1].',
      citations: [{ ref: 1, label: 'Page 2', source: 'Paper A', excerpt: 'X is argued…' }],
    },
  ];

  it('includes the title, sources, and messages', () => {
    const md = conversationToMarkdown(conv, messages, sources);
    expect(md).toContain('# My Research');
    expect(md).toContain('## Sources');
    expect(md).toContain('Paper A');
    expect(md).toContain('What is the thesis?');
    expect(md).toContain('The thesis is X [1].');
  });

  it('renders citations with source and excerpt', () => {
    const md = conversationToMarkdown(conv, messages, sources);
    expect(md).toContain('[1] Page 2');
    expect(md).toContain('Paper A');
    expect(md).toContain('X is argued');
  });

  it('serializes an analysis card as its prose summary', () => {
    const md = conversationToMarkdown(
      conv,
      [{ role: 'assistant', kind: 'analysis', analysis: { summary: 'A concise 200-word summary.' } }],
      []
    );
    expect(md).toContain('**Summary**');
    expect(md).toContain('A concise 200-word summary.');
  });

  it('falls back to legacy overview + topic summaries when no summary field', () => {
    const md = conversationToMarkdown(
      conv,
      [
        {
          role: 'assistant',
          kind: 'analysis',
          analysis: {
            overview: 'A summary.',
            topics: [{ title: 'Topic 1', summary: 'About it', keyPoints: ['Point A'] }],
          },
        },
      ],
      []
    );
    expect(md).toContain('A summary.');
    expect(md).toContain('About it');
  });
});
