
export interface UtmParams {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
}

export function collectUtmParams(
  url: string = window.location.href
): UtmParams {
  const searchParams = new URL(url).searchParams;

  const getParam = (key: string): string | null => {
    const value = searchParams.get(key);
    return value === "" ? null : value;
  };

  return {
    utm_source: getParam("utm_source"),
    utm_medium: getParam("utm_medium"),
    utm_campaign: getParam("utm_campaign"),
    utm_term: getParam("utm_term"),
    utm_content: getParam("utm_content"),
  };
}
