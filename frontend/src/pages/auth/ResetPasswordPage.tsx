import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { previewPasswordReset, resetPassword, type PasswordResetPreview } from "@/api/auth";
import { neutralButton } from "@/decisions/styles";
import { useSessionStore } from "@/store/sessionStore";
import { AuthForm, AuthInput, AuthLayout } from "./AuthLayout";
import { errorText } from "./authHelpers";

/** /reset-password/<token>: a link from the instance admin. */
export function ResetPasswordPage() {
  const token = useParams().token ?? "";
  const navigate = useNavigate();
  const setUser = useSessionStore((s) => s.setUser);
  const [reset, setReset] = useState<PasswordResetPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previewPasswordReset(token).then(setReset, (e: unknown) => setProblem(errorText(e)));
  }, [token]);

  if (problem) {
    return (
      <AuthLayout title="This link can't be used" subtitle={problem}>
        <Link to="/sign-in" className={`${neutralButton} justify-center py-2`}>
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }
  if (!reset) return <AuthLayout title="Opening the link…">{null}</AuthLayout>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser(await resetPassword(token, password));
      void navigate("/", { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={
        <>
          For <span className="text-fg">{reset.email}</span>. Every other place this account is signed in will be
          signed out.
        </>
      }
    >
      <AuthForm onSubmit={() => void submit()} submitLabel="Set password and sign in" busy={busy} error={error}>
        <AuthInput
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
          hint="At least 8 characters."
        />
      </AuthForm>
    </AuthLayout>
  );
}
