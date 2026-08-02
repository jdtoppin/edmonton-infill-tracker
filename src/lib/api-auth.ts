import { getCurrentUser, type AuthenticatedUser } from "./auth";

export type AuthenticatedAdmin = Omit<AuthenticatedUser, "role"> & { role: "ADMIN" };

export type ApiAdminAuthorization =
  | { ok: true; user: AuthenticatedAdmin }
  | {
      ok: false;
      status: 401 | 403;
      error: {
        code: "authentication_required" | "admin_required";
        message: string;
      };
    };

/**
 * Resolves administrator identity for JSON route handlers without importing a
 * response implementation. Routes retain control of their JSON shape while
 * receiving explicit 401/403 semantics instead of page redirects.
 */
export async function authorizeApiAdmin(
  resolveUser: () => Promise<AuthenticatedUser | null> = getCurrentUser,
): Promise<ApiAdminAuthorization> {
  const user = await resolveUser();
  if (!user) {
    return {
      ok: false,
      status: 401,
      error: {
        code: "authentication_required",
        message: "Sign in is required.",
      },
    };
  }
  if (user.role !== "ADMIN") {
    return {
      ok: false,
      status: 403,
      error: {
        code: "admin_required",
        message: "Administrator access is required.",
      },
    };
  }
  return { ok: true, user: { ...user, role: "ADMIN" } };
}
