import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth.js";
import {
  allowedPrefixMatch,
  calculateDistanceMeters,
  formatDayKey,
  imageBufferFromDataUrl,
  shouldEnforceAccessGate,
} from "../lib/rules.js";
import { env } from "../config/env.js";
import { sendAttendanceEmail } from "../lib/email.js";
import {
  evaluateDayScheduleForEffective,
  evaluateScheduleWindowForEffective,
  getEffectiveDaySchedule,
  getWeekdayKey,
  type ScheduleDay,
} from "../lib/schedules.js";

export const attendanceRouter = Router();

function parseMonthFromDayKey(
  dayKey: string,
): { year: number; month: number; label: string } | null {
  const match = String(dayKey).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month, label: `${match[1]}-${match[2]}` };
}

function monthlyTableName(monthLabel: string): string {
  // monthLabel is YYYY-MM
  const safe = monthLabel.replace("-", "_");
  return `monthly_attendance_${safe}`;
}

async function ensureMonthlyAttendanceTable(monthLabel: string) {
  const table = monthlyTableName(monthLabel);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      unique_id TEXT,
      total_weekdays INTEGER NOT NULL DEFAULT 0,
      present_days INTEGER NOT NULL DEFAULT 0,
      late_days INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function countTotalWeekdaysInMonth(params: {
  year: number;
  month: number;
  timeZone: string;
  scheduleDays: Set<ScheduleDay>;
}): number {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1, 0, 0, 0));
  const endExclusive = new Date(
    Date.UTC(params.year, params.month, 1, 0, 0, 0),
  );
  let total = 0;
  for (
    let d = new Date(start);
    d < endExclusive;
    d = new Date(d.getTime() + 86400000)
  ) {
    const weekday = getWeekdayKey(d, params.timeZone);
    if (
      weekday === "mon" ||
      weekday === "tue" ||
      weekday === "wed" ||
      weekday === "thu" ||
      weekday === "fri"
    ) {
      if (params.scheduleDays.has(weekday as ScheduleDay)) total += 1;
    }
  }
  return total;
}

async function upsertMonthlySummary(params: {
  monthLabel: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    uniqueId: string | null;
  };
  totalWeekdays: number;
  incrementPresent: number;
  incrementLate: number;
}) {
  const table = monthlyTableName(params.monthLabel);
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "${table}" (user_id, email, full_name, role, unique_id, total_weekdays, present_days, late_days, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      unique_id = EXCLUDED.unique_id,
      total_weekdays = GREATEST("${table}".total_weekdays, EXCLUDED.total_weekdays),
      present_days = "${table}".present_days + $7,
      late_days = "${table}".late_days + $8,
      updated_at = NOW();
    `,
    params.user.id,
    params.user.email,
    params.user.fullName,
    params.user.role,
    params.user.uniqueId,
    params.totalWeekdays,
    params.incrementPresent,
    params.incrementLate,
  );
}

const attendanceSchema = z.object({
  type: z.enum(["Time In", "Time Out"]),
  purpose: z.string().optional().nullable(),
  location: z.string().min(1),
  clientIp: z.string().min(1),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  imageDataUrl: z.string().optional().nullable(),
});

const guestSchema = attendanceSchema.extend({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")).optional(),
});

function assertAccessAllowed(
  clientIp: string,
  latitude?: number | null,
  longitude?: number | null,
): string | null {
  if (!shouldEnforceAccessGate()) {
    return null;
  }

  if (!allowedPrefixMatch(clientIp)) {
    return "Unauthorized network connection detected.";
  }

  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude === null ||
    longitude === null
  ) {
    return "Location access is required.";
  }

  const distance = calculateDistanceMeters(
    latitude,
    longitude,
    env.campusLat,
    env.campusLng,
  );
  if (distance > env.campusRadiusMeters) {
    return "You are not located within the allowed campus radius.";
  }

  return null;
}

async function storeAttendance(params: {
  userId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  category: string;
  purpose?: string | null;
  type: "Time In" | "Time Out";
  location: string;
  status: string;
  ipAddress: string;
  latitude?: number | null;
  longitude?: number | null;
  imageDataUrl?: string | null;
}) {
  const now = new Date();
  const dayKey = formatDayKey(now);
  const image = params.imageDataUrl
    ? imageBufferFromDataUrl(params.imageDataUrl)
    : null;

  return prisma.attendanceLog.create({
    data: {
      userId: params.userId ?? null,
      guestName: params.guestName ?? null,
      guestEmail: params.guestEmail ?? null,
      category: params.category,
      purpose: params.purpose ?? "N/A",
      attendanceType: params.type,
      locationText: params.location,
      status: params.status,
      ipAddress: params.ipAddress,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      attendanceDay: dayKey,
      imageData: image ? new Uint8Array(image.buffer) : null,
      imageMimeType: image?.mimeType ?? null,
      imageFileName: image
        ? `${params.category}-${dayKey}-${params.type.replace(" ", "-").toLowerCase()}.jpg`
        : null,
      imageSize: image?.buffer.length ?? null,
    },
  });
}

attendanceRouter.post(
  "/user",
  requireAuth,
  async (request: AuthenticatedRequest, response) => {
    const parsed = attendanceSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Invalid attendance payload" });
      return;
    }

    const auth = request.auth;
    if (!auth) {
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: auth.sub } });
    if (!user) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    const accessError = assertAccessAllowed(
      parsed.data.clientIp,
      parsed.data.latitude ?? null,
      parsed.data.longitude ?? null,
    );
    if (accessError) {
      response.status(403).json({ message: accessError });
      return;
    }

    const now = new Date();
    const dayKey = formatDayKey(now);
    const effective = await getEffectiveDaySchedule({
      userId: user.id,
      email: user.email,
      now,
      dayKey,
    });
    let scheduleStatus: "On Time" | "Late" | null = null;

    if (!effective.slot) {
      const message =
        effective.weeklySchedule.length === 0
          ? "Your attendance schedule is not configured. Please contact admin."
          : (evaluateDayScheduleForEffective({ effective, now })
              .messageIfInvalid ??
            "Attendance is not available for today.");
      response.status(400).json({ message });
      return;
    }

    const window = evaluateScheduleWindowForEffective({
      effective,
      type: parsed.data.type,
      now,
    });
    if (!window.allowed) {
      response.status(400).json({ message: window.message ?? "Not allowed." });
      return;
    }
    scheduleStatus = window.status;

    const duplicate = await prisma.attendanceLog.findFirst({
      where: {
        userId: user.id,
        attendanceDay: dayKey,
        attendanceType: parsed.data.type,
      },
    });

    if (duplicate) {
      response.status(409).json({
        message: `You have already marked ${parsed.data.type} for today.`,
      });
      return;
    }

    let sameDayTimeInStatus: string | null = null;

    if (parsed.data.type === "Time Out") {
      const hasTimeIn = await prisma.attendanceLog.findFirst({
        where: {
          userId: user.id,
          attendanceDay: dayKey,
          attendanceType: "Time In",
        },
        select: {
          status: true,
        },
      });

      if (!hasTimeIn) {
        response
          .status(400)
          .json({ message: "You must mark Time In before Time Out." });
        return;
      }

      sameDayTimeInStatus = hasTimeIn.status;
    }

    const status = scheduleStatus;
    const record = await storeAttendance({
      userId: user.id,
      category: user.role,
      purpose: parsed.data.purpose ?? "N/A",
      type: parsed.data.type,
      location: parsed.data.location,
      status,
      ipAddress: parsed.data.clientIp,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      imageDataUrl: parsed.data.imageDataUrl,
    });

    // Monthly summary table update (one table per month), updated on Time Out only.
    if (parsed.data.type === "Time Out") {
      const month = parseMonthFromDayKey(dayKey);
      if (month) {
        const scheduleDays = new Set(
          effective.weeklySchedule.map((s) => s.day),
        );
        const totalWeekdays = countTotalWeekdaysInMonth({
          year: month.year,
          month: month.month,
          timeZone: env.appTimezone,
          scheduleDays,
        });
        await ensureMonthlyAttendanceTable(month.label);
        await upsertMonthlySummary({
          monthLabel: month.label,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            uniqueId: user.uniqueId ?? null,
          },
          totalWeekdays,
          incrementPresent: 1,
          incrementLate: sameDayTimeInStatus === "Late" ? 1 : 0,
        });
      }
    }

    let emailResult: {
      provider: string;
      messageId?: string | null;
      skipped: boolean;
      reason?: string;
    } | null = null;
    let emailErrorMessage: string | null = null;

    if (user.email) {
      try {
        emailResult = await sendAttendanceEmail(
          user.email,
          `Attendance Receipt - ${user.fullName}`,
          {
            name: user.fullName,
            type: parsed.data.type,
            location: parsed.data.location,
            status,
            uniqueId: user.uniqueId,
            category: user.role,
            purpose: parsed.data.purpose ?? "N/A",
            timestamp: now,
            imageAvailable: Boolean(record.imageData),
          },
        );
      } catch (error) {
        emailErrorMessage =
          error instanceof Error
            ? error.message
            : "Unable to send attendance receipt email.";
      }
    }

    if (emailResult && !emailResult.skipped) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: user.email,
          subject: `Attendance Receipt - ${user.fullName}`,
          providerName: emailResult.provider,
          providerMessageId: emailResult.messageId ?? null,
          status: "sent",
        },
      });
    }

    if (emailResult && emailResult.skipped) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: user.email,
          subject: `Attendance Receipt - ${user.fullName}`,
          providerName: emailResult.provider,
          providerMessageId: null,
          status: "skipped",
          errorMessage: emailResult.reason ?? "Email was skipped.",
        },
      });
    }

    if (emailErrorMessage) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: user.email,
          subject: `Attendance Receipt - ${user.fullName}`,
          providerName: "unknown",
          providerMessageId: null,
          status: "failed",
          errorMessage: emailErrorMessage,
        },
      });
    }

    response.json({
      success: true,
      message: "Success",
      attendanceId: record.id,
      status,
      email: {
        attempted: Boolean(user.email),
        sent: Boolean(
          emailResult && !emailResult.skipped && !emailErrorMessage,
        ),
        provider: emailResult?.provider ?? null,
        reason:
          emailErrorMessage ??
          emailResult?.reason ??
          (user.email ? null : "No user email available for receipt."),
      },
    });
  },
);

attendanceRouter.get(
  "/user-window",
  requireAuth,
  async (request: AuthenticatedRequest, response) => {
    const auth = request.auth;
    if (!auth) {
      response.status(401).json({ message: "Unauthorized" });
      return;
    }

    const selectedTypeRaw = String(request.query.type ?? "").trim();
    const selectedType =
      selectedTypeRaw === "Time Out" || selectedTypeRaw === "Time In"
        ? (selectedTypeRaw as "Time In" | "Time Out")
        : null;
    const user = await prisma.user.findUnique({ where: { id: auth.sub } });
    if (!user) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    const now = new Date();
    const dayKey = formatDayKey(now);
    const logs = await prisma.attendanceLog.findMany({
      where: { userId: user.id, attendanceDay: dayKey },
      select: { attendanceType: true },
    });
    const hasTimeIn = logs.some((log) => log.attendanceType === "Time In");
    const hasTimeOut = logs.some((log) => log.attendanceType === "Time Out");

    const effective = await getEffectiveDaySchedule({
      userId: user.id,
      email: user.email,
      now,
      dayKey,
    });

    if (!effective.slot) {
      const invalidMessage =
        effective.weeklySchedule.length === 0
          ? "Your attendance schedule is not configured. Please contact admin."
          : (evaluateDayScheduleForEffective({ effective, now })
              .messageIfInvalid ??
            "Attendance is not available for today.");
      response.json({
        recommendedType: "Time In",
        allowed: false,
        message: invalidMessage,
        done: hasTimeIn && hasTimeOut,
        scheduleSource: effective.source,
        allowedByType: {
          "Time In": false,
          "Time Out": false,
        },
        messageByType: {
          "Time In": invalidMessage,
          "Time Out": invalidMessage,
        },
      });
      return;
    }

    const evalDay = evaluateDayScheduleForEffective({ effective, now });
    if (!evalDay.dayOk || !evalDay.slot || evalDay.startMinutes === null) {
      response.json({
        recommendedType: "Time In",
        allowed: false,
        message: evalDay.messageIfInvalid,
        done: hasTimeIn && hasTimeOut,
        scheduleSource: effective.source,
        allowedByType: { "Time In": false, "Time Out": false },
        messageByType: {
          "Time In": evalDay.messageIfInvalid,
          "Time Out": evalDay.messageIfInvalid,
        },
      });
      return;
    }

    const start = evalDay.startMinutes;
    const end = evalDay.endMinutes ?? start;
    const nowMin = evalDay.nowMinutes;
    const todaySlot = evalDay.slot;

    const timeInWindow = evaluateScheduleWindowForEffective({
      effective,
      type: "Time In",
      now,
    });
    const timeOutWindow = evaluateScheduleWindowForEffective({
      effective,
      type: "Time Out",
      now,
    });

    // Time Out additionally requires Time In to exist.
    const timeOutAllowed = timeOutWindow.allowed && hasTimeIn && !hasTimeOut;
    const timeOutMessage =
      !hasTimeIn && nowMin >= end
        ? "You must mark Time In first. Time In window may have ended."
        : hasTimeOut
          ? "Time Out already marked for today."
          : timeOutWindow.message;

    const timeInAllowed = timeInWindow.allowed && !hasTimeIn;
    const timeInMessage = hasTimeIn
      ? "Time In already marked for today."
      : timeInWindow.message;

    let recommendedType: "Time In" | "Time Out" = "Time In";
    let allowed = false;
    let message: string | null = null;

    if (hasTimeIn && hasTimeOut) {
      recommendedType = "Time Out";
      allowed = false;
      message = "Attendance already completed for today.";
    } else if (!hasTimeIn) {
      recommendedType = "Time In";
      allowed = timeInAllowed;
      if (nowMin < start) {
        message = `Your Time In will start at ${todaySlot.startTime}.`;
      } else if (nowMin > end) {
        message = `Your Time In time is gone (closed at ${todaySlot.endTime}).`;
      } else {
        message = timeInMessage;
      }
    } else {
      // has time in, can time out if within window
      recommendedType = "Time Out";
      allowed = timeOutAllowed;
      if (nowMin < end) {
        message = `Your Time Out is after ${todaySlot.endTime}.`;
      } else if (nowMin > end + 60) {
        message = `Your Time Out time is gone (closed 1 hour after ${todaySlot.endTime}).`;
      } else {
        message = timeOutMessage;
      }
    }

    const effectiveType = selectedType ?? recommendedType;
    const effectiveAllowed =
      effectiveType === "Time In" ? timeInAllowed : timeOutAllowed;
    const effectiveMessage =
      effectiveType === "Time In" ? timeInMessage : timeOutMessage;

    response.json({
      recommendedType,
      allowed: effectiveAllowed,
      message: effectiveMessage ?? message,
      done: hasTimeIn && hasTimeOut,
      scheduleSource: effective.source,
      shiftIn: todaySlot.startTime,
      shiftOut: todaySlot.endTime,
      allowedByType: { "Time In": timeInAllowed, "Time Out": timeOutAllowed },
      messageByType: { "Time In": timeInMessage, "Time Out": timeOutMessage },
    });
  },
);

attendanceRouter.post("/guest", async (request, response) => {
  const parsed = guestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid guest payload" });
    return;
  }

  const accessError = assertAccessAllowed(
    parsed.data.clientIp,
    parsed.data.latitude ?? null,
    parsed.data.longitude ?? null,
  );
  if (accessError) {
    response.status(403).json({ message: accessError });
    return;
  }

  const now = new Date();
  const dayKey = formatDayKey(now);
  const guestName = parsed.data.name.trim();
  const guestEmail = parsed.data.email?.trim() || null;

  const duplicate = await prisma.attendanceLog.findFirst({
    where: {
      guestName: {
        equals: guestName,
        mode: "insensitive",
      },
      attendanceDay: dayKey,
      attendanceType: parsed.data.type,
    },
  });

  if (duplicate) {
    response.status(409).json({
      message: `You have already marked ${parsed.data.type} for today.`,
    });
    return;
  }

  if (parsed.data.type === "Time Out") {
    const hasTimeIn = await prisma.attendanceLog.findFirst({
      where: {
        guestName: {
          equals: guestName,
          mode: "insensitive",
        },
        attendanceDay: dayKey,
        attendanceType: "Time In",
      },
    });

    if (!hasTimeIn) {
      response
        .status(400)
        .json({ message: "You must mark Time In before marking Time Out." });
      return;
    }
  }

  const record = await storeAttendance({
    guestName,
    guestEmail,
    category: "Guest",
    purpose: parsed.data.purpose ?? "N/A",
    type: parsed.data.type,
    location: parsed.data.location,
    status: "On Time",
    ipAddress: parsed.data.clientIp,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    imageDataUrl: parsed.data.imageDataUrl,
  });

  let guestEmailResult: {
    provider: string;
    messageId?: string | null;
    skipped: boolean;
    reason?: string;
  } | null = null;
  let guestEmailErrorMessage: string | null = null;

  if (guestEmail) {
    try {
      guestEmailResult = await sendAttendanceEmail(
        guestEmail,
        `Attendance Receipt - ${guestName}`,
        {
          name: guestName,
          type: parsed.data.type,
          location: parsed.data.location,
          status: "On Time",
          category: "Guest",
          purpose: parsed.data.purpose ?? "N/A",
          timestamp: now,
          imageAvailable: Boolean(record.imageData),
        },
      );
    } catch (error) {
      guestEmailErrorMessage =
        error instanceof Error
          ? error.message
          : "Unable to send attendance receipt email.";
    }

    if (guestEmailResult && !guestEmailResult.skipped) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: guestEmail,
          subject: `Attendance Receipt - ${guestName}`,
          providerName: guestEmailResult.provider,
          providerMessageId: guestEmailResult.messageId ?? null,
          status: "sent",
        },
      });
    }

    if (guestEmailResult && guestEmailResult.skipped) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: guestEmail,
          subject: `Attendance Receipt - ${guestName}`,
          providerName: guestEmailResult.provider,
          providerMessageId: null,
          status: "skipped",
          errorMessage: guestEmailResult.reason ?? "Email was skipped.",
        },
      });
    }

    if (guestEmailErrorMessage) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: guestEmail,
          subject: `Attendance Receipt - ${guestName}`,
          providerName: "unknown",
          providerMessageId: null,
          status: "failed",
          errorMessage: guestEmailErrorMessage,
        },
      });
    }
  }

  response.json({
    success: true,
    message: "Success",
    attendanceId: record.id,
    status: "On Time",
    email: {
      attempted: Boolean(guestEmail),
      sent: Boolean(
        guestEmailResult &&
        !guestEmailResult.skipped &&
        !guestEmailErrorMessage,
      ),
      provider: guestEmailResult?.provider ?? null,
      reason:
        guestEmailErrorMessage ??
        guestEmailResult?.reason ??
        (guestEmail ? null : "Guest email not provided."),
    },
  });
});
