import { LogOut, Shield } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { logOut } from "@/api/auth";
import { discardWork, finishWork, hasUnsavedWork } from "@/app/unsavedWork";
import { useSessionStore } from "@/store/sessionStore";
import { ConfirmDialog } from "./ConfirmDialog";

/** Top-right: who is signed in, and Sign out. */
export function AccountMenu() {
  const user = useSessionStore((s) => s.user);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  if (!user) return null;

  // Nobody signed in: the page asks to sign in, and comes back here after.
  const signOut = async () => {
    await logOut().catch(() => {});
    discardWork("diagram");
    // The user first, so the project page is gone before it could reload.
    useSessionStore.getState().setUser(null);
    useSessionStore.getState().setProject(null);
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Account: ${user.display_name}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-white/[0.05] text-xs font-semibold text-fg outline-none hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/25"
        >
          {user.display_name.slice(0, 1).toUpperCase()}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-56 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
          >
            <div className="flex flex-col px-2 pt-1.5 pb-2">
              <span className="font-medium text-fg">{user.display_name}</span>
              <span className="text-xs text-fg-subtle">{user.email}</span>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            {user.is_instance_admin && (
              <DropdownMenu.Item
                onSelect={() => void navigate("/admin")}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none select-none data-highlighted:bg-surface-hover"
              >
                <Shield className="size-4 text-fg-muted" />
                Accounts and reset links
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              onSelect={() =>
                void finishWork("diagram").then(() => (hasUnsavedWork("diagram") ? setConfirming(true) : signOut()))
              }
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none select-none data-highlighted:bg-surface-hover"
            >
              <LogOut className="size-4 text-fg-muted" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out without saving?"
        description="Some changes to the open diagram have not reached the server yet."
        confirmLabel="Sign out"
        onConfirm={() => void signOut()}
      />
    </>
  );
}
