export interface PageMetadata {
  page_url: string;
  page_title: string;
  page_path: string;
  referrer: string | null;
  referrer_host: string | null;
}

const ALLOWED_PAGE_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

const SENSITIVE_PARAMS = new Set([
  "token",
  "password",
  "access_token",
  "refresh_token",
  "code",
  "email",
  "phone",
  "client_secret",
  "api_key",
  "apikey",
  "secret",
  "authorization",
  "auth_token",
  "id_token",
  "session_token",
  "code_verifier",
]);

function sanitizeUrl(
  input: string,
  allowedParams?: Set<string>
): URL {
  const url = new URL(input);

  // URL 中的用户名和密码也不应进入采集数据。
  url.username = "";
  url.password = "";

  // 不采集 fragment。
  url.hash = "";

  const originalParams = Array.from(url.searchParams.entries());

  // 重新构建查询参数，避免敏感参数残留。
  url.search = "";

  for (const [key, value] of originalParams) {
    const normalizedKey = key.toLowerCase();

    if (allowedParams) {
      if (allowedParams.has(normalizedKey)) {
        url.searchParams.append(normalizedKey, value);
      }
      continue;
    }

    if (!SENSITIVE_PARAMS.has(normalizedKey)) {
      url.searchParams.append(key, value);
    }
  }

  return url;
}

export function collectPageMetadata(): PageMetadata {
  const currentUrl = sanitizeUrl(
    window.location.href,
    ALLOWED_PAGE_PARAMS
  );

  let referrer: string | null = null;
  let referrerHost: string | null = null;

  if (document.referrer) {
    try {
      const sanitizedReferrer = sanitizeUrl(document.referrer);

      referrer = sanitizedReferrer.href;
      referrerHost = sanitizedReferrer.host;
    } catch {
      referrer = null;
      referrerHost = null;
    }
  }

  return {
    page_url: currentUrl.href,
    page_title: document.title,
    page_path: currentUrl.pathname,
    referrer,
    referrer_host: referrerHost,
  };
}