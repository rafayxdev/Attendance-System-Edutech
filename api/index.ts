import { createApp } from "../apps/api/src/app.js";

const app = createApp();

export default async function handler(
  req: any,
  res: any,
) {
  try {
    app(req, res);
  } catch (err) {
    console.error("Unhandled error in Express handler:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
