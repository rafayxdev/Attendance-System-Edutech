import express from "express";

const app = express();
app.get("/api/health", (_req: any, res: any) => {
  res.json({ ok: true, using: "express" });
});

export default async function handler(req: any, res: any) {
  app(req, res);
}
