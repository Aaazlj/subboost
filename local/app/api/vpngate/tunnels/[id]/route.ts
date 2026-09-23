import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json } from "@local/lib/http";
import { stopTunnel } from "@local/lib/vpngate/tunnel-service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: RouteContext) {
  return withCurrentAdmin(async () => {
    try {
      const { id } = await params;
      const decodedId = decodeURIComponent(id);
      await stopTunnel(decodedId);
      return json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "停止隧道失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}
