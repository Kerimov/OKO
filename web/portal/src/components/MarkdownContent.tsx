import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";

export function MarkdownContent({ source }: { source: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("/")) {
              return <Link to={href}>{children}</Link>;
            }
            if (href?.startsWith("#")) {
              return <a href={href}>{children}</a>;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
