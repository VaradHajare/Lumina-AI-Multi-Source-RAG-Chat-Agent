import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { IconCopy } from './Icons.jsx';

/**
 * Syntax-highlighted code block. Split into its own chunk (react-syntax-highlighter
 * is heavy) and loaded lazily the first time a code block is rendered.
 */
export default function CodeBlock({ code, lang }) {
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <button
          type="button"
          className="code-block-copy"
          onClick={() => navigator.clipboard.writeText(code)}
          aria-label="Copy code"
        >
          <IconCopy /> Copy
        </button>
      </div>
      <SyntaxHighlighter style={vscDarkPlus} language={lang} PreTag="div" className="code-block-body">
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
