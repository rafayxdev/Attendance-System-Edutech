import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchAccessPolicy, fetchPublicIp } from "../api/client";
import type { AccessPolicy } from "../types";

type GateState = "loading" | "allowed" | "denied";

interface GateContext {
  clientIp: string;
  latitude: number | null;
  longitude: number | null;
  policy: AccessPolicy | null;
}

interface AccessGateProps {
  children: (context: GateContext) => ReactNode;
}

function getDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadius = 6371000;
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const deltaLat = toRad(lat2 - lat1);
  const deltaLng = toRad(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function AccessGate({ children }: AccessGateProps) {
  const [state, setState] = useState<GateState>("loading");
  const [context, setContext] = useState<GateContext>({
    clientIp: "0.0.0.0",
    latitude: null,
    longitude: null,
    policy: null,
  });
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const policy = await fetchAccessPolicy();
        const clientIp = await fetchPublicIp();

        const geo = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            if (!navigator.geolocation) {
              reject(
                new Error("Geolocation is not supported by this browser."),
              );
              return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 10000,
            });
          },
        );

        const latitude = geo.coords.latitude;
        const longitude = geo.coords.longitude;
        const ipAllowed =
          !policy.accessGateEnforced ||
          policy.allowedIpPrefixes.some((prefix) =>
            clientIp.startsWith(prefix),
          );
        const distance = getDistanceMeters(
          latitude,
          longitude,
          policy.campusLat,
          policy.campusLng,
        );
        const geoAllowed =
          !policy.accessGateEnforced || distance <= policy.campusRadiusMeters;

        if (!cancelled) {
          setContext({ clientIp, latitude, longitude, policy });
          if (ipAllowed && geoAllowed) {
            setState("allowed");
          } else {
            setReason(
              !ipAllowed
                ? "Unauthorized network connection detected."
                : "You are not located within the allowed campus radius.",
            );
            setState("denied");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setReason(
            error instanceof Error ? error.message : "Access check failed.",
          );
          setState("denied");
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  const overlay = useMemo(() => {
    if (state === "loading") {
      return (
        <div className="gate-screen">
          <div className="gate-card">
            <div className="spinner" />
            <h2>Verifying Access</h2>
            <p>Checking approved network and campus location...</p>
          </div>
        </div>
      );
    }

    if (state === "denied") {
      return (
        <div className="gate-screen denied">
          <div className="gate-card denied">
            <div className="gate-lock">🔒</div>
            <h2>Access Denied</h2>
            <p>{reason}</p>
            <small>
              Switch to the approved network and campus location, then refresh.
            </small>
          </div>
        </div>
      );
    }

    return null;
  }, [reason, state]);

  if (state !== "allowed") {
    return <>{overlay}</>;
  }

  return <>{children(context)}</>;
}
