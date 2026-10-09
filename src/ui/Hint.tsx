// A quiet "what's this?" explainer. Native details/summary: works without JavaScript and with a keyboard.
import { CircleHelp } from "lucide-react";

export function Hint({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="hint">
      <summary>
        <CircleHelp size={16} strokeWidth={1.9} aria-hidden="true" />
        {q}
      </summary>
      <div className="hint-body">{children}</div>
    </details>
  );
}
