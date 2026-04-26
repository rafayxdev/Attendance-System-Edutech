import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { attendanceRouter } from "./routes/attendance.js";
import { adminRouter } from "./routes/admin.js";
import { configRouter } from "./routes/config.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

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
      console.error(error);
      response.status(500).json({ message: "Internal server error" });
    },
  );

  return app;
}
