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
  attendanceSchedule: z
    .array(
      z.object({
        day: z.enum(["mon", "tue", "wed", "thu", "fri"]),
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      }),
    )
    .min(1),
  isActive: z.boolean().optional(),
});

const updateUserDataSchema = z.object({
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  uniqueId: z.string().optional().nullable(),
  attendanceSchedule: z
    .array(
      z.object({
        day: z.enum(["mon", "tue", "wed", "thu", "fri"]),
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      }),
    )
    .min(1)
    .optional(),
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
  "visiting faculty",
  "human resource",
  "chief executive",
  "employee",
  "admin",
]);
const credentialAuditAction = "USER_CREDENTIAL_GENERATED";
const scheduleAuditAction = "USER_ATTENDANCE_SCHEDULE";
const passwordChangeAuditAction = "USER_CREDENTIAL_PASSWORD_CHANGED";

type CredentialPayload = {
  email: string;
  fullName: string;
  role: string;
  uniqueId: string | null;
  password: string;
  status: "created" | "updated";
};

type SchedulePayload = {
  email: string;
  schedule: Array<{ day: "mon" | "tue" | "wed" | "thu" | "fri"; startTime: string; endTime: string }>;
};

function weekdayKey(
  date: Date,
  timeZone: string,
): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone })
    .format(date)
    .toLowerCase();
  if (label.startsWith("mon")) return "mon";
  if (label.startsWith("tue")) return "tue";
  if (label.startsWith("wed")) return "wed";
  if (label.startsWith("thu")) return "thu";
  if (label.startsWith("fri")) return "fri";
  if (label.startsWith("sat")) return "sat";
  return "sun";
}

function parseMonthParam(value: string | undefined | null): {
  year: number;
  month: number;
  label: string;
} | null {
  const input = String(value ?? "").trim();
  const match = input.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month, label: `${match[1]}-${match[2]}` };
}

function monthDateRangeUTC(params: { year: number; month: number }): {
  start: Date;
  endExclusive: Date;
} {
  // Month is 1-based here.
  const start = new Date(Date.UTC(params.year, params.month - 1, 1, 0, 0, 0));
  const endExclusive = new Date(
    Date.UTC(params.year, params.month, 1, 0, 0, 0),
  );
  return { start, endExclusive };
}

function listMonthDayKeys(params: {
  year: number;
  month: number;
  timeZone: string;
}): Array<{ dayKey: string; weekday: ReturnType<typeof weekdayKey> }> {
  const { start, endExclusive } = monthDateRangeUTC(params);
  const days: Array<{ dayKey: string; weekday: ReturnType<typeof weekdayKey> }> =
    [];
  for (
    let d = new Date(start);
    d < endExclusive;
    d = new Date(d.getTime() + 86400000)
  ) {
    const dayKey = formatDayKey(d);
    days.push({ dayKey, weekday: weekdayKey(d, params.timeZone) });
  }
  return days;
}

function monthlyTableName(monthLabel: string): string {
  const safe = monthLabel.replace("-", "_");
  return `monthly_attendance_${safe}`;
}

async function monthlyTableExists(monthLabel: string): Promise<boolean> {
  const table = monthlyTableName(monthLabel);
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1
    ) AS exists;
    `,
    table,
  );
  return Boolean(rows[0]?.exists);
}

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

function parseSchedulePayload(payload: unknown): SchedulePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.email !== "string" || !Array.isArray(row.schedule)) return null;

  const validDays = new Set(["mon", "tue", "wed", "thu", "fri"]);
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const schedule = row.schedule
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      day: String(item.day || "").toLowerCase(),
      startTime: String(item.startTime || ""),
      endTime: String(item.endTime || ""),
    }))
    .filter(
      (item) =>
        validDays.has(item.day) &&
        timeRegex.test(item.startTime) &&
        timeRegex.test(item.endTime),
    ) as SchedulePayload["schedule"];

  return {
    email: row.email.trim().toLowerCase(),
    schedule,
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

function hasInvalidScheduleRange(
  schedule: Array<{ day: string; startTime: string; endTime: string }>,
): boolean {
  const toMinutes = (value: string): number => {
    const parts = value.split(":").map(Number);
    const hour = parts[0] ?? 0;
    const minute = parts[1] ?? 0;
    return hour * 60 + minute;
  };
  return schedule.some(
    (row) => toMinutes(row.startTime) >= toMinutes(row.endTime),
  );
}

/** Removes user row plus attendance, credential/schedule audit logs, and monthly summary rows. */
async function purgeUserAndAllRecords(
  normalizedEmail: string,
): Promise<"deleted" | "not_found"> {
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (!user) return "not_found";

  const credentialLogs = await prisma.auditLog.findMany({
    where: { action: credentialAuditAction },
    select: { id: true, payload: true },
    take: 5000,
  });
  const credentialLogIds = credentialLogs
    .filter((log) => {
      const payload = parseCredentialPayload(log.payload);
      return payload?.email.toLowerCase() === normalizedEmail;
    })
    .map((log) => log.id);

  const passwordChangeLogs = await prisma.auditLog.findMany({
    where: { action: passwordChangeAuditAction },
    select: { id: true, payload: true },
    take: 5000,
  });
  const passwordChangeLogIds = passwordChangeLogs
    .filter((log) => {
      if (!log.payload || typeof log.payload !== "object") return false;
      const payload = log.payload as Record<string, unknown>;
      return (
        typeof payload.email === "string" &&
        payload.email.trim().toLowerCase() === normalizedEmail
      );
    })
    .map((log) => log.id);

  const scheduleLogs = await prisma.auditLog.findMany({
    where: { action: scheduleAuditAction },
    select: { id: true, payload: true },
    take: 5000,
  });
  const scheduleLogIds = scheduleLogs
    .filter((log) => {
      const payload = parseSchedulePayload(log.payload);
      return payload?.email === normalizedEmail;
    })
    .map((log) => log.id);

  const monthRows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'monthly_attendance_%'`,
  );
  const safeMonthlyTables = monthRows
    .map((row) => row.tablename)
    .filter((name) => /^monthly_attendance_[0-9]{4}_[0-9]{2}$/.test(name));

  const auditIds = [
    ...new Set([...credentialLogIds, ...passwordChangeLogIds, ...scheduleLogIds]),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.attendanceLog.deleteMany({ where: { userId: user.id } });

    if (auditIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    }

    for (const table of safeMonthlyTables) {
      await tx.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE user_id = $1`,
        user.id,
      );
    }

    await tx.user.delete({ where: { id: user.id } });
  });

  return "deleted";
}

/** Keeps denormalized copies (attendance category, email logs, monthly rows, audit payloads) in sync after profile edits. */
async function propagateUserProfileChanges(params: {
  userId: string;
  previousEmail: string;
  nextEmail: string;
  nextFullName: string;
  nextRole: string;
  nextUniqueId: string | null;
}): Promise<void> {
  const {
    userId,
    previousEmail,
    nextEmail,
    nextFullName,
    nextRole,
    nextUniqueId,
  } = params;
  const prevKey = previousEmail.trim().toLowerCase();

  await prisma.attendanceLog.updateMany({
    where: { userId },
    data: { category: nextRole },
  });

  await prisma.emailLog.updateMany({
    where: {
      attendance: { userId },
    },
    data: {
      recipientEmail: nextEmail,
      subject: `Attendance Receipt - ${nextFullName}`,
    },
  });

  const monthRows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'monthly_attendance_%'`,
  );
  const safeMonthlyTables = monthRows
    .map((row) => row.tablename)
    .filter((name) => /^monthly_attendance_[0-9]{4}_[0-9]{2}$/.test(name));

  for (const table of safeMonthlyTables) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET email = $1, full_name = $2, role = $3, unique_id = $4 WHERE user_id = $5`,
      nextEmail,
      nextFullName,
      nextRole,
      nextUniqueId,
      userId,
    );
  }

  const credentialLogs = await prisma.auditLog.findMany({
    where: { action: credentialAuditAction },
    select: { id: true, payload: true },
    take: 5000,
  });
  for (const log of credentialLogs) {
    const payload = parseCredentialPayload(log.payload);
    if (!payload) continue;
    if (payload.email.toLowerCase() !== prevKey) continue;
    await prisma.auditLog.update({
      where: { id: log.id },
      data: {
        payload: {
          email: nextEmail,
          fullName: nextFullName,
          role: nextRole,
          uniqueId: nextUniqueId,
          password: payload.password,
          status: payload.status,
        },
      },
    });
  }

  const passwordLogs = await prisma.auditLog.findMany({
    where: { action: passwordChangeAuditAction },
    select: { id: true, payload: true },
    take: 5000,
  });
  for (const log of passwordLogs) {
    if (!log.payload || typeof log.payload !== "object") continue;
    const p = log.payload as Record<string, unknown>;
    const em =
      typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    if (em !== prevKey) continue;
    await prisma.auditLog.update({
      where: { id: log.id },
      data: {
        payload: {
          email: nextEmail,
          fullName: nextFullName,
          role: nextRole,
          uniqueId: nextUniqueId,
        },
      },
    });
  }

  if (nextEmail.trim().toLowerCase() !== prevKey) {
    const schLogs = await prisma.auditLog.findMany({
      where: { action: scheduleAuditAction },
      select: { id: true, payload: true },
      take: 5000,
    });
    for (const log of schLogs) {
      const sp = parseSchedulePayload(log.payload);
      if (!sp || sp.email !== prevKey) continue;
      await prisma.auditLog.update({
        where: { id: log.id },
        data: {
          payload: {
            email: nextEmail.trim().toLowerCase(),
            schedule: sp.schedule,
          },
        },
      });
    }
  }
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
    const scheduleLogs = await prisma.auditLog.findMany({
      where: { action: scheduleAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const generatedEmailSet = new Set<string>();
    for (const log of credentialLogs) {
      const payload = parseCredentialPayload(log.payload);
      if (payload) generatedEmailSet.add(payload.email.toLowerCase());
    }
    const scheduleByEmail = new Map<
      string,
      Array<{ day: "mon" | "tue" | "wed" | "thu" | "fri"; startTime: string; endTime: string }>
    >();
    for (const log of scheduleLogs) {
      const payload = parseSchedulePayload(log.payload);
      if (!payload) continue;
      if (!scheduleByEmail.has(payload.email)) {
        scheduleByEmail.set(payload.email, payload.schedule);
      }
    }

    response.json(
      users.map((user) => ({
        email: user.email,
        generated: generatedEmailSet.has(user.email.toLowerCase()),
        role: user.role,
        fullName: user.fullName,
        uniqueId: user.uniqueId ?? "N/A",
        attendanceSchedule: scheduleByEmail.get(user.email.toLowerCase()) ?? [],
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
    if (hasInvalidScheduleRange(parsed.data.attendanceSchedule)) {
      response.status(400).json({
        message: "Each attendance schedule must have end time after start time.",
      });
      return;
    }
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

    await prisma.auditLog.create({
      data: {
        actorEmail: request.auth?.email ?? null,
        action: scheduleAuditAction,
        payload: {
          email,
          schedule: parsed.data.attendanceSchedule,
        },
      },
    });

    response.status(201).json({
      success: true,
      user: {
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        uniqueId: user.uniqueId ?? "N/A",
        attendanceSchedule: parsed.data.attendanceSchedule,
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

    if (
      parsed.data.attendanceSchedule &&
      hasInvalidScheduleRange(parsed.data.attendanceSchedule)
    ) {
      response.status(400).json({
        message: "Each attendance schedule must have end time after start time.",
      });
      return;
    }

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

    const scheduleLogs = await prisma.auditLog.findMany({
      where: { action: scheduleAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const latestSchedule = scheduleLogs
      .map((log) => parseSchedulePayload(log.payload))
      .find((payload) => payload?.email === currentEmail);
    const scheduleToSave =
      parsed.data.attendanceSchedule ?? latestSchedule?.schedule ?? [];

    await propagateUserProfileChanges({
      userId: updated.id,
      previousEmail: currentEmail,
      nextEmail: updated.email,
      nextFullName: updated.fullName,
      nextRole: updated.role,
      nextUniqueId: updated.uniqueId,
    });

    if (scheduleToSave.length > 0 || nextEmail !== currentEmail) {
      await prisma.auditLog.create({
        data: {
          actorEmail: request.auth?.email ?? null,
          action: scheduleAuditAction,
          payload: {
            email: nextEmail,
            schedule: scheduleToSave,
          },
        },
      });
    }

    response.json({
      success: true,
      user: {
        email: updated.email,
        role: updated.role,
        fullName: updated.fullName,
        uniqueId: updated.uniqueId ?? "N/A",
        attendanceSchedule: scheduleToSave,
        isActive: updated.isActive,
      },
    });
  },
);

adminRouter.delete(
  "/users-data/:email",
  async (request: AuthenticatedRequest, response) => {
    const email = String(request.params.email).trim().toLowerCase();
    const result = await purgeUserAndAllRecords(email);
    if (result === "not_found") {
      response.status(404).json({ message: "User not found." });
      return;
    }
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

adminRouter.get(
  "/shifts-today",
  async (request: AuthenticatedRequest, response) => {
    const search = (request.query.search as string | undefined)?.trim() ?? "";
    const now = new Date();
    const todayKey = formatDayKey(now);
    const tz = "Asia/Karachi";
    const todayWeekday = weekdayKey(now, tz);

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

    const scheduleLogs = await prisma.auditLog.findMany({
      where: { action: scheduleAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const scheduleByEmail = new Map<
      string,
      Array<{ day: "mon" | "tue" | "wed" | "thu" | "fri"; startTime: string; endTime: string }>
    >();
    for (const log of scheduleLogs) {
      const payload = parseSchedulePayload(log.payload);
      if (!payload) continue;
      const key = payload.email.toLowerCase();
      if (!scheduleByEmail.has(key)) {
        scheduleByEmail.set(key, payload.schedule);
      }
    }

    const todaysLogs = await prisma.attendanceLog.findMany({
      where: { attendanceDay: todayKey, userId: { not: null } },
      select: {
        userId: true,
        attendanceType: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const timeInByUserId = new Map<string, Date>();
    const timeOutByUserId = new Map<string, Date>();
    const statusByUserId = new Map<string, string>();
    for (const log of todaysLogs) {
      if (!log.userId) continue;
      if (log.attendanceType === "Time In" && !timeInByUserId.has(log.userId)) {
        timeInByUserId.set(log.userId, log.createdAt);
        statusByUserId.set(log.userId, log.status);
      }
      if (
        log.attendanceType === "Time Out" &&
        !timeOutByUserId.has(log.userId)
      ) {
        timeOutByUserId.set(log.userId, log.createdAt);
      }
    }

    const rows = users.map((user) => {
      const schedule = scheduleByEmail.get(user.email.toLowerCase()) ?? [];
      const todaySlot =
        todayWeekday === "sat" || todayWeekday === "sun"
          ? null
          : schedule.find((s) => s.day === todayWeekday) ?? null;
      const timeIn = timeInByUserId.get(user.id) ?? null;
      const timeOut = timeOutByUserId.get(user.id) ?? null;
      const timeInStatus = statusByUserId.get(user.id) ?? null;

      let attendanceStatus: string = "Not marked";
      if (timeIn && !timeOut) attendanceStatus = timeInStatus ?? "Time In";
      if (timeIn && timeOut) attendanceStatus = "Checked out";

      return {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        uniqueId: user.uniqueId ?? "N/A",
        shiftStart: todaySlot?.startTime ?? "N/A",
        shiftEnd: todaySlot?.endTime ?? "N/A",
        timeInAt: timeIn ? formatDisplayDateTime(timeIn).time : "—",
        timeOutAt: timeOut ? formatDisplayDateTime(timeOut).time : "—",
        status: attendanceStatus,
      };
    });

    response.json(rows);
  },
);

adminRouter.get(
  "/monthly-attendance",
  async (request: AuthenticatedRequest, response) => {
    const monthParam = parseMonthParam(request.query.month as string | undefined);
    if (!monthParam) {
      response.status(400).json({ message: "Invalid month. Use YYYY-MM." });
      return;
    }

    const search = (request.query.search as string | undefined)?.trim() ?? "";
    const exists = await monthlyTableExists(monthParam.label);
    if (!exists) {
      response.json([]);
      return;
    }

    const table = monthlyTableName(monthParam.label);
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        month: string;
        email: string;
        fullName: string;
        role: string;
        uniqueId: string | null;
        totalWeekdays: number;
        presentDays: number;
        absentDays: number;
        lateDays: number;
        latePenaltyAbsents: number;
        effectivePresent: number;
        effectiveAbsent: number;
      }>
    >(
      `
      SELECT
        $1::text AS month,
        email,
        full_name AS "fullName",
        role,
        unique_id AS "uniqueId",
        total_weekdays AS "totalWeekdays",
        present_days AS "presentDays",
        GREATEST(0, total_weekdays - present_days) AS "absentDays",
        late_days AS "lateDays",
        FLOOR(late_days / 3.0) :: int AS "latePenaltyAbsents",
        GREATEST(0, present_days - FLOOR(late_days / 3.0) :: int) AS "effectivePresent",
        GREATEST(0, total_weekdays - present_days) + FLOOR(late_days / 3.0) :: int AS "effectiveAbsent"
      FROM "${table}"
      WHERE ($2 = '' OR email ILIKE '%' || $2 || '%' OR full_name ILIKE '%' || $2 || '%' OR role ILIKE '%' || $2 || '%' OR COALESCE(unique_id,'') ILIKE '%' || $2 || '%')
      ORDER BY full_name ASC
      LIMIT 5000;
      `,
      monthParam.label,
      search,
    );
    response.json(rows);
  },
);

adminRouter.get(
  "/monthly-attendance/months",
  async (_request: AuthenticatedRequest, response) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename LIKE 'monthly_attendance_%'
      ORDER BY tablename DESC
      LIMIT 240;
      `,
    );
    const months = rows
      .map((row) => row.tablename.replace("monthly_attendance_", ""))
      .map((value) => value.replace("_", "-"))
      .filter((value) => /^\d{4}-\d{2}$/.test(value));
    response.json(months);
  },
);

adminRouter.get(
  "/monthly-attendance/export-csv",
  async (request: AuthenticatedRequest, response) => {
    const monthParam = parseMonthParam(request.query.month as string | undefined);
    if (!monthParam) {
      response.status(400).json({ message: "Invalid month. Use YYYY-MM." });
      return;
    }

    const exists = await monthlyTableExists(monthParam.label);
    if (!exists) {
      response.status(404).json({ message: "No monthly table for this month." });
      return;
    }
    const table = monthlyTableName(monthParam.label);
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        month: string;
        fullName: string;
        email: string;
        role: string;
        uniqueId: string | null;
        totalWeekdays: number;
        presentDays: number;
        absentDays: number;
        lateDays: number;
        latePenaltyAbsents: number;
        effectivePresent: number;
        effectiveAbsent: number;
      }>
    >(
      `
      SELECT
        $1::text AS month,
        full_name AS "fullName",
        email,
        role,
        unique_id AS "uniqueId",
        total_weekdays AS "totalWeekdays",
        present_days AS "presentDays",
        GREATEST(0, total_weekdays - present_days) AS "absentDays",
        late_days AS "lateDays",
        FLOOR(late_days / 3.0) :: int AS "latePenaltyAbsents",
        GREATEST(0, present_days - FLOOR(late_days / 3.0) :: int) AS "effectivePresent",
        GREATEST(0, total_weekdays - present_days) + FLOOR(late_days / 3.0) :: int AS "effectiveAbsent"
      FROM "${table}"
      ORDER BY full_name ASC
      LIMIT 5000;
      `,
      monthParam.label,
    );

    const header = [
      "Month",
      "Full Name",
      "Gmail",
      "Role",
      "Unique ID",
      "Total Weekdays",
      "Present",
      "Absent",
      "Late",
      "Late Penalty Absents",
      "Effective Present",
      "Effective Absent",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      const values = [
        row.month,
        row.fullName,
        row.email,
        row.role,
        row.uniqueId,
        row.totalWeekdays,
        row.presentDays,
        row.absentDays,
        row.lateDays,
        row.latePenaltyAbsents,
        row.effectivePresent,
        row.effectiveAbsent,
      ].map((value) => `\"${String(value).replace(/\"/g, '\"\"')}\"`);
      lines.push(values.join(","));
    }

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="monthly-attendance-${monthParam.label}.csv"`,
    );
    response.send(lines.join("\n"));
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

    const credentialLogs = await prisma.auditLog.findMany({
      where: { action: credentialAuditAction },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const latestCredentialLog = credentialLogs.find((log) => {
      const payload = parseCredentialPayload(log.payload);
      return payload?.email.toLowerCase() === email;
    });

    if (latestCredentialLog) {
      await prisma.auditLog.update({
        where: { id: latestCredentialLog.id },
        data: {
          actorEmail: request.auth?.email ?? null,
          payload: {
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            uniqueId: user.uniqueId,
            password: parsed.data.password,
            status: "updated",
          },
        },
      });
    } else {
      await prisma.auditLog.create({
        data: {
          actorEmail: request.auth?.email ?? null,
          action: credentialAuditAction,
          payload: {
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            uniqueId: user.uniqueId,
            password: parsed.data.password,
            status: "updated",
          },
        },
      });
    }

    response.json({ success: true });
  },
);

adminRouter.delete(
  "/users-credentials/:email",
  async (request: AuthenticatedRequest, response) => {
    const email = String(request.params.email).trim().toLowerCase();
    const result = await purgeUserAndAllRecords(email);
    if (result === "not_found") {
      response.status(404).json({ message: "User not found." });
      return;
    }
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
