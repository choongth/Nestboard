import { Copy } from "lucide-react";
import { useState } from "react";
import { field, neutralButton } from "@/decisions/styles";

/** A link to hand to someone: shown once, with a copy button. */
export function CopyLink({ label, link, note }: { label: string; link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
      <span className="text-xs text-emerald-200">{note}</span>
      <div className="flex items-center gap-2">
        <input aria-label={label} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} />
        <button
          type="button"
          className={neutralButton}
          onClick={() =>
            void navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          <Copy className="size-4" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
