import { questionIndex } from "../../shared/chat-search.mjs";
import type { TimelineItem } from "../vite-env";

export function QuestionIndex({
  items,
  onJump,
}: {
  items: TimelineItem[];
  onJump: (id: string) => void;
}) {
  const questions = questionIndex(items);
  if (questions.length < 2) return null;
  return (
    <details className="question-index">
      <summary>这次问过的 {questions.length} 个问题</summary>
      <ol>
        {questions.map((q: { id: string; title: string }) => (
          <li key={q.id}>
            <button type="button" onClick={() => onJump(q.id)}>
              {q.title || "（无文字）"}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
