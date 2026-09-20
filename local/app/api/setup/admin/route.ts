import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { apiError, getStringField, jsonBodyError, LOCAL_JSON_BODY_LIMITS, readJsonBody } from "@local/lib/http";
import { prisma } from "@local/lib/prisma";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@local/lib/session";
import { consumeLocalRateLimit, getTrustedClientRateLimitKey, localRateLimitResponse } from "@local/lib/rate-limit";

export async function POST(request: Request) {
  const clientKey = getTrustedClientRateLimitKey(request);
  if (clientKey) {
    const setupLimit = consumeLocalRateLimit("admin-setup-client", clientKey, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!setupLimit.allowed) {
      return localRateLimitResponse("Too many setup attempts. Try again later.", setupLimit.retryAfterSeconds);
    }
  }

  const parsedBody = await readJsonBody(request, LOCAL_JSON_BODY_LIMITS.small);
  if (!parsedBody.ok) return jsonBodyError(parsedBody, "请求格式错误");
  const body = parsedBody.value;

  const existingCount = await prisma.localAdmin.count();
  if (existingCount > 0) {
    return apiError("面板密码已初始化，请直接解锁", "CONFLICT", 409);
  }

  const username = getStringField(body, "username") || "admin";
  const password = getStringField(body, "password");
  const passwordConfirm = getStringField(body, "passwordConfirm");
  if (!password || password.length < 6) {
    return apiError("密码长度至少为 6 位", "BAD_REQUEST", 400);
  }
  if (password !== passwordConfirm) {
    return apiError("两次输入的密码不一致", "BAD_REQUEST", 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${1_397_704_283}) IS NULL AS "locked"`;
    if (await transaction.localAdmin.count()) return null;
    return transaction.localAdmin.create({
      data: { username, passwordHash, lastLoginAt: new Date() },
      select: { id: true, username: true },
    });
  });
  if (!admin) {
    return apiError("面板密码已初始化，请直接解锁", "CONFLICT", 409);
  }

  const response = NextResponse.json({
    success: true,
    user: admin,
  });
  response.cookies.set(SESSION_COOKIE, await signSession({ adminId: admin.id, username: admin.username }), sessionCookieOptions());
  return response;
}
