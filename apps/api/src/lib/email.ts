import { env } from "../config/env.js";
import { formatDisplayDateTime } from "./rules.js";
import nodemailer, { type Transporter } from "nodemailer";

interface EmailReceiptInput {
  name: string;
  type: string;
  location: string;
  status: string;
  uniqueId?: string | null;
  category: string;
  purpose?: string | null;
  timestamp: Date;
  imageAvailable?: boolean;
}

function buildEmailHtml(input: EmailReceiptInput): string {
  const when = formatDisplayDateTime(input.timestamp);
  const statusColor = input.status === "Late" ? "#ef4444" : "#22c55e";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f7ff;font-family:Arial,sans-serif;">
  <div style="padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#38bdf8,#6366f1);padding:28px 24px;color:#fff;text-align:center;">
        <h1 style="margin:0;font-size:24px;">Attendance Marked</h1>
        <p style="margin:8px 0 0;opacity:.9;">EduTech Solutions Digital Portal</p>
      </div>
      <div style="padding:28px 24px;color:#334155;line-height:1.6;">
        <p>Hello <strong>${input.name}</strong>,</p>
        <p>Your <strong>${input.type}</strong> attendance was recorded successfully.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;font-size:14px;">
          ${input.uniqueId ? `<p style="margin:6px 0;"><strong>Your ID:</strong> <span style="display:inline-block;background:#e0e7ff;color:#4338ca;padding:2px 10px;border-radius:999px;font-weight:bold;">${input.uniqueId}</span></p>` : ""}
          <p style="margin:6px 0;"><strong>Category:</strong> ${input.category}</p>
          <p style="margin:6px 0;"><strong>Status:</strong> <span style="color:${statusColor};font-weight:bold;">${input.status}</span></p>
          ${input.purpose ? `<p style="margin:6px 0;"><strong>Purpose:</strong> ${input.purpose}</p>` : ""}
          <p style="margin:6px 0;"><strong>Date:</strong> ${when.date}</p>
          <p style="margin:6px 0;"><strong>Time:</strong> ${when.time}</p>
          <p style="margin:6px 0;"><strong>Location:</strong> ${input.location}</p>
          ${input.imageAvailable ? `<p style="margin:6px 0;"><strong>Image:</strong> Stored securely with this attendance record.</p>` : ""}
        </div>
        <p style="font-size:12px;color:#94a3b8;margin-top:22px;text-align:center;">This is an automated receipt. Please keep it for your records.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

let gmailTransporter: Transporter | null = null;

function getGmailTransporter(): Transporter {
  if (gmailTransporter) {
    return gmailTransporter;
  }

  const smtpUser = env.gmailUser.trim();
  const smtpPass = env.gmailAppPassword.replace(/\s+/g, "").trim();

  gmailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  return gmailTransporter;
}

export async function sendAttendanceEmail(
  recipientEmail: string,
  subject: string,
  input: EmailReceiptInput,
): Promise<{
  provider: string;
  messageId?: string | null;
  skipped: boolean;
  reason?: string;
}> {
  if (!recipientEmail?.trim()) {
    return {
      provider: "none",
      skipped: true,
      reason: "Recipient email is empty.",
    };
  }

  const html = buildEmailHtml(input);

  const hasGmailConfig = Boolean(
    env.gmailUser.trim() && env.gmailAppPassword.replace(/\s+/g, "").trim(),
  );

  if (hasGmailConfig) {
    const transporter = getGmailTransporter();
    const info = await transporter.sendMail({
      from: env.emailFrom,
      to: recipientEmail,
      subject,
      html,
    });

    return {
      provider: "gmail",
      messageId: info.messageId ?? null,
      skipped: false,
    };
  }

  return {
    provider: "console",
    skipped: true,
    reason:
      "Gmail credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env",
  };
}
