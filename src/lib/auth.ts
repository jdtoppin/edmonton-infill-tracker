import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { safeReturnPath } from "./safe-return-path";

export const SESSION_COOKIE = "infill_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
};

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  const db = await getDb();
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now() ||
    !session.user.isActive
  ) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

export async function requireUser(returnTo = "/"): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
  return user;
}

export async function requireAdmin(returnTo = "/admin"): Promise<AuthenticatedUser> {
  const user = await requireUser(returnTo);
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
