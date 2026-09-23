import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json } from "@local/lib/http";
import { getVpngateNodes } from "@local/lib/vpngate/vpngate-fetcher";

export async function GET(request: Request) {
  return withCurrentAdmin(async () => {
    try {
      const url = new URL(request.url);
      const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "true";
      const result = await getVpngateNodes({ force });
      return json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取 VPNGate 节点列表失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}
