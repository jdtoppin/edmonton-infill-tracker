import { describe, expect, it } from "vitest";

import { authorizeApiAdmin } from "../../src/lib/api-auth";
import type { AuthenticatedUser } from "../../src/lib/auth";

const baseUser = {
  id: "user-1",
  email: "person@example.test",
  name: "Test person",
} as const;

describe("API administrator authorization", () => {
  it("returns a JSON-route-friendly 401 when no session is present", async () => {
    await expect(authorizeApiAdmin(async () => null)).resolves.toEqual({
      ok: false,
      status: 401,
      error: {
        code: "authentication_required",
        message: "Sign in is required.",
      },
    });
  });

  it("distinguishes an authenticated non-administrator with 403", async () => {
    const user: AuthenticatedUser = { ...baseUser, role: "USER" };
    await expect(authorizeApiAdmin(async () => user)).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: { code: "admin_required" },
    });
  });

  it("returns the authenticated administrator without accepting a request actor", async () => {
    const admin: AuthenticatedUser = { ...baseUser, role: "ADMIN" };
    await expect(authorizeApiAdmin(async () => admin)).resolves.toEqual({
      ok: true,
      user: admin,
    });
  });
});
