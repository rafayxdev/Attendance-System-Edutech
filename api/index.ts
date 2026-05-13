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
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyStr = Buffer.concat(chunks).toString("utf-8");
      if (bodyStr) {
        req.body = JSON.parse(bodyStr);
      }
    }
    const app = await getApp();
    app(req, res);
  } catch (err: any) {
    console.error("Serverless handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  }
}
