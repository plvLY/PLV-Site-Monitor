
import { isIP } from "node:net";
import Bowser from "bowser";
import type { Context } from "@netlify/functions";

/**
 * 服务端获取的访客元数据。
 *
 * IP、Geo 只允许从 Netlify Context 获取。
 * User-Agent 从请求头读取。
 */
export interface VisitorMetadata {
  ipAddress: string | null;

  countryCode: string | null;
  region: string | null;
  city: string | null;

  userAgent: string | null;

  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string | null;
  os: string | null;
}

/**
 * 获取并解析服务端访客信息。
 */
export function resolveVisitorMetadata(
  request: Request,
  context: Context,
): VisitorMetadata {
  // 1. 获取服务端 IP
  const rawIp = context.ip;

  const ipAddress =
    typeof rawIp === "string" && isIP(rawIp) !== 0
      ? rawIp
      : null;

  // 2. 获取服务端 Geo
  const geo = context.geo;

  const countryCode = geo?.country?.code ?? null;
  const region = geo?.subdivision?.name ?? null;
  const city = geo?.city ?? null;

  // 3. 获取 User-Agent
  const rawUserAgent = request.headers.get("user-agent");

  const userAgent =
    rawUserAgent?.slice(0, 1000) || null;

  // 4. 解析浏览器、操作系统和设备
  let deviceType: VisitorMetadata["deviceType"] = "unknown";
  let browser: string | null = null;
  let os: string | null = null;

  if (userAgent) {
    const result = Bowser.getParser(userAgent).getResult();

    const platformType = result.platform.type;

    if (
      platformType === "desktop"
    ) {
      deviceType = "desktop";
    } else if (
      platformType === "mobile"
    ) {
      deviceType = "mobile";
    } else if (
      platformType === "tablet"
    ) {
      deviceType = "tablet";
    }

    browser = result.browser.name ?? null;
    os = result.os.name ?? null;
  }

  return {
    ipAddress,
    countryCode,
    region,
    city,
    userAgent,
    deviceType,
    browser,
    os,
  };
}
