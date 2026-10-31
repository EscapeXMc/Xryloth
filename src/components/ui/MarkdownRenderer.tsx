"use client";

import { CachedImage } from "./CachedImage";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface MarkdownRendererProps {
  text: string;
}

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  if (!text) return null;

  return (
    <div className="prose prose-invert max-w-none text-sm text-zinc-300 leading-relaxed space-y-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [
            rehypeSanitize,
            {
              tagNames: [
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "p",
                "br",
                "hr",
                "a",
                "img",
                "b",
                "strong",
                "i",
                "em",
                "u",
                "s",
                "del",
                "code",
                "pre",
                "ul",
                "ol",
                "li",
                "blockquote",
                "table",
                "thead",
                "tbody",
                "tr",
                "th",
                "td",
                "div",
                "span",
                "iframe",
                "video",
                "audio",
                "source",
              ],
              attributes: {
                "*": ["className", "style"],
                a: ["href", "target", "rel", "title"],
                img: ["src", "alt", "width", "height"],
                iframe: [
                  "src",
                  "frameborder",
                  "allowfullscreen",
                  "width",
                  "height",
                ],
                video: ["src", "controls", "autoplay", "loop", "width", "height"],
                audio: ["src", "controls", "autoplay", "loop"],
                source: ["src", "type"],
                td: ["colspan", "rowspan"],
                th: ["colspan", "rowspan"],
              },
              protocols: {
                a: ["http", "https", "mailto"],
                img: ["http", "https", "data"],
                iframe: ["http", "https"],
                video: ["http", "https"],
                audio: ["http", "https"],
                source: ["http", "https"],
              },
            } as any,
          ],
          rehypeRaw,
        ] as any}
        components={{
          img: ({ node, ...props }: any) => (
            <CachedImage
              className="rounded-xl max-w-full"
              {...props}
              alt={props.alt || ""}
            />
          ),
          iframe: ({ node, ...props }: any) => (
            <iframe
              className="w-full aspect-video rounded-xl"
              {...props}
            />
          ),
          a: ({ node, ...props }: any) => (
            <a
              className="text-amber-400 underline hover:text-amber-300"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          h1: ({ node, ...props }: any) => (
            <h1 className="text-2xl font-bold text-white mt-4 mb-2" {...props} />
          ),
          h2: ({ node, ...props }: any) => (
            <h2 className="text-xl font-bold text-white mt-3 mb-2" {...props} />
          ),
          h3: ({ node, ...props }: any) => (
            <h3 className="text-lg font-semibold text-white mt-2 mb-1" {...props} />
          ),
          ul: ({ node, ...props }: any) => (
            <ul className="list-disc pl-5 space-y-1" {...props} />
          ),
          ol: ({ node, ...props }: any) => (
            <ol className="list-decimal pl-5 space-y-1" {...props} />
          ),
          p: ({ node, ...props }: any) => (
            <p className="text-zinc-300 mb-3" {...props} />
          ),
          code: ({ node, ...props }: any) => (
            <code className="text-xs bg-zinc-800/50 px-1 py-0.5 rounded text-amber-300" {...props} />
          ),
          pre: ({ node, ...props }: any) => (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 overflow-x-auto mb-3" {...props} />
          ),
          blockquote: ({ node, ...props }: any) => (
            <blockquote className="border-l-2 border-amber-500 pl-4 italic text-zinc-400 mb-3" {...props} />
          ),
          hr: () => <hr className="border-zinc-800 my-4" />,
          table: ({ node, ...props }: any) => (
            <div className="overflow-x-auto mb-3" {...props} />
          ),
          th: ({ node, ...props }: any) => (
            <th className="px-3 py-2 text-left font-bold text-zinc-200 border-b border-zinc-800" {...props} />
          ),
          td: ({ node, ...props }: any) => (
            <td className="px-3 py-2 border-b border-zinc-800" {...props} />
          ),
          tr: ({ node, ...props }: any) => (
            <tr {...props} />
          ),
        } as any}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
