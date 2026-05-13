export default async function handler(
  req: any,
  res: any,
) {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  res.status(200).json({
    ok: true,
    message: "Catch-all function works!",
    path: pathname,
    method: req.method,
  });
}
