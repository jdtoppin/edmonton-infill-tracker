import { hash, truncates } from "bcryptjs";
import { z } from "zod";

import { UserRole } from "../generated/prisma/enums";
import { getDb } from "../lib/db";

const inputSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(16)
    .max(128)
    .refine((value) => !truncates(value), "Password must not exceed bcrypt's 72-byte limit.")
    .optional(),
  resetPassword: z.enum(["true", "false"]).default("false"),
});

const parsed = inputSchema.safeParse({
  email: process.env.INITIAL_ADMIN_EMAIL,
  password: process.env.INITIAL_ADMIN_PASSWORD || undefined,
  resetPassword: process.env.RESET_INITIAL_ADMIN_PASSWORD ?? "false",
});

if (!parsed.success) {
  throw new Error(
    "INITIAL_ADMIN_EMAIL must be valid. INITIAL_ADMIN_PASSWORD must contain at least 16 characters and no more than 72 UTF-8 bytes.",
  );
}

const db = await getDb();

try {
  const existing = await db.user.findUnique({
    where: { normalizedEmail: parsed.data.email },
    select: { id: true, role: true, isActive: true },
  });

  if (existing) {
    const shouldResetPassword = parsed.data.resetPassword === "true";
    if (shouldResetPassword && !parsed.data.password) {
      throw new Error("INITIAL_ADMIN_PASSWORD is required when RESET_INITIAL_ADMIN_PASSWORD=true.");
    }

    if (existing.role !== UserRole.ADMIN || !existing.isActive || shouldResetPassword) {
      await db.user.update({
        where: { id: existing.id },
        data: {
          role: UserRole.ADMIN,
          isActive: true,
          ...(shouldResetPassword ? { passwordHash: await hash(parsed.data.password!, 12) } : {}),
        },
      });
      console.info(
        JSON.stringify({
          event: "admin.bootstrap.completed",
          action: shouldResetPassword ? "promoted-and-password-reset" : "promoted",
        }),
      );
    } else {
      console.info(JSON.stringify({ event: "admin.bootstrap.completed", action: "unchanged" }));
    }
  } else {
    if (!parsed.data.password) {
      throw new Error("INITIAL_ADMIN_PASSWORD is required to create the first administrator.");
    }

    await db.user.create({
      data: {
        email: parsed.data.email,
        normalizedEmail: parsed.data.email,
        passwordHash: await hash(parsed.data.password, 12),
        role: UserRole.ADMIN,
        isActive: true,
      },
    });
    console.info(JSON.stringify({ event: "admin.bootstrap.completed", action: "created" }));
  }
} finally {
  await db.$disconnect();
}
