import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getMe, type User } from "@/api/auth";
import { acceptInvitation, previewInvitation, signUpWithInvitation, type InvitationPreview } from "@/api/orgs";
import { orgPath } from "@/app/pages";
import { neutralButton } from "@/decisions/styles";
import { useSessionStore } from "@/store/sessionStore";
import { AuthForm, AuthInput, AuthLayout } from "./AuthLayout";
import { errorText } from "./authHelpers";

const ROLE_NAMES = { owner: "an owner", admin: "an admin", member: "a member" } as const;

/** /invite/<token>: join an organization, signing up first if needed. */
export function InvitePage() {
  const token = useParams().token ?? "";
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [me, setMe] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    previewInvitation(token).then(setInvitation, (e: unknown) => setProblem(errorText(e)));
    getMe().then(setMe, () => setMe(null));
  }, [token]);

  if (problem) {
    return (
      <AuthLayout title="This invitation can't be used" subtitle={problem}>
        <Link to="/" className={`${neutralButton} justify-center py-2`}>
          Go to Nestboard
        </Link>
      </AuthLayout>
    );
  }
  if (!invitation || me === undefined) return <AuthLayout title="Opening the invitation…">{null}</AuthLayout>;

  const subtitle = (
    <>
      {invitation.invited_by ?? "Someone"} invited you to join <strong className="text-fg">{invitation.organization.name}</strong>{" "}
      as {ROLE_NAMES[invitation.role]}
      {invitation.title && ` (${invitation.title})`}.
    </>
  );
  return me ? (
    <Accept token={token} invitation={invitation} me={me} subtitle={subtitle} />
  ) : (
    <SignUp token={token} invitation={invitation} subtitle={subtitle} />
  );
}

interface Props {
  token: string;
  invitation: InvitationPreview;
  subtitle: React.ReactNode;
}

function Accept({ token, me, subtitle }: Props & { me: User }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = await acceptInvitation(token);
      void navigate(orgPath(org.id), { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Join the organization" subtitle={subtitle}>
      <AuthForm onSubmit={() => void accept()} submitLabel="Join" busy={busy} error={error}>
        <p className="text-fg-muted">
          You are signed in as <span className="text-fg">{me.email}</span>.
        </p>
      </AuthForm>
    </AuthLayout>
  );
}

function SignUp({ token, invitation, subtitle }: Props) {
  const navigate = useNavigate();
  const setUser = useSessionStore((s) => s.setUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitation.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const joined = await signUpWithInvitation(token, email, name, password);
      setUser(joined.user);
      void navigate(orgPath(joined.organization.id), { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle={subtitle}>
      <AuthForm onSubmit={() => void submit()} submitLabel="Create account and join" busy={busy} error={error}>
        <AuthInput label="Your name" value={name} onChange={setName} autoComplete="name" autoFocus />
        <AuthInput
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          readOnly={invitation.email !== null}
        />
        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
      </AuthForm>
      <p className="text-fg-subtle">
        Already have an account?{" "}
        <Link to={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-fg underline">
          Sign in
        </Link>{" "}
        to join with it; you come back here.
      </p>
    </AuthLayout>
  );
}
