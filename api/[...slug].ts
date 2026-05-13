export default async function handler(
  req: any,
  res: any,
) {
  res.status(200).json({
    ok: true,
    message: "Catch-all works!",
    path: req.url,
    method: req.method,
    slug: req.query?.slug,
  });
}
