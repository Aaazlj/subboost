import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json } from "@local/lib/http";
import { listActiveTunnels, startTunnel } from "@local/lib/vpngate/tunnel-service";

export async function GET() {
  return withCurrentAdmin(async () => {
    try {
      const tunnels = await listActiveTunnels();
      return json({ tunnels });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取活跃隧道列表失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}

export async function POST(request: Request) {
  return withCurrentAdmin(async () => {
    try {
      const body = await request.json();
      if (!body.node || !body.node.id || !body.node.openvpnConfigBase64) {
        return apiError("缺少节点连接参数", "BAD_REQUEST", 400);
      }
      const tunnel = await startTunnel(body.node);
      return json({ success: true, tunnel }, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "启动隧道失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}
