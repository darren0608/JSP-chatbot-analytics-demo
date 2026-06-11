// Minimal, safe markdown rendering for assistant replies: bold, links,
// bullets, italics-as-footnote. Builds React nodes — no innerHTML.
import React from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // [label](url) | **bold** | _italic_
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <a key={`${keyPrefix}-${i++}`} href={m[2]} target="_blank" rel="noreferrer">
          {m[1]}
        </a>,
      );
    } else if (m[3] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${i++}`}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${i++}`}>{m[4]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n/);
  return (
    <div className="prose-chat space-y-1 text-sm leading-relaxed">
      {blocks.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="h-1" />;
        if (line.startsWith("- "))
          return (
            <div key={idx} className="flex gap-2 pl-2">
              <span>•</span>
              <span>{renderInline(line.slice(2), `l${idx}`)}</span>
            </div>
          );
        return <p key={idx}>{renderInline(line, `p${idx}`)}</p>;
      })}
    </div>
  );
}
