import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../lib/auth.js";
import {
  hasInvalidTimeRange,
  TIME_REGEX,
} from "../lib/schedules.js";
import {
  buildOverrideRangeGroups,
  enumerateDatesInclusive,
  RANGE_OVERRIDE_AUDIT_ACTION,
} from "../lib/override-ranges.js";
import {
  bulkUpsertDayScheduleOverrides,
  expandOverrideRowsForRange,
} from "../lib/day-schedule-override-bulk.js";

export const dayScheduleOverridesRouter = Router();

dayScheduleOverridesRouter.use(requireAuth);
dayScheduleOverridesRouter.use(requireAdmin);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const timingSchema = z.object({
  startTime: z.string().regex(TIME_REGEX),
  endTime: z.string().regex(TIME_REGEX),
});

const createSameSchema = z.object({
  date: dateSchema,
  mode: z.literal("same"),
  userIds: z.array(z.string().min(1)).min(1).max(500),
  startTime: z.string().regex(TIME_REGEX),
  endTime: z.string().regex(TIME_REGEX),
});

const createCustomSchema = z.object({
  date: dateSchema,
  mode: z.literal("custom"),
  entries: z
    .array(
      z.object({
        userId: z.string().min(1),
        startTime: z.string().regex(TIME_REGEX),
        endTime: z.string().regex(TIME_REGEX),
      }),
    )
    .min(1)
    .max(500),
});

const createSchema = z.discriminatedUnion("mode", [
  createSameSchema,
  createCustomSchema,
]);

const updateSchema = timingSchema;

const createRangeSameSchema = z.object({
  rangeStart: dateSchema,
  rangeEnd: dateSchema,
  mode: z.literal("same"),
  userIds: z.array(z.string().min(1)).min(1).max(500),
  startTime: z.string().regex(TIME_REGEX),
  endTime: z.string().regex(TIME_REGEX),
});

const createRangeCustomSchema = z.object({
  rangeStart: dateSchema,
  rangeEnd: dateSchema,
  mode: z.literal("custom"),
  entries: z
    .array(
      z.object({
        userId: z.string().min(1),
        startTime: z.string().regex(TIME_REGEX),
        endTime: z.string().regex(TIME_REGEX),
      }),
    )
    .min(1)
    .max(500),
});

const createRangeSchema = z.discriminatedUnion("mode", [
  createRangeSameSchema,
  createRangeCustomSchema,
]);

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

const rangeDeleteSchema = z.object({
  userId: z.string().min(1),
  rangeStart: dateSchema,
  rangeEnd: dateSchema,
});

function formatOverrideRow(row: {
  id: string;
  overrideDate: string;
  startTime: string;
  endTime: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    uniqueId: string | null;
  };
}) {
  return {
    id: row.id,
    userId: row.user.id,
    overrideDate: row.overrideDate,
    startTime: row.startTime,
    endTime: row.endTime,
    email: row.user.email,
    fullName: row.user.fullName,
    role: row.user.role,
    uniqueId: row.user.uniqueId ?? "N/A",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

dayScheduleOverridesRouter.get("/", async (request, response) => {
  const dateRaw = String(request.query.date ?? "").trim();
  const userId = String(request.query.userId ?? "").trim();
  const search = String(request.query.search ?? "").trim();
  const role = String(request.query.role ?? "").trim();

  const where: {
    overrideDate?: string;
    userId?: string;
    user?: {
      OR?: Array<Record<string, unknown>>;
      role?: { equals: string; mode: "insensitive" };
    };
  } = {};

  if (dateRaw) {
    const parsedDate = dateSchema.safeParse(dateRaw);
    if (!parsedDate.success) {
      response.status(400).json({ message: "Invalid date. Use YYYY-MM-DD." });
      return;
    }
    where.overrideDate = parsedDate.data;
  }

  if (userId) {
    where.userId = userId;
  }

  if (role) {
    where.user = { ...(where.user ?? {}), role: { equals: role, mode: "insensitive" } };
  }

  if (search) {
    where.user = {
      ...(where.user ?? {}),
      OR: [
        { email: { contains: search, mode: "insensitive" } },
        { fullName: { contains: search, mode: "insensitive" } },
        { role: { contains: search, mode: "insensitive" } },
        { uniqueId: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const rows = await prisma.dayScheduleOverride.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          uniqueId: true,
        },
      },
    },
    orderBy: [{ overrideDate: "desc" }, { user: { fullName: "asc" } }],
    take: userId ? 5000 : 2000,
  });

  response.json(rows.map(formatOverrideRow));
});

dayScheduleOverridesRouter.get("/users-with-overrides", async (request, response) => {
  const role = String(request.query.role ?? "").trim();
  const search = String(request.query.search ?? "").trim().toLowerCase();

  const overrides = await prisma.dayScheduleOverride.findMany({
    where: role
      ? { user: { role: { equals: role, mode: "insensitive" } } }
      : {},
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          uniqueId: true,
        },
      },
    },
    orderBy: { user: { fullName: "asc" } },
  });

  const counts = new Map<string, number>();
  const usersById = new Map<
    string,
    {
      userId: string;
      fullName: string;
      email: string;
      role: string;
      uniqueId: string;
      overrideCount: number;
    }
  >();

  for (const row of overrides) {
    counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    if (!usersById.has(row.userId)) {
      usersById.set(row.userId, {
        userId: row.user.id,
        fullName: row.user.fullName,
        email: row.user.email,
        role: row.user.role,
        uniqueId: row.user.uniqueId ?? "N/A",
        overrideCount: 0,
      });
    }
  }

  const users = Array.from(usersById.values())
    .map((user) => ({
      ...user,
      overrideCount: counts.get(user.userId) ?? 0,
    }))
    .filter((user) => {
      if (!search) return true;
      return (
        user.fullName.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search) ||
        user.role.toLowerCase().includes(search) ||
        user.uniqueId.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  response.json(users);
});

async function loadFilteredOverrides(params: {
  search: string;
  role: string;
}) {
  const where: {
    user?: {
      OR?: Array<Record<string, unknown>>;
      role?: { equals: string; mode: "insensitive" };
    };
  } = {};

  if (params.role) {
    where.user = {
      ...(where.user ?? {}),
      role: { equals: params.role, mode: "insensitive" },
    };
  }

  if (params.search) {
    where.user = {
      ...(where.user ?? {}),
      OR: [
        { email: { contains: params.search, mode: "insensitive" } },
        { fullName: { contains: params.search, mode: "insensitive" } },
        { role: { contains: params.search, mode: "insensitive" } },
        { uniqueId: { contains: params.search, mode: "insensitive" } },
      ],
    };
  }

  const rows = await prisma.dayScheduleOverride.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          uniqueId: true,
        },
      },
    },
    orderBy: [{ overrideDate: "desc" }, { user: { fullName: "asc" } }],
    take: 5000,
  });

  return rows.map(formatOverrideRow);
}

dayScheduleOverridesRouter.get("/ranges", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const role = String(request.query.role ?? "").trim();

  const overrides = await loadFilteredOverrides({ search, role });
  const auditLogs = await prisma.auditLog.findMany({
    where: { action: RANGE_OVERRIDE_AUDIT_ACTION },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { payload: true },
  });

  const auditPayloads = auditLogs
    .map((log) => log.payload as Record<string, unknown>)
    .filter((payload) => payload && typeof payload === "object")
    .map((payload) => ({
      rangeStart:
        typeof payload.rangeStart === "string" ? payload.rangeStart : undefined,
      rangeEnd:
        typeof payload.rangeEnd === "string" ? payload.rangeEnd : undefined,
      userIds: Array.isArray(payload.userIds)
        ? payload.userIds.filter((id): id is string => typeof id === "string")
        : [],
    }));

  response.json(
    buildOverrideRangeGroups({
      overrides,
      auditPayloads,
    }),
  );
});

dayScheduleOverridesRouter.post("/bulk-delete", async (request, response) => {
  const parsed = bulkDeleteSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid bulk delete payload." });
    return;
  }

  const ids = [...new Set(parsed.data.ids)];
  const rows = await prisma.dayScheduleOverride.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (rows.length === 0) {
    response.status(404).json({ message: "No overrides found to delete." });
    return;
  }

  await prisma.dayScheduleOverride.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });

  response.json({
    success: true,
    count: rows.length,
    message: `Removed ${rows.length} override(s).`,
  });
});

dayScheduleOverridesRouter.post("/range-delete", async (request, response) => {
  const parsed = rangeDeleteSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid range delete payload." });
    return;
  }

  const { userId, rangeStart, rangeEnd } = parsed.data;
  if (rangeEnd < rangeStart) {
    response.status(400).json({ message: "Invalid date range." });
    return;
  }

  const result = await prisma.dayScheduleOverride.deleteMany({
    where: {
      userId,
      overrideDate: { gte: rangeStart, lte: rangeEnd },
    },
  });

  response.json({
    success: true,
    count: result.count,
    message: `Removed ${result.count} override(s) for the selected range.`,
  });
});

dayScheduleOverridesRouter.post("/range", async (request, response) => {
  const parsed = createRangeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid range override payload." });
    return;
  }

  const payload = parsed.data;
  if (payload.rangeEnd < payload.rangeStart) {
    response.status(400).json({ message: "Range end must be on or after start." });
    return;
  }

  const dates = enumerateDatesInclusive(payload.rangeStart, payload.rangeEnd);
  if (dates.length === 0) {
    response.status(400).json({ message: "Range contains no dates." });
    return;
  }
  if (dates.length > 366) {
    response.status(400).json({ message: "Range is too large (max 366 days)." });
    return;
  }

  const perDateEntries =
    payload.mode === "same"
      ? payload.userIds.map((userId) => ({
          userId,
          startTime: payload.startTime,
          endTime: payload.endTime,
        }))
      : payload.entries;

  for (const entry of perDateEntries) {
    if (hasInvalidTimeRange(entry.startTime, entry.endTime)) {
      response.status(400).json({
        message: "Each override must have end time after start time.",
      });
      return;
    }
  }

  const userIds = [...new Set(perDateEntries.map((entry) => entry.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  if (users.length !== userIds.length) {
    response.status(400).json({ message: "One or more selected users were not found." });
    return;
  }

  const actorEmail = (request as AuthenticatedRequest).auth?.email ?? null;

  const rowsToUpsert = expandOverrideRowsForRange({
    dates,
    entries: perDateEntries,
  });

  const savedCount = await bulkUpsertDayScheduleOverrides(rowsToUpsert);

  await prisma.auditLog.create({
    data: {
      actorEmail,
      action: RANGE_OVERRIDE_AUDIT_ACTION,
      payload: {
        rangeStart: payload.rangeStart,
        rangeEnd: payload.rangeEnd,
        mode: payload.mode,
        userIds,
        dayCount: dates.length,
        rowCount: savedCount,
      },
    },
  });

  response.json({
    success: true,
    rangeStart: payload.rangeStart,
    rangeEnd: payload.rangeEnd,
    count: savedCount,
    message: `Timing override saved for ${userIds.length} user(s) across ${dates.length} day(s).`,
  });
});

dayScheduleOverridesRouter.get("/dates", async (_request, response) => {
  const rows = await prisma.dayScheduleOverride.findMany({
    distinct: ["overrideDate"],
    select: { overrideDate: true },
    orderBy: { overrideDate: "desc" },
    take: 365,
  });
  response.json(rows.map((row) => row.overrideDate));
});

dayScheduleOverridesRouter.post("/", async (request, response) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid day override payload." });
    return;
  }

  const payload = parsed.data;
  const entries =
    payload.mode === "same"
      ? payload.userIds.map((userId) => ({
          userId,
          startTime: payload.startTime,
          endTime: payload.endTime,
        }))
      : payload.entries;

  for (const entry of entries) {
    if (hasInvalidTimeRange(entry.startTime, entry.endTime)) {
      response.status(400).json({
        message: "Each override must have end time after start time.",
      });
      return;
    }
  }

  const userIds = [...new Set(entries.map((entry) => entry.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  if (users.length !== userIds.length) {
    response.status(400).json({ message: "One or more selected users were not found." });
    return;
  }

  const date = payload.date;
  const actorEmail = (request as AuthenticatedRequest).auth?.email ?? null;

  const saved = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const entry of entries) {
      const row = await tx.dayScheduleOverride.upsert({
        where: {
          userId_overrideDate: {
            userId: entry.userId,
            overrideDate: date,
          },
        },
        create: {
          userId: entry.userId,
          overrideDate: date,
          startTime: entry.startTime,
          endTime: entry.endTime,
        },
        update: {
          startTime: entry.startTime,
          endTime: entry.endTime,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true,
              uniqueId: true,
            },
          },
        },
      });
      results.push(row);
    }

    await tx.auditLog.create({
      data: {
        actorEmail,
        action: "DAY_SCHEDULE_OVERRIDE_SAVED",
        payload: {
          date,
          mode: payload.mode,
          userCount: results.length,
          userIds: results.map((row) => row.userId),
        },
      },
    });

    return results;
  });

  response.json({
    success: true,
    date,
    count: saved.length,
    overrides: saved.map(formatOverrideRow),
    message: `Timing override saved for ${saved.length} user(s) on ${date}.`,
  });
});

dayScheduleOverridesRouter.put("/:id", async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid timing payload." });
    return;
  }

  if (hasInvalidTimeRange(parsed.data.startTime, parsed.data.endTime)) {
    response.status(400).json({
      message: "End time must be after start time.",
    });
    return;
  }

  const id = String(request.params.id ?? "").trim();
  const existing = await prisma.dayScheduleOverride.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          uniqueId: true,
        },
      },
    },
  });

  if (!existing) {
    response.status(404).json({ message: "Override not found." });
    return;
  }

  const updated = await prisma.dayScheduleOverride.update({
    where: { id },
    data: {
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          uniqueId: true,
        },
      },
    },
  });

  response.json({
    success: true,
    override: formatOverrideRow(updated),
    message: `Override updated for ${updated.user.fullName} on ${updated.overrideDate}.`,
  });
});

dayScheduleOverridesRouter.delete("/:id", async (request, response) => {
  const id = String(request.params.id ?? "").trim();
  const existing = await prisma.dayScheduleOverride.findUnique({
    where: { id },
    include: {
      user: { select: { fullName: true } },
    },
  });

  if (!existing) {
    response.status(404).json({ message: "Override not found." });
    return;
  }

  await prisma.dayScheduleOverride.delete({ where: { id } });

  response.json({
    success: true,
    message: `Override removed for ${existing.user.fullName} on ${existing.overrideDate}.`,
  });
});
