export interface ParsedOrigin {
  origin: string;
  hostname: string;
}

/**
 * 解析并验证 Origin。
 *
 * 规则：
 * 1. 仅允许 HTTP / HTTPS
 * 2. 拒绝 null Origin
 * 3. 拒绝用户名、密码、路径、查询参数和 Hash
 * 4. 生产环境只允许标准 HTTP/HTTPS 端口
 * 5. 开发环境允许 localhost 使用自定义端口
 */
export function parseOrigin(
  rawOrigin: string | null,
): ParsedOrigin | null {
  if (!rawOrigin || rawOrigin === "null") {
    return null;
  }

  try {
    const url = new URL(rawOrigin);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const hostname = url.hostname.toLowerCase();

    const isLocalhost =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";

    const isDevelopment = process.env.NODE_ENV !== "production";

    // 生产环境不允许非标准端口。
    // 开发环境仅对 localhost 开放自定义端口。
    if (url.port && !(isDevelopment && isLocalhost)) {
      return null;
    }

    return {
      origin: url.origin,
      hostname,
    };
  } catch {
    return null;
  }
}