export default async function handler(
  req: any,
  res: any,
) {
  res.status(200).json({
    ok: true,
    message: "Root API function works!",
    url: req.url,
    originalUrl: req.originalUrl,
    method: req.method,
    headers: req.headers,
  });
}
