import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth.js";
import {
  allowedPrefixMatch,
  calculateDistanceMeters,
  canTimeOut,
  formatDayKey,
  getLateStatus,
  imageBufferFromDataUrl,
  shouldEnforceAccessGate,
} from "../lib/rules.js";
import { env } from "../config/env.js";
import { sendAttendanceEmail } from "../lib/email.js";

export const attendanceRouter = Router();
const scheduleAuditAction = "USER_ATTENDANCE_SCHEDULE";

type ScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri";

function parseAttendanceSchedule(
  value: unknown,
): Array<{ day: ScheduleDay; startTime: string; endTime: string }> {
  if (!Array.isArray(value)) return [];
  const validDays = new Set<ScheduleDay>(["mon", "tue", "wed", "thu", "fri"]);
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      day: String(row.day || "").toLowerCase() as ScheduleDay,
      startTime: String(row.startTime || ""),
      endTime: String(row.endTime || ""),
    }))
    .filter(
      (row) =>
        validDays.has(row.day) &&
        timeRegex.test(row.startTime) &&
        timeRegex.test(row.endTime),
    );
}

async function getUserScheduleByEmail(email: string) {
  const logs = await prisma.auditLog.findMany({
    where: { action: scheduleAuditAction },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const emailKey = email.trim().toLowerCase();
  const latest = logs
    .map((log) => log.payload)
    .map((payload) => {
      if (!payload || typeof payload !== "object") return null;
      const row = payload as Record<string, unknown>;
      if (typeof row.email !== "string") return null;
      return {
        email: row.email.trim().toLowerCase(),
        schedule: parseAttendanceSchedule(row.schedule),
      };
    })
    .find((entry) => entry?.email === emailKey);
  return latest?.schedule ?? [];
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function getWeekdayKey(date: Date, timeZone: string): string {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  })
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

function hhmmFromDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function evaluateScheduleWindow(
  params: {
    schedule: Array<{ day: ScheduleDay; startTime: string; endTime: string }>;
    type: "Time In" | "Time Out";
    now: Date;
  },
): { allowed: boolean; status: "On Time" | "Late"; message: string | null } {
  const weekday = getWeekdayKey(params.now, env.appTimezone);
  if (!["mon", "tue", "wed", "thu", "fri"].includes(weekday)) {
    return {
      allowed: false,
      status: "On Time",
      message: "Attendance is only available Monday to Friday.",
    };
  }

  const todaySlot = params.schedule.find((row) => row.day === weekday);
  if (!todaySlot) {
    return {
      allowed: false,
      status: "On Time",
      message: "Attendance is not configured for today. Please contact admin.",
    };
  }

  const nowMinutes = toMinutes(hhmmFromDate(params.now, env.appTimezone));
  const startMinutes = toMinutes(todaySlot.startTime);
  const endMinutes = toMinutes(todaySlot.endTime);

  if (params.type === "Time In") {
    if (nowMinutes < startMinutes) {
      return {
        allowed: false,
        status: "On Time",
        message: `Time In starts at ${todaySlot.startTime}.`,
      };
    }
    if (nowMinutes > endMinutes) {
      return {
        allowed: false,
        status: "Late",
        message: `Time In closed at ${todaySlot.endTime}.`,
      };
    }
    return {
      allowed: true,
      status: nowMinutes > startMinutes + 15 ? "Late" : "On Time",
      message: null,
    };
  }

  if (nowMinutes < endMinutes) {
    return {
      allowed: false,
      status: "On Time",
      message: `Time Out is after ${todaySlot.endTime}.`,
    };
  }
  if (nowMinutes > endMinutes + 60) {
    return {
      allowed: false,
      status: "On Time",
      message: `Time Out closed 1 hour after ${todaySlot.endTime}.`,
    };
  }
  return { allowed: true, status: "On Time", message: null };
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
    const schedule = await getUserScheduleByEmail(user.email);
    let scheduleStatus: "On Time" | "Late" | null = null;
    if (schedule.length > 0) {
      const window = evaluateScheduleWindow({
        schedule,
        type: parsed.data.type,
        now,
      });
      if (!window.allowed) {
        response.status(400).json({ message: window.message ?? "Not allowed." });
        return;
      }
      scheduleStatus = window.status;
    }

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

    if (parsed.data.type === "Time Out") {
      const hasTimeIn = await prisma.attendanceLog.findFirst({
        where: {
          userId: user.id,
          attendanceDay: dayKey,
          attendanceType: "Time In",
        },
      });

      if (!hasTimeIn) {
        response
          .status(400)
          .json({ message: "You must mark Time In before Time Out." });
        return;
      }

      if (!canTimeOut(user.role, now)) {
        response.status(400).json({
          message:
            "Early checkout is not allowed. Time Out only permitted after 2:30 PM.",
        });
        return;
      }
    }

    const status =
      scheduleStatus ?? getLateStatus(user.role, parsed.data.type, now);
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

    const selectedType =
      String(request.query.type ?? "Time In") === "Time Out"
        ? "Time Out"
        : "Time In";
    const user = await prisma.user.findUnique({ where: { id: auth.sub } });
    if (!user) {
      response.status(404).json({ message: "User not found." });
      return;
    }

    const schedule = await getUserScheduleByEmail(user.email);
    if (schedule.length === 0) {
      response.json({ allowed: true, message: null });
      return;
    }

    const window = evaluateScheduleWindow({
      schedule,
      type: selectedType,
      now: new Date(),
    });
    response.json({
      allowed: window.allowed,
      message: window.message,
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
