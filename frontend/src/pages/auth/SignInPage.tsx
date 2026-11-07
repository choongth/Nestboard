import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { logIn } from "@/api/auth";
import { useSessionStore } from "@/store/sessionStore";
import { AuthForm, AuthInput, AuthLayout } from "./AuthLayout";
import { errorText, useNext } from "./authHelpers";

export function SignInPage() {
  const next = useNext();
  const navigate = useNavigate();
  const signedIn = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedIn) return <Navigate to={next} replace />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser(await logIn(email, password));
      void navigate(next, { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in">
      <AuthForm onSubmit={() => void submit()} submitLabel="Sign in" busy={busy} error={error}>
        <AuthInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </AuthForm>
      <p className="text-fg-subtle">
        New here? Ask an admin of your organization for an invitation link. Forgot your password? Ask the admin of
        this Nestboard for a reset link.
      </p>
    </AuthLayout>
  );
}
