# PLV Site Monitor

PLV Site Monitor 是面向个人使用的网站访问统计与站点管理系统。首期以 Netlify Serverless 为主要部署方向，支持一个超级管理员管理多个站点，统计 PV、UV、Sessions、Bounce Rate 等指标，并提供 Overview、Trends、Pages、Sources、Devices、Locations 六个统计页面。

> **当前项目状态：** T-04 各专项任务均已完成验收，当前正在进行 T-04-FINAL Dashboard 整体验收收尾，尚未正式关闭。BUG-001、BUG-002、T-04-13、T-04-14、T-04-15 均已验收通过。T-05 已有真实数据链路进展，但尚未整体验收；T-06 正式部署必须等待 T-04、T-05 全部验收通过。详细进度见 `doc/PLV-Site-Monitor-项目开发进度与BUG汇总.md`。

## 目录结构

```
site-monitor/
├── .env.example                 # 环境变量模板（复制为 .env 后按需填写，不提交真实值）
├── .gitignore                   # Git 忽略规则
├── docker-compose.yml           # 本地开发数据库编排
├── drizzle.config.ts            # Drizzle ORM 配置
├── netlify.toml                 # Netlify 构建与函数配置
├── package.json                 # 根项目依赖与脚本（测试、类型检查等）
├── tsconfig.backend.json        # 后端 TypeScript 配置
├── vitest.config.mts            # 根项目 Vitest 配置
├── db/                          # 数据库 Schema（Drizzle）
├── netlify/functions/           # Netlify Serverless 函数（API 入口 + _shared 共享代码）
├── scripts/                     # 管理脚本（如 init-admin）
├── tests/                       # 根项目单元与集成测试（Vitest）
├── tracker/                     # 前端埋点 SDK（独立包，用于嵌入被监控站点）
├── dashboard/                   # Vue 3 管理后台
└── doc/                         # 技术验证、数据采集设计、统计分析模块等设计文档
```

## 快速开始

### 1. 环境变量

根目录提供 `.env.example`，复制一份为 `.env` 并按实际环境填写：

```bash
cp .env.example .env
```

`.env` 包含数据库连接字符串和 HMAC 密钥等敏感信息，**已加入 `.gitignore`，禁止提交到仓库**。

Dashboard 目录下提供 `.env.development`、`.env.production` 与 `.env.example`，按需配置 `VITE_API_BASE_URL` 等项。

### 2. 安装依赖

```bash
# 根项目依赖
npm install

# Dashboard 依赖
npm --prefix dashboard install

# Tracker 依赖
npm --prefix tracker install
```

### 3. 本地运行

启动 Dashboard 开发服务器：

```bash
npm --prefix dashboard run dev
```

运行根项目测试：

```bash
npm test
```

运行 Tracker 测试：

```bash
npm --prefix tracker run test
```

## 技术栈

| 模块 | 技术 |
|------|------|
| Dashboard | Vue 3 + TypeScript + Pinia + ECharts + Tailwind CSS |
| API | Netlify Functions |
| 数据库 | Netlify Database / PostgreSQL |
| ORM | Drizzle ORM |
| Tracker | 独立轻量浏览器埋点 SDK |
| 测试 | Vitest |
| 部署 | Netlify |

## 安全约束

- 仅支持一个超级管理员，不引入普通用户注册、多租户体系或复杂 RBAC。
- 所有 Dashboard 管理接口必须在服务端校验管理员身份与会话，不得仅依靠前端路由守卫。
- 公开 Tracker 采集接口需单独设计保护机制，不能简单套用 Dashboard 管理接口的登录校验。
- 每个 Analytics 请求必须经过服务端站点有效性与访问范围校验。
- `.env` 等含真实凭据的文件禁止提交到仓库。

## 已知问题与阶段状态

BUG-001、BUG-002 已正式关闭，不再属于当前未解决问题。

- **T-04-FINAL：** Dashboard 整体验收收尾中，等待最终确认。
- **T-05：** 真实数据链路仍有剩余任务待核对和完成，尚未整体验收。
- **T-06：** 正式部署尚未开始，必须等待 T-04、T-05 验收通过。

完整任务状态请参阅 `doc/PLV-Site-Monitor-项目开发进度与BUG汇总.md`。
