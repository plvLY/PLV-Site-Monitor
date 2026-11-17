ALTER TABLE "analytics_daily_memberships" ADD CONSTRAINT "analytics_daily_memberships_dimension_check" CHECK ("dimension" IN (
        'overview',
        'page',
        'referrer_host',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'browser',
        'os',
        'device_type',
        'location'
      ));