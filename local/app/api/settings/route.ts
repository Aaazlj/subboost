import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json } from "@local/lib/http";
import { getSystemSettings, updateSystemSettings } from "@local/lib/vpngate/tunnel-service";

export async function GET() {
  return withCurrentAdmin(async () => {
    try {
      const settings = await getSystemSettings();
      return json({ settings });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取系统设置失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}

export async function PUT(request: Request) {
  return withCurrentAdmin(async () => {
    try {
      const body = await request.json();
      if (!body || typeof body !== "object") {
        return apiError("无效的请求数据", "BAD_REQUEST", 400);
      }
      const updated = await updateSystemSettings(body);
      return json({ settings: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "更新系统设置失败";
      return apiError(msg, "INTERNAL_ERROR", 500);
    }
  });
}
