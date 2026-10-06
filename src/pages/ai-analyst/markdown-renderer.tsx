import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluggableList } from "unified";
import "./code-highlight.css";

type MdModule = typeof import("react-markdown");

interface MarkdownRendererProps {
  className?: string;
  content: string;
}

export default function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const { t } = useTranslation();
  const [mod, setMod] = useState<{
    Markdown: MdModule["default"];
    remarkPlugins: PluggableList;
    rehypePlugins: PluggableList;
  } | null>(null);

  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("react-markdown"),
      import("rehype-highlight"),
      import("remark-gfm"),
    ])
      .then(([md, rehype, remark]) => {
        if (!cancelled) {
          setMod({
            Markdown: md.default,
            remarkPlugins: [remark.default] as PluggableList,
            rehypePlugins: [rehype.default] as PluggableList,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className={className}>
        <p className="text-error">{t("ai_agent_markdown_load_failed")}</p>
      </div>
    );
  }

  if (!mod) {
    return (
      <div className={className}>
        <div className="h-48 animate-pulse rounded bg-surface-container-low" />
      </div>
    );
  }

  return (
    <div className={className}>
      <mod.Markdown
        rehypePlugins={mod.rehypePlugins}
        remarkPlugins={mod.remarkPlugins}
      >
        {content}
      </mod.Markdown>
    </div>
  );
}
