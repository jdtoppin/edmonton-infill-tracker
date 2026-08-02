import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getCurrentUser, requireUser, type AuthenticatedUser } from "@/src/lib/auth";

const previewUser: AuthenticatedUser = {
  id: "preview",
  email: "preview@infill.local",
  name: "Product preview",
  role: "USER",
};

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const authRequired = process.env.AUTH_REQUIRED === "true";
  const currentUser = authRequired
    ? await requireUser("/")
    : process.env.DATABASE_URL
      ? await getCurrentUser()
      : null;

  return (
    <WorkspaceShell user={currentUser ?? previewUser} authenticated={Boolean(currentUser)}>
      {children}
    </WorkspaceShell>
  );
}
