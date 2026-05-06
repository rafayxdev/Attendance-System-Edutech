import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

for (const envPath of [
  resolve(process.cwd(), "apps/api/.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
]) {
  loadEnv({ path: envPath, override: true });
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export const env = {
  port: toNumber(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  appTimezone: process.env.APP_TIMEZONE ?? "Asia/Karachi",
  accessProfile: process.env.ACCESS_PROFILE ?? "home",
  accessGateEnforced: toBool(
    process.env.ACCESS_GATE_ENFORCED,
    (process.env.NODE_ENV ?? "development") === "production",
  ),
  allowedIpPrefixes: splitList(
    process.env.ALLOWED_IP_PREFIXES,
    (process.env.ACCESS_PROFILE ?? "home") === "university"
      ? ["137.59.221.", "137.59.223."]
      : ["137.59.221.136", "137.59.223.136"],
  ),
  campusLat: toNumber(process.env.CAMPUS_LAT, 25.3833456),
  campusLng: toNumber(process.env.CAMPUS_LNG, 68.3844759),
  campusRadiusMeters: toNumber(process.env.CAMPUS_RADIUS_METERS, 250),
  allowDemoSeed: toBool(process.env.ALLOW_DEMO_SEED, true),
  demoAdminEmail: process.env.DEMO_ADMIN_EMAIL ?? "admin@edutech.com",
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD ?? "Admin@12345",
  gmailUser: (process.env.GMAIL_USER ?? "").trim(),
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD ?? "").trim(),
  emailFrom:
    process.env.EMAIL_FROM ?? "EduTech Interns <edutechinterns@gmail.com>",
  appPublicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:5173",
  apiPublicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:4000",
};
