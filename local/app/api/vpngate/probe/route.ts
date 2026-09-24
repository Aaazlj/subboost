import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json } from "@local/lib/http";
import { probeSingleNode } from "@local/lib/vpngate/vpngate-fetcher";

export async function POST(request: Request) {
  return withCurrentAdmin(async () => {
    try {
      const body = await request.json();
      const ip = body?.ip;
      if (!ip || typeof ip !== "string") {
        return apiError("缺少或无效的 IP 地址", "BAD_REQUEST", 400);
      }

      const result = await probeSingleNode(ip.trim());
      return json({ ip, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "节点探活失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}
