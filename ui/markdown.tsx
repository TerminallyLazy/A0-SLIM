import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeLink(url: string) {
  if (url.startsWith('#')) return url;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : '';
  } catch {
    return '';
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeLink}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target={href.startsWith('#') ? undefined : '_blank'}
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                View image{alt ? `: ${alt}` : ''}
              </a>
            ) : (
              <span>{alt}</span>
            ),
          table: ({ children }) => (
            <div className="markdown-table" tabIndex={0} role="region" aria-label="Table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
