export interface TrackerSnippetInput {
  siteId: string
  apiBaseUrl: string
  origin: string
}

export function buildTrackerSnippet(
  input: TrackerSnippetInput,
): string {
  const siteId = input.siteId.trim()
  const origin = input.origin.replace(/\/+$/, '')
  const apiBaseUrl = input.apiBaseUrl.trim().replace(/\/+$/, '')

  if (!siteId) {
    throw new Error('站点 ID 不能为空。')
  }

  if (!origin) {
    throw new Error('Dashboard 地址不能为空。')
  }

  const scriptUrl = `${origin}/tracker/plv-tracker.iife.js`
  const endpoint = `${apiBaseUrl || origin}/api/collect`

  return [
    `<script src="${scriptUrl}"></script>`,
    '<script>',
    '  (() => {',
    '    const tracker = PLVSiteMonitor.init({',
    `      siteId: ${JSON.stringify(siteId)},`,
    `      endpoint: ${JSON.stringify(endpoint)},`,
    '    })',
    '    tracker.startPageTracking()',
    '  })()',
    '</script>',
  ].join('\n')
}
