# T-02-01-02 Tracker 接入方案

**版本：** V1.1
**状态：** 最终验收版

## 1. 设计目标

Tracker 是部署在目标网站上的轻量级 JavaScript 采集程序。

不依赖 Vue、React 等前端框架，支持传统网站和 SPA 网站。

## 2. 接入方式

用户在目标网站 HTML 中加入：

```
<script
  defer
  src="https://统计服务正式域名/tracker.js"
  data-site-id="SITE_ID"
></script>
```

参数：

| 参数         | 说明             |
| ------------ | ---------------- |
| src          | Tracker 文件地址 |
| data-site-id | 站点唯一标识     |

Site ID 是公开标识，不是密钥。

## 3. Tracker 初始化

初始化流程：

1. 读取 Site ID。
2. 获取当前页面域名。
3. 读取 visitor_id。
4. 读取 session_id。
5. 注册页面访问监听。
6. 首次页面加载上报一次 page_view。
7. 注册 SPA 路由监听。

## 4. visitor_id

使用 localStorage。

键名：

```
plv_analytics_visitor_id
```

规则：

- 首次生成 UUID。
- 同一网站后续访问复用。
- 不同网站默认隔离。
- 清除本地存储后重新生成。
- localStorage 不可用时，降级为临时 ID，不保证跨页面复用。

## 5. session_id

使用 sessionStorage。

键名：

```
plv_analytics_session_id
```

规则：

- 首次生成 UUID。
- 同一标签页复用。
- 不同标签页可以独立生成。
- 标签页会话结束后失效。
- 不依赖第三方 Cookie。

## 6. SPA 路由自动采集

### 6.1 支持范围

- History API
- Vue Router
- React Router
- hash 路由

### 6.2 监听策略

Tracker 初始化时记录当前页面地址，并完成一次首次访问上报。

随后监听：

- `history.pushState`
- `history.replaceState`
- `popstate`
- `hashchange`

对于 pushState 和 replaceState，需要包装 History API 方法，在原始方法执行后检测 URL 是否发生变化。

不得改变原方法返回值和异常行为。

### 6.3 去重机制

统一使用当前页面 URL 作为路由变化判定依据。

逻辑：

```
收到路由变化通知
       |
       v
读取当前 URL
       |
       v
与上一次已上报 URL 比较
       |
       +---- 相同 ----> 忽略
       |
       +---- 不同 ----> 更新状态并上报 page_view
```

同一次导航即使同时触发多个监听器，也只能上报一个有效事件。

需要注意：某些路由库会在路由提交后异步更新页面标题。Tracker 可以在短暂的路由稳定阶段读取标题，但不能因为标题变化再重复上报 PV。

### 6.4 API 设计

提供：

```
PLVAnalytics.trackPageView();
```

用于特殊路由场景手动触发。

手动触发也必须执行事件去重。

## 7. 页面数据采集

采集：

- 当前页面 URL。
- 页面路径。
- 页面标题。
- Referrer。
- UTM 参数。
- visitor_id。
- session_id。
- event_id。
- 事件时间。

URL 清理：

- 删除 fragment。
- 过滤 token、password、access_token、refresh_token、code、email、phone 等敏感参数。
- 仅保留允许的 UTM 参数。
- referrer 同样执行敏感参数清理。

## 8. 请求机制

```
fetch(collectUrl, {
  method: "POST",
  mode: "cors",
  credentials: "omit",
  keepalive: true,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});
```

请求失败不能影响目标网站。

MVP 不进行无限重试。

## 9. 请求事件格式

```
{
  "siteId": "SITE_ID",
  "eventId": "UUID",
  "eventType": "page_view",
  "visitorId": "UUID",
  "sessionId": "UUID",
  "page": {
    "url": "https://example.com/products",
    "path": "/products",
    "title": "Products"
  },
  "referrer": "https://google.com/",
  "utm": {
    "source": "google",
    "medium": "organic",
    "campaign": null,
    "term": null,
    "content": null
  },
  "occurredAt": "2026-11-05T10:00:00.000Z"
}
```

不允许客户端提交可信 IP、地域信息。

## 10. 兼容性和异常处理

| 场景                  | 处理       |
| --------------------- | ---------- |
| Tracker 加载失败      | 不影响网站 |
| Site ID 缺失          | 停止采集   |
| localStorage 不可用   | 降级       |
| sessionStorage 不可用 | 降级       |
| SPA 路由变化          | 自动采集   |
| 同一路由重复通知      | 去重       |
| API 请求失败          | 静默失败   |
| 网络断开              | 不无限重试 |

## 11. 验收标准

- Script 标签可以正常接入。
- Site ID 正确读取。
- visitor_id 正常生成和复用。
- session_id 正常生成和复用。
- 首次页面加载只上报一次。
- SPA 路由变化自动上报。
- pushState 和 popstate 不产生重复 PV。
- hash 路由支持。
- URL 敏感参数被过滤。
- 采集请求不影响网站正常运行。

**结论：Tracker 首版必须同时支持传统页面和 SPA 页面。**