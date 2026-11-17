export interface PageViewEvent {
  event_id: string;
  event_type: "page_view";

  visitor_id: string;
  session_id: string;

  page_url: string;
  page_title: string;
  page_path: string;

  referrer: string | null;
  referrer_host: string | null;

  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;

  occurred_at: string;
}
