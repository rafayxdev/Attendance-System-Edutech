import { createApp } from "../apps/api/src/app.js";

const app = createApp();

export default async function handler(req: any, res: any) {
  req.url = req.url?.replace(/^\/api(?=\/|$)/, "") || "/";
  app(req, res);
}
