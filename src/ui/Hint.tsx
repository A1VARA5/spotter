// A quiet "what's this?" explainer. Native details/summary: works without JavaScript and with a keyboard.
// iconOnly: just the (?) icon, with q kept for screen readers (used in case file panel headers).
import { CircleHelp } from "lucide-react";

export function Hint({ q, children, iconOnly, className }: { q: string; children: React.ReactNode; iconOnly?: boolean; className?: string }) {
  return (
    <details className={className ? `hint ${className}` : "hint"}>
      <summary>
        <CircleHelp size={16} strokeWidth={1.9} aria-hidden="true" />
        {iconOnly ? <span className="sr-only">{q}</span> : q}
      </summary>
      <div className="hint-body">{children}</div>
    </details>
  );
}
