import { Check, CircleHelp, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { OrgRole } from "@/api/orgs";
import { Modal } from "@/components/Modal";
import { neutralButton, quietButton } from "@/decisions/styles";

const ROLES: OrgRole[] = ["owner", "admin", "member"];
const ROLE_LABELS: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** true: yes; false: no; text: only in part, saying how. */
type Answer = boolean | string;

/**
 * What each role may do in the organization: the same rules the server
 * checks (see server/README.md, "组织的规则" and "组的规则").
 */
const ABILITIES: { what: string; answers: Record<OrgRole, Answer> }[] = [
  { what: "See the members and groups", answers: { owner: true, admin: true, member: true } },
  { what: "Create projects", answers: { owner: true, admin: true, member: "If allowed" } },
  { what: "Invite people", answers: { owner: "Any role", admin: "Members only", member: false } },
  { what: "Revoke invitations", answers: { owner: true, admin: true, member: false } },
  { what: "Set job titles", answers: { owner: true, admin: true, member: false } },
  { what: "Allow members to create projects", answers: { owner: true, admin: true, member: false } },
  { what: "Change roles", answers: { owner: true, admin: false, member: false } },
  { what: "Remove people", answers: { owner: "Anyone", admin: "Members only", member: false } },
  { what: "Manage groups", answers: { owner: "All", admin: "All", member: "Groups they lead" } },
  {
    what: "See every project's name, and take one over",
    answers: { owner: true, admin: true, member: false },
  },
  { what: "Rename or delete the organization", answers: { owner: true, admin: false, member: false } },
];

/** A button that opens a table of what Owners, Admins and Members may do. */
export function RoleGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={quietButton}>
        <CircleHelp className="size-4" />
        What can each role do?
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="What each role can do"
        description="In the organization. Pick the role a new person needs; an owner can change it later."
        showDescription
        width={680}
      >
        {/* Scrolls on its own when the window is too short for every row. */}
        <div className="scroll-thin mt-4 min-h-0 shrink overflow-auto rounded-xl border border-line">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-surface text-xs text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">Can…</th>
                {ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 text-center font-medium">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ABILITIES.map(({ what, answers }) => (
                <tr key={what} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 font-normal text-fg">
                    {what}
                  </th>
                  {ROLES.map((role) => (
                    <td key={role} className="px-3 py-2 text-center">
                      <AnswerMark answer={answers[role]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-xs leading-relaxed text-fg-subtle">
          <li>Everyone can leave the organization, except its last owner.</li>
          <li>
            "If allowed": an admin turns on <em>Can create projects</em> for each member, on the Members tab or in
            the invitation.
          </li>
          <li>
            What someone can do inside a project is separate: their role there (Viewer, Editor or Owner, for the whole
            project or one box) is given on the project's People page.
          </li>
        </ul>
        <div className="mt-4 flex justify-end">
          <Dialog.Close className={neutralButton}>Close</Dialog.Close>
        </div>
      </Modal>
    </>
  );
}

function AnswerMark({ answer }: { answer: Answer }) {
  if (answer === true) return <Check aria-label="Yes" className="mx-auto size-4 text-emerald-300" />;
  if (answer === false) return <X aria-label="No" className="mx-auto size-4 text-fg-subtle" />;
  return <span className="text-xs text-amber-200">{answer}</span>;
}
