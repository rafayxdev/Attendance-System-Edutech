import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../lib/auth.js";
import {
  formatDayKey,
  formatDisplayDateTime,
  normalizeKey,
} from "../lib/rules.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

const bulkUserRowSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1),
  fullName: z.string().min(1),
  uniqueId: z.string().optional().nullable(),
  generated: z.boolean().optional(),
});

const bulkGenerateSchema = z.object({
  rows: z.array(bulkUserRowSchema).min(1).max(500),
  overwriteExisting: z.boolean().optional(),
});

const createUserDataSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1),
  fullName: z.string().min(1),
  uniqueId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateUserDataSchema = z.object({
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  uniqueId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const passwordUpdateSchema = z.object({
  password: z.string().min(6),
});

const allowedRoles = new Set([
  "student",
  "internee",
  "faculty member",
  "faculty",
  "human resource",
  "chief executive",
  "employee",
  "admin",
]);
const credentialAuditAction = "USER_CREDENTIAL_GENERATED";

type CredentialPayload = {
  email: string;
  fullName: string;
  role: string;
  uniqueId: string | null;
  password: string;
  status: "created" | "updated";
};

function parseCredentialPayload(payload: unknown): CredentialPayload | null {
  if (!payload || typeof payload !== "object") return null;

  const row = payload as Record<string, unknown>;
  if (
    typeof row.email !== "string" ||
    typeof row.fullName !== "string" ||
    typeof row.role !== "string" ||
    typeof row.password !== "string" ||
    (row.status !== "created" && row.status !== "updated")
  ) {
    return null;
  }

  return {
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    uniqueId: typeof row.uniqueId === "string" ? row.uniqueId : null,
    password: row.password,
    status: row.status,
  };
}

function generatePassword(length = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

adminRouter.post(
  "/users/bulk-generate",
  async (request: AuthenticatedRequest, response) => {
    const parsed = bulkGenerateSchema.safeParse(request.body);
    if (!parsed.success) {
      response
        .status(400)
        .json({ message: "Invalid user generation payload." });
      return;
    }

    const overwriteExisting = parsed.data.overwriteExisting ?? true;
    const actorEmail = request.auth?.email ?? null;
    const results: Array<{
      email: string;
      fullName: string;
      role: string;
      uniqueId: string | null;
      status: "created" | "updated" | "skipped";
      password?: string;
      reason?: string;
    }> = [];

    for (const row of parsed.data.rows) {
      const email = row.email.trim().toLowerCase();
      const role = normalizeKey(row.role);
      const fullName = row.fullName.trim();
      const uniqueId = row.uniqueId?.trim() || null;

      if (!row.generated && row.generated !== undefined) {
        results.push({
          email,
          fullName,
          role,
          uniqueId,
          status: "skipped",
          reason: "Row marked as not generated.",
        });
        continue;
      }

      if (!allowedRoles.has(role)) {
        results.push({
          email,
          fullName,
          role,
          uniqueId,
          status: "skipped",
          reason: "Role is not allowed.",
        });
        continue;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && !overwriteExisting) {
        results.push({
          email,
          fullName,
          role,
          uniqueId,
          status: "skipped",
          reason: "User already exists.",
        });
        continue;
      }

      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);

      if (existing) {
        await prisma.user.update({
          where: { email },
          data: {
            passwordHash,
            role,
            fullName,
            uniqueId,
            isActive: true,
          },
        });

        await prisma.auditLog.create({
          data: {
            actorEmail,
            action: credentialAuditAction,
            payload: {
              email,
              fullName,
              role,
              uniqueId,
              password,
              status: "updated",
            },
          },
        });

        results.push({
          email,
          fullName,
          role,
          uniqueId,
          status: "updated",
          password,
        });
        continue;
      }

      await prisma.user.create({
        data: {
          email,
          passwordHash,
          role,
          fullName,
          uniqueId,
          isActive: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          actorEmail,
          action: credentialAuditAction,
          payload: {
            email,
            fullName,
            role,
            uniqueId,
            password,
            status: "created",
          },
        },
      });

      results.push({
        email,
        fullName,
        role,
        uniqueId,
        status: "created",
        password,
      });
    }

    response.json({
      success: true,
      total: parsed.data.rows.length,
      processed: results.length,
      results,
    });
  },
);

adminRouter.get(
  "/users-data",
  async (request: AuthenticatedRequest, response) => {
    const search = (request.query.search as string | undefined)?.trim() ?? "";

    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { role: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
              { uniqueId: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const credentialLogs = await prisma.auditLog.findMany({
      where: { action: credentialAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const generatedEmailSet = new Set<string>();
    for (const log of credentialLogs) {
      const payload = parseCredentialPayload(log.payload);
      if (payload) generatedEmailSet.add(payload.email.toLowerCase());
    }

    response.json(
      users.map((user) => ({
        email: user.email,
        generated: generatedEmailSet.has(user.email.toLowerCase()),
        role: user.role,
        fullName: user.fullName,
        uniqueId: user.uniqueId ?? "N/A",
        isActive: user.isActive,
        createdAt: user.createdAt,
      })),
    );
  },
);

adminRouter.post(
  "/users-data",
  async (request: AuthenticatedRequest, response) => {
    const parsed = createUserDataSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Invalid user data payload." });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const role = normalizeKey(parsed.data.role);
    const fullName = parsed.data.fullName.trim();
    const uniqueId = parsed.data.uniqueId?.trim() || null;
    const isActive = parsed.data.isActive ?? true;

    if (!allowedRoles.has(role)) {
      response.status(400).json({ message: "Role is not allowed." });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      response.status(409).json({ message: "User already exists." });
      return;
    }

    const placeholderPasswordHash = await bcrypt.hash(generatePassword(14), 10);

    const user = await prisma.user.create({
      data: {
        email,
        role,
        fullName,
        uniqueId,
        isActive,
        passwordHash: placeholderPasswordHash,
      },
    });

    response.status(201).json({
      success: true,
      user: {
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        uniqueId: user.uniqueId ?? "N/A",
        isActive: user.isActive,
      },
    });
  },
);

adminRouter.put(
  "/users-data/:email",
  async (request: AuthenticatedRequest, response) => {
    const parsed = updateUserDataSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Invalid user data payload." });
      return;
    }

    const currentEmail = String(request.params.email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: currentEmail },
    });
    if (!existing) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    const nextEmail = parsed.data.email?.trim().toLowerCase() ?? currentEmail;
    const nextRole = parsed.data.role
      ? normalizeKey(parsed.data.role)
      : existing.role;
    const nextFullName = parsed.data.fullName?.trim() ?? existing.fullName;
    const nextUniqueId =
      parsed.data.uniqueId !== undefined
        ? parsed.data.uniqueId?.trim() || null
        : existing.uniqueId;
    const nextIsActive = parsed.data.isActive ?? existing.isActive;

    if (!allowedRoles.has(nextRole)) {
      response.status(400).json({ message: "Role is not allowed." });
      return;
    }

    if (nextEmail !== currentEmail) {
      const duplicate = await prisma.user.findUnique({
        where: { email: nextEmail },
      });
      if (duplicate) {
        response
          .status(409)
          .json({ message: "Another user already uses this email." });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { email: currentEmail },
      data: {
        email: nextEmail,
        role: nextRole,
        fullName: nextFullName,
        uniqueId: nextUniqueId,
        isActive: nextIsActive,
      },
    });

    response.json({
      success: true,
      user: {
        email: updated.email,
        role: updated.role,
        fullName: updated.fullName,
        uniqueId: updated.uniqueId ?? "N/A",
        isActive: updated.isActive,
      },
    });
  },
);

adminRouter.delete(
  "/users-data/:email",
  async (request: AuthenticatedRequest, response) => {
    const email = String(request.params.email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    await prisma.user.delete({ where: { email } });
    response.json({ success: true });
  },
);

adminRouter.get(
  "/users-credentials",
  async (request: AuthenticatedRequest, response) => {
    const search =
      (request.query.search as string | undefined)?.trim().toLowerCase() ?? "";

    const logs = await prisma.auditLog.findMany({
      where: { action: credentialAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const rows = logs
      .map((log) => {
        const payload = parseCredentialPayload(log.payload);
        if (!payload) return null;

        return {
          email: payload.email,
          fullName: payload.fullName,
          role: payload.role,
          uniqueId: payload.uniqueId ?? "N/A",
          password: payload.password,
          status: payload.status,
          generatedAt: log.createdAt,
          generatedBy: log.actorEmail ?? "system",
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        if (!search) return true;
        return (
          row.email.toLowerCase().includes(search) ||
          row.fullName.toLowerCase().includes(search) ||
          row.role.toLowerCase().includes(search) ||
          row.uniqueId.toLowerCase().includes(search)
        );
      });

    response.json(rows);
  },
);

adminRouter.put(
  "/users-credentials/:email/password",
  async (request: AuthenticatedRequest, response) => {
    const parsed = passwordUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Invalid password payload." });
      return;
    }

    const email = String(request.params.email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });

    await prisma.auditLog.create({
      data: {
        actorEmail: request.auth?.email ?? null,
        action: "USER_CREDENTIAL_PASSWORD_CHANGED",
        payload: {
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          uniqueId: user.uniqueId,
        },
      },
    });

    response.json({ success: true });
  },
);

adminRouter.get("/stats", async (_request: AuthenticatedRequest, response) => {
  const today = formatDayKey(new Date());
  const logs = await prisma.attendanceLog.findMany({
    where: { attendanceDay: today },
  });

  const present = new Set<string>();
  let late = 0;
  let guests = 0;
  let timeouts = 0;

  for (const log of logs) {
    if (log.attendanceType === "Time In") {
      if (log.userId) {
        present.add(log.userId);
      } else if (log.guestName) {
        present.add(`guest:${log.guestName.toLowerCase()}`);
      }
      if (log.status === "Late") {
        late += 1;
      }
    }

    if (log.category === "Guest") {
      guests += 1;
    }

    if (log.attendanceType === "Time Out") {
      timeouts += 1;
    }
  }

  response.json({
    present: present.size,
    late,
    outside: guests,
    timeouts,
  });
});

adminRouter.get("/logs", async (request: AuthenticatedRequest, response) => {
  const search = (request.query.search as string | undefined)?.trim() ?? "";
  const date = (request.query.date as string | undefined)?.trim() ?? "";
  const filter = (request.query.filter as string | undefined)?.trim() ?? "all";

  const dayKey =
    date ||
    (filter === "today"
      ? formatDayKey(new Date())
      : filter === "yesterday"
        ? formatDayKey(new Date(Date.now() - 86400000))
        : undefined);

  const logs = await prisma.attendanceLog.findMany({
    where: {
      ...(dayKey ? { attendanceDay: dayKey } : {}),
      ...(search
        ? {
            OR: [
              { guestName: { contains: search, mode: "insensitive" } },
              { category: { contains: search, mode: "insensitive" } },
              { status: { contains: search, mode: "insensitive" } },
              { ipAddress: { contains: search, mode: "insensitive" } },
              { locationText: { contains: search, mode: "insensitive" } },
              { purpose: { contains: search, mode: "insensitive" } },
              { imageFileName: { contains: search, mode: "insensitive" } },
              { user: { fullName: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { uniqueId: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  response.json(
    logs.map((log) => ({
      id: log.id,
      timestamp: formatDisplayDateTime(log.createdAt),
      attendanceDay: log.attendanceDay,
      uniqueId: log.user?.uniqueId ?? "N/A",
      fullName: log.user?.fullName ?? log.guestName ?? "N/A",
      category: log.category,
      purpose: log.purpose ?? "N/A",
      type: log.attendanceType,
      location: log.locationText,
      email: log.user?.email ?? log.guestEmail ?? "N/A",
      status: log.status,
      ip: log.ipAddress,
      hasImage: Boolean(log.imageData),
      imageUrl: log.imageData ? `/admin/logs/${log.id}/image` : null,
    })),
  );
});

adminRouter.get(
  "/logs/:id/image",
  async (request: AuthenticatedRequest, response) => {
    const record = await prisma.attendanceLog.findUnique({
      where: { id: String(request.params.id) },
    });
    if (!record || !record.imageData || !record.imageMimeType) {
      response.status(404).json({ message: "Image not found" });
      return;
    }

    response.setHeader("Content-Type", record.imageMimeType);
    response.send(Buffer.from(record.imageData));
  },
);

adminRouter.get(
  "/export-csv",
  async (_request: AuthenticatedRequest, response) => {
    const logs = await prisma.attendanceLog.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });
    const header = [
      "Timestamp",
      "Unique ID",
      "Full Name",
      "Category",
      "Purpose",
      "Type",
      "Location",
      "Email",
      "Status",
      "IP",
    ];
    const lines = [header.join(",")];

    for (const log of logs) {
      const row = [
        new Date(log.createdAt).toISOString(),
        log.user?.uniqueId ?? "N/A",
        log.user?.fullName ?? log.guestName ?? "N/A",
        log.category,
        log.purpose ?? "N/A",
        log.attendanceType,
        log.locationText,
        log.user?.email ?? log.guestEmail ?? "N/A",
        log.status,
        log.ipAddress,
      ].map((value) => `\"${String(value).replace(/\"/g, '\"\"')}\"`);
      lines.push(row.join(","));
    }

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="attendance-logs.csv"',
    );
    response.send(lines.join("\n"));
  },
);
