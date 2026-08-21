import { type ReactNode } from "react";

interface MessageBodyProps {
  content: string;
}

/**
 * Restricted renderer for agent output:
 * Parses fenced code blocks (```lang ... ```), blockquotes (> text), bold (**text**),
 * inline code (`code`), lists (- item), and headers (### Title).
 * Operates without dangerouslySetInnerHTML to prevent XSS and CSP violations.
 */
export function MessageBody({ content }: MessageBodyProps) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="message-body">
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          return (
            <div key={idx} className="code-block-container">
              {block.language && <div className="code-block-header">{block.language}</div>}
              <pre className="code-block">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "header") {
          const level = block.level ?? 3;
          if (level === 1) return <h2 key={idx} className="msg-h1">{renderInline(block.text)}</h2>;
          if (level === 2) return <h3 key={idx} className="msg-h2">{renderInline(block.text)}</h3>;
          return <h4 key={idx} className="msg-h3">{renderInline(block.text)}</h4>;
        }

        if (block.type === "blockquote") {
          return (
            <blockquote key={idx} className="msg-quote">
              {renderInline(block.text)}
            </blockquote>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={idx} className="msg-list">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={idx} className="msg-paragraph">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

interface Block {
  type: "paragraph" | "code" | "header" | "blockquote" | "list";
  text: string;
  language?: string;
  level?: number;
  items: string[];
}

function parseMarkdownBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let currentList: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push({ type: "list", text: "", items: currentList });
      currentList = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Fenced code block start / end
    if (line.trim().startsWith("```")) {
      flushList();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: "code",
          text: codeLines.join("\n"),
          language: codeLanguage,
          items: []
        });
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // List item
    const listMatch = line.match(/^[-*]\s+(.*)/);
    if (listMatch) {
      currentList.push(listMatch[1] ?? "");
      continue;
    } else {
      flushList();
    }

    // Header
    const headerMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1]?.length ?? 3;
      blocks.push({
        type: "header",
        text: headerMatch[2] ?? "",
        level,
        items: []
      });
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      blocks.push({
        type: "blockquote",
        text: quoteMatch[1] ?? "",
        items: []
      });
      continue;
    }

    // Normal paragraph
    if (line.trim().length > 0) {
      blocks.push({
        type: "paragraph",
        text: line,
        items: []
      });
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      type: "code",
      text: codeLines.join("\n"),
      language: codeLanguage,
      items: []
    });
  }
  flushList();

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  // Regex to match bold (**text**) or inline code (`code`)
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
