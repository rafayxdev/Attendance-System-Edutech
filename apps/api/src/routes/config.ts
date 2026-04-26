import { Router } from "express";
import { env } from "../config/env.js";

export const configRouter = Router();

configRouter.get("/access-policy", (_request, response) => {
  response.json({
    accessProfile: env.accessProfile,
    accessGateEnforced: env.accessGateEnforced,
    allowedIpPrefixes: env.allowedIpPrefixes,
    campusLat: env.campusLat,
    campusLng: env.campusLng,
    campusRadiusMeters: env.campusRadiusMeters,
    timezone: env.appTimezone,
    publicApiUrl: env.apiPublicUrl,
    publicAppUrl: env.appPublicUrl,
  });
});
