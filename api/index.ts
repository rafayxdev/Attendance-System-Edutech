export default async function handler(
  req: any,
  res: any,
) {
  try {
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyStr = Buffer.concat(chunks).toString("utf-8");
      try {
        req.body = bodyStr ? JSON.parse(bodyStr) : {};
      } catch {
        return res.status(400).json({
          error: "Invalid JSON body",
          raw: bodyStr.slice(0, 200),
          rawLength: bodyStr.length,
        });
      }
    }

    const { createApp } = await import("../apps/api/src/app.js");
    const app = createApp();
    app(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error", message: err?.message, stack: err?.stack });
    }
  }
}
