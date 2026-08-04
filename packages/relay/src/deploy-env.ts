import { DEFAULT_RELAY_PORT } from "@pairrelay/shared";

/** Platform PORT (Railway/Fly) with PAIRRELAY_RELAY_PORT override. */
export function resolveRelayPort(): number {
  const raw = process.env.PAIRRELAY_RELAY_PORT ?? process.env.PORT ?? String(DEFAULT_RELAY_PORT);
  return Number(raw);
}

/** Explicit PAIRRELAY_RELAY_PUBLIC_URL, or auto-detect Railway/Fly hostnames. */
export function resolvePublicUrl(): string | undefined {
  const explicit = process.env.PAIRRELAY_RELAY_PUBLIC_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    return `https://${railwayDomain}`.replace(/\/$/, "");
  }

  const flyApp = process.env.FLY_APP_NAME?.trim();
  if (flyApp) {
    return `https://${flyApp}.fly.dev`;
  }

  return undefined;
}
