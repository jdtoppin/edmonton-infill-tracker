import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hashSessionToken, SESSION_COOKIE } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { requestOriginIsAllowed } from "@/src/lib/request-security";

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = await hashSessionToken(token);
    const db = await getDb();
    await db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
