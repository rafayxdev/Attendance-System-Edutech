import express from "express";
import cors from "cors";

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req: any, res: any) => {
  res.json({ ok: true });
});

export default async function handler(req: any, res: any) {
  app(req, res);
}
