import { splitHighlight } from "../../shared/highlight-text.mjs";
import type { ReactNode } from "react";

export function Highlight({
  text,
  query,
}: {
  text: string;
  query?: string;
}) {
  const parts = splitHighlight(text, query || "");
  return (
    <>
      {parts.map((part: { text: string; hit: boolean }, i: number) =>
        part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

export function highlightChildText(children: ReactNode, query?: string): ReactNode {
  if (!query) return children;
  if (typeof children === "string" || typeof children === "number") {
    return <Highlight text={String(children)} query={query} />;
  }
  return children;
}
