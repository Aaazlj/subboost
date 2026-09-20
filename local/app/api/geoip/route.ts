import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json, jsonBodyError, LOCAL_JSON_BODY_LIMITS, readJsonBody } from "@local/lib/http";
import { lookupGeoIp } from "@local/lib/geoip";

const MAX_HOSTS = 300;

export async function POST(request: Request) {
  return withCurrentAdmin(async () => {
    const parsedBody = await readJsonBody(request, LOCAL_JSON_BODY_LIMITS.small);
    if (!parsedBody.ok) return jsonBodyError(parsedBody);
    const body = parsedBody.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid JSON body.", "BAD_REQUEST", 400);
    }

    const rawHosts = (body as Record<string, unknown>).hosts;
    if (!Array.isArray(rawHosts)) {
      return apiError("hosts must be an array of strings.", "VALIDATION_ERROR", 400);
    }

    const hosts = rawHosts
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_HOSTS);

    if (hosts.length === 0) return json({ results: [] });

    const results = await lookupGeoIp(hosts);
    return json({ results });
  });
}
