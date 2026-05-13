let app: any;

async function getApp() {
  if (!app) {
    const { createApp } = await import("../apps/api/src/app.js");
    app = createApp();
  }
  return app;
}

export default async function handler(
  req: any,
  res: any,
) {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err: any) {
    console.error("Express handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error", message: err?.message });
    }
  }
}
