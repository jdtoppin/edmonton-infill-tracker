import { NextResponse } from "next/server";
import { getDb } from "@/src/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const db = await getDb();
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ready", checkedAt });
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unavailable", checkedAt },
      { status: 503 },
    );
  }
}
