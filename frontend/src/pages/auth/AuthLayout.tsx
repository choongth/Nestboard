import { useEffect, useId, type FormEvent, type ReactNode } from "react";
import { field, primaryButton } from "@/decisions/styles";

/** The centred card the sign-in, set-up, invitation and reset pages share. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} — Nestboard`;
  }, [title]);
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-canvas p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2">
          <img src="/logo-dark.svg" alt="" className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Nestboard</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-fg">{title}</h1>
          {subtitle && <div className="leading-relaxed text-fg-muted">{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

interface FormProps {
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  children: ReactNode;
}

export function AuthForm({ onSubmit, submitLabel, busy, error, children }: FormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {children}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/[0.08] px-3 py-2 text-rose-200">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryButton} justify-center py-2`}>
        {busy ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}

interface InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  hint?: string;
}

export function AuthInput({ label, value, onChange, type = "text", autoComplete, autoFocus, readOnly, hint }: InputProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        readOnly={readOnly}
        className={`${field} py-2 read-only:text-fg-muted`}
      />
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
  );
}
