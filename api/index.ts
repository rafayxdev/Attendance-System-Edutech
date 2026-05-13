export default async function handler(
  req: any,
  res: any,
) {
  res.status(200).json({
    ok: true,
    message: "Root API function works!",
    url: req.url,
    method: req.method,
  });
}
