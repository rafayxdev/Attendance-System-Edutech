import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { attendanceRouter } from "./routes/attendance.js";
import { adminRouter } from "./routes/admin.js";
import { configRouter } from "./routes/config.js";

function mapHandledDatabaseError(
  error: unknown,
): { status: number; message: string; consoleMessage?: string } | null {
  if (!error || typeof error !== "object") return null;
  const rec = error as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : "";
  const code = typeof rec.code === "string" ? rec.code : "";
  const prismaMessage =
    typeof rec.message === "string" ? rec.message : "Database error";

  if (name === "PrismaClientKnownRequestError") {
    switch (code) {
      case "P1001":
        return {
          status: 503,
          message:
            "Cannot reach the database. Check your internet connection or database host connectivity.",
        };
      case "P1000":
        return {
          status: 503,
          message:
            "Database authentication failed. Verify DATABASE_URL username and password.",
        };
      case "P1008":
      case "P1017":
        return {
          status: 503,
          message:
            "The database closed or timed out the connection. Try again in a moment.",
        };
      case "P2002":
        return {
          status: 409,
          message:
            "A user with this email or another unique field already exists.",
        };
      default:
        return process.env.NODE_ENV === "production"
          ? { status: 500, message: "Internal server error" }
          : {
              status: 500,
              message: `Database error (${code}): ${prismaMessage}`,
            };
    }
  }

  if (name === "PrismaClientInitializationError") {
    return {
      status: 503,
      message:
        "Database could not be initialized. Check your database settings.",
      consoleMessage:
        "Database could not be initialized. Check DATABASE_URL format and SSL settings; for Supabase, confirm you use the correct direct or pooled connection string for Prisma.",
    };
  }

  if (name === "PrismaClientRustPanicError") {
    return {
      status: 503,
      message: "Database engine error. Restart the API and try again.",
    };
  }

  return null;
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "8mb" }));
  

  app.use("/config", configRouter);
  app.use("/auth", authRouter);
  app.use("/attendance", attendanceRouter);
  app.use("/admin", adminRouter);

  app.use((_request, response) => {
    response.status(404).json({ message: "Route not found" });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const mapped = mapHandledDatabaseError(error);
      if (mapped) {
        console.error(mapped.consoleMessage ?? mapped.message);
        response.status(mapped.status).json({ message: mapped.message });
        return;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(message, stack);
      response.status(500).json({ message: "Internal server error", error: message });
    },
  );

  return app;
}
