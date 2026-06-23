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
  const search = String(request.query.search ?? "").trim();
  const role = String(request.query.role ?? "").trim();

  const where: {
    overrideDate?: string;
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
    take: 2000,
  });

  response.json(rows.map(formatOverrideRow));
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
