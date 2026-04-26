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

    const duplicate = await prisma.attendanceLog.findFirst({
      where: {
        userId: user.id,
        attendanceDay: dayKey,
        attendanceType: parsed.data.type,
      },
    });

    if (duplicate) {
      response
        .status(409)
        .json({
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
        response
          .status(400)
          .json({
            message:
              "Early checkout is not allowed. Time Out only permitted after 2:30 PM.",
          });
        return;
      }
    }

    const status = getLateStatus(user.role, parsed.data.type, now);
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

    const emailResult = user.email
      ? await sendAttendanceEmail(
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
        )
      : null;

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

    response.json({
      success: true,
      message: "Success",
      attendanceId: record.id,
      status,
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
    response
      .status(409)
      .json({
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

  if (guestEmail) {
    const emailResult = await sendAttendanceEmail(
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

    if (!emailResult.skipped) {
      await prisma.emailLog.create({
        data: {
          attendanceId: record.id,
          recipientEmail: guestEmail,
          subject: `Attendance Receipt - ${guestName}`,
          providerName: emailResult.provider,
          providerMessageId: emailResult.messageId ?? null,
          status: "sent",
        },
      });
    }
  }

  response.json({
    success: true,
    message: "Success",
    attendanceId: record.id,
    status: "On Time",
  });
});
