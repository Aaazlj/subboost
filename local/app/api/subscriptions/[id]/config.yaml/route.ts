import { apiError } from "@local/lib/http";
import { generateSubscriptionContent } from "@local/lib/subscription-service";
import { buildSubscriptionResponseHeaders } from "@subboost/server-core/subscription";
import {
  consumeLocalRateLimit,
  getTrustedClientRateLimitKey,
  hashLocalRateLimitKey,
  localRateLimitResponse,
} from "@local/lib/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { id: token } = await params;
  const clientKey = getTrustedClientRateLimitKey(request);
  if (clientKey) {
    const clientLimit = consumeLocalRateLimit("subscription-yaml-client", clientKey, {
      limit: 600,
      windowMs: 60_000,
    });
    if (!clientLimit.allowed) {
      return localRateLimitResponse("Too many subscription requests. Try again later.", clientLimit.retryAfterSeconds);
    }
  }
  const tokenLimit = consumeLocalRateLimit("subscription-yaml-token", hashLocalRateLimitKey(token), {
    limit: 120,
    windowMs: 60_000,
  });
  if (!tokenLimit.allowed) {
    return localRateLimitResponse("Too many subscription requests. Try again later.", tokenLimit.retryAfterSeconds);
  }
  const url = new URL(request.url);
  const typeParam = (url.searchParams.get("type") || url.searchParams.get("format") || "clash").toLowerCase();
  const format = typeParam === "v2rayn" ? "v2rayn" : typeParam === "base64" || typeParam === "plaintext" ? "base64" : "clash";
  const result = await generateSubscriptionContent(token, format);
  if (!result) return apiError("Subscription not found.", "NOT_FOUND", 404);
  const headers = buildSubscriptionResponseHeaders(result.name, result.subscriptionInfo, {
    cacheControl: "no-store",
    cacheExpirySeconds: result.cacheExpirySeconds,
    autoUpdateIntervalSeconds: result.autoUpdateIntervalSeconds,
    isAdmin: result.isAdmin,
  });
  headers["content-type"] = result.contentType;
  return new Response(result.content, { headers });
}
