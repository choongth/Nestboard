import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { authStatus, setUp } from "@/api/auth";
import { useSessionStore } from "@/store/sessionStore";
import { AuthForm, AuthInput, AuthLayout } from "./AuthLayout";
import { errorText } from "./authHelpers";

/** The very first visit to a new Nestboard: create the admin's account. */
export function SetupPage() {
  const navigate = useNavigate();
  const setUser = useSessionStore((s) => s.setUser);
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authStatus().then(
      (s) => setNeeded(s.needs_setup),
      () => setNeeded(true),
    );
  }, []);

  if (needed === false) return <Navigate to="/sign-in" replace />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser(await setUp(email, name, password));
      void navigate("/", { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Set up Nestboard"
      subtitle="Create the first account. It runs this Nestboard: it creates organizations and can reset passwords."
    >
      <AuthForm onSubmit={() => void submit()} submitLabel="Create account" busy={busy} error={error}>
        <AuthInput label="Your name" value={name} onChange={setName} autoComplete="name" autoFocus />
        <AuthInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
      </AuthForm>
    </AuthLayout>
  );
}
