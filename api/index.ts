export default async function handler(
  req: any,
  res: any,
) {
  try {
    const { createApp } = await import("../apps/api/src/app.js");
    const app = createApp();
    app(req, res);
  } catch (err: any) {
    console.error("Express initialization error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Server error",
        message: err?.message ?? String(err),
        stack: err?.stack,
      });
    }
  }
}
