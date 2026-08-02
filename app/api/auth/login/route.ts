import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { log } from "@/src/lib/logger";
import { clientAddress, rateLimit, requestOriginIsAllowed } from "@/src/lib/request-security";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
});

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  }

  const limit = rateLimit(`login:${clientAddress(request)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const user = await db.user.findUnique({ where: { normalizedEmail: parsed.data.email } });
    const validPassword = user?.isActive
      ? await compare(parsed.data.password, user.passwordHash)
      : false;
    if (!user || !validPassword) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    const token = createSessionToken();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    await db.session.create({ data: { tokenHash, userId: user.id, expiresAt } });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    log("error", "auth.login.unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
}
