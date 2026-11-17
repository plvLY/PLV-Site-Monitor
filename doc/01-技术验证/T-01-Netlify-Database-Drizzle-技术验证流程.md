# PLV Site Monitor

# T-01：Netlify Database + Drizzle ORM 技术验证流程

**文档版本：** V1.0
**验证状态：** 已完成
**验证结论：** 通过
**验证项目：** `plv-site-monitor-db-test`
**文档类型：** 技术实施与测试记录

## 1. 验证目标

本阶段主要验证采用 Netlify 原生数据库及 Netlify Functions 构建后端数据访问层的可行性。

核心技术组合：

| 层次       | 技术                                      |
| ---------- | ----------------------------------------- |
| 云平台     | Netlify                                   |
| 数据库     | Netlify Database（PostgreSQL）            |
| ORM        | Drizzle ORM                               |
| 数据库迁移 | Drizzle Kit + Netlify Database Migrations |
| 后端接口   | Netlify Functions                         |
| 运行环境   | Node.js                                   |
| 代码托管   | GitHub                                    |

本次验证需要确认：

1. 本地能够初始化 Netlify Database。
2. Drizzle ORM 能够正常连接数据库。
3. 能够通过 Schema 生成数据库迁移文件。
4. Netlify Functions 能够调用 Drizzle ORM。
5. GitHub 推送代码后，Netlify 能够自动部署。
6. Netlify 部署能够自动执行数据库迁移。
7. Production Function 能够连接云端 PostgreSQL。
8. 云端能够完成 GET、POST、PATCH、DELETE 操作。

## 2. 测试环境

### 2.1 测试项目

本次使用独立临时项目，不影响正式 PLV Studio 网站。

| 项目            | 配置                                                         |
| --------------- | ------------------------------------------------------------ |
| 本地目录        | `E:\PLV APP HUB\PLV Site Monitor\plv-netlify-db-test`        |
| Netlify Project | `plv-site-monitor-db-test`                                   |
| Netlify URL     | [https://plv-site-monitor-db-test.netlify.app](https://plv-site-monitor-db-test.netlify.app/) |
| GitHub 仓库     | https://github.com/plvLY/plv-site-monitor-db-test            |
| Git 分支        | `main`                                                       |
| 数据库分支      | `production`                                                 |

注意：以上均为临时验证环境，不作为未来正式统计平台的生产环境。

### 2.2 开发环境

| 软件              | 实际版本      |
| ----------------- | ------------- |
| Node.js           | v24.19.0      |
| npm               | 11.17.0       |
| Netlify CLI       | 27.16.2       |
| @netlify/database | 2.0.1         |
| drizzle-orm       | 1.0.0-beta.22 |
| drizzle-kit       | 1.0.0-beta.22 |

实际安装版本以项目 `package-lock.json` 为准。

## 3. 项目目录结构

```
plv-netlify-db-test/
├── db/
│   ├── index.ts
│   └── schema.ts
│
├── netlify/
│   ├── database/
│   │   └── migrations/
│   │       ├── 20261104145630_create_planets/
│   │       ├── 20261104145631_seed_planets/
│   │       └── 20261104152451_create_test_records/
│   │
│   └── functions/
│       └── db-test.mts
│
├── public/
│   └── index.html
│
├── drizzle.config.ts
├── package.json
├── package-lock.json
└── .gitignore
```

说明：

- `db/schema.ts`：数据库表结构定义。
- `db/index.ts`：Drizzle 数据库实例。
- `drizzle.config.ts`：Drizzle Kit 配置。
- `netlify/database/migrations/`：数据库迁移文件。
- `netlify/functions/`：Netlify 后端接口。
- `public/`：静态网站发布目录。

## 4. 安装和初始化

### 4.1 创建项目

```
mkdir plv-netlify-db-test
cd plv-netlify-db-test

npm init -y
```

### 4.2 安装依赖

```
npm install @netlify/database drizzle-orm
npm install -D drizzle-kit
```

### 4.3 安装 Netlify CLI

```
npm install -g netlify-cli
```

检查版本：

```
node -v
npm -v
netlify --version
```

### 4.4 初始化 Netlify 项目

```
netlify login
netlify link
```

选择对应的临时测试项目：

```
plv-site-monitor-db-test
```

确认本地项目已经关联正确的 Netlify Project。

### 4.5 初始化数据库

按照 Netlify Database 官方流程启用数据库，并初始化本地开发数据库。

检查数据库状态：

```
netlify database status
```

本次本地数据库状态：

- Database enabled：true
- Package installed：true
- Migration directory：`netlify/database/migrations`
- Applied migrations：3
- Pending migrations：0

## 5. Drizzle ORM 配置

### 5.1 配置 Schema

文件：`db/schema.ts`

```
import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
} from "drizzle-orm/pg-core";

export const testRecords = pgTable("test_records", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

该表用于验证基本 CRUD 操作。

字段说明：

| 字段        | 类型         | 说明     |
| ----------- | ------------ | -------- |
| id          | serial       | 自增主键 |
| name        | varchar(100) | 记录名称 |
| description | text         | 描述     |
| created_at  | timestamp    | 创建时间 |
| updated_at  | timestamp    | 更新时间 |

### 5.2 配置数据库实例

文件：`db/index.ts`

```
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema";

export const db = drizzle({ schema });
```

这里使用 Netlify Database 专用 Drizzle 驱动。

注意：该驱动依赖 Netlify Database 运行环境，不应直接假设普通 Node.js 进程能够在没有相应运行时上下文的情况下连接数据库。

### 5.3 配置 Drizzle Kit

文件：`drizzle.config.ts`

```
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "netlify/database/migrations",
});
```

本次配置没有使用传统 PostgreSQL 连接字符串作为 Drizzle Kit 的迁移连接配置。

数据库迁移由 Netlify 部署流程负责执行。

## 6. 数据库迁移流程

### 6.1 迁移文件生成

根据 Schema 生成迁移文件。

使用当前安装版本支持的 Drizzle Kit 命令：

```
npx drizzle-kit generate
```

检查迁移文件：

```
netlify/database/migrations/
```

### 6.2 迁移文件说明

本次共生成并执行三个迁移：

| 迁移文件                             | 用途                    |
| ------------------------------------ | ----------------------- |
| `20261104145630_create_planets`      | 初始化 planets 表       |
| `20261104145631_seed_planets`        | 初始化 planets 测试数据 |
| `20261104152451_create_test_records` | 创建 test_records 表    |

其中 `planets` 是 Netlify 初始化示例表，本次保留它，用于验证迁移兼容性。

特别注意：

生成迁移文件后必须检查 SQL 内容。

不能直接假设生成的 SQL 一定安全。

本次曾出现迁移文件包含删除示例表的危险操作，经过人工检查后修复，确保原有 `planets` 表被保留。

### 6.3 本地迁移检查

```
netlify database status
```

预期：

```
Applied migrations: 3
Pending migrations: 0
```

本次本地数据库已经完成迁移验证。

### 6.4 本地数据库验证

连接本地数据库：

```
netlify database connect
```

检查表：

```
SELECT * FROM planets;

SELECT * FROM test_records;
```

本地验证结果：

- planets：8 条记录。
- test_records：初始为空。
- SQL 查询与 Drizzle ORM 查询数据一致。

## 7. Netlify Functions 开发

### 7.1 创建测试接口

文件：

```
netlify/functions/db-test.mts
```

完整代码：

```
import { db } from "../../db/index";
import { testRecords } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      const records = await db
        .select()
        .from(testRecords)
        .orderBy(desc(testRecords.id));

      return Response.json({
        success: true,
        data: records,
      });
    }

    if (req.method === "POST") {
      const body = await req.json();

      if (!body.name || typeof body.name !== "string") {
        return Response.json(
          {
            success: false,
            message: "name is required",
          },
          { status: 400 }
        );
      }

      const [record] = await db
        .insert(testRecords)
        .values({
          name: body.name,
          description: body.description ?? null,
        })
        .returning();

      return Response.json(
        {
          success: true,
          data: record,
        },
        { status: 201 }
      );
    }

    if (req.method === "PATCH") {
      const body = await req.json();

      if (!Number.isInteger(body.id)) {
        return Response.json(
          {
            success: false,
            message: "Valid id is required",
          },
          { status: 400 }
        );
      }

      const [record] = await db
        .update(testRecords)
        .set({
          ...(body.name !== undefined && {
            name: body.name,
          }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
          updatedAt: new Date(),
        })
        .where(eq(testRecords.id, body.id))
        .returning();

      return Response.json({
        success: true,
        data: record ?? null,
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json();

      const [record] = await db
        .delete(testRecords)
        .where(eq(testRecords.id, body.id))
        .returning();

      return Response.json({
        success: true,
        data: record ?? null,
      });
    }

    return new Response("Method Not Allowed", {
      status: 405,
    });
  } catch (error) {
    console.error("Database test error:", error);

    return Response.json(
      {
        success: false,
        message: "Database operation failed",
      },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/api/db-test",
};
```

### 7.2 接口说明

| HTTP 方法 | 接口           | 作用         |
| --------- | -------------- | ------------ |
| GET       | `/api/db-test` | 查询全部记录 |
| POST      | `/api/db-test` | 新增记录     |
| PATCH     | `/api/db-test` | 修改记录     |
| DELETE    | `/api/db-test` | 删除记录     |

本接口只用于技术验证。

正式业务接口还需要补充：

- 请求参数校验。
- 身份认证和授权。
- 统一异常处理。
- 日志与错误追踪。
- 限流和安全策略。
- 分页查询。
- 业务数据访问权限。

## 8. 本地 Function 测试

### 8.1 启动本地服务

```
netlify dev
```

默认访问：

```
http://localhost:8888
```

测试接口：

```
http://localhost:8888/api/db-test
```

### 8.2 GET 测试

```
curl http://localhost:8888/api/db-test
```

### 8.3 POST 测试

```
curl -X POST http://localhost:8888/api/db-test ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Local Test\",\"description\":\"Local CRUD test\"}"
```

### 8.4 PATCH 测试

```
curl -X PATCH http://localhost:8888/api/db-test ^
  -H "Content-Type: application/json" ^
  -d "{\"id\":1,\"name\":\"Updated Test\"}"
```

### 8.5 DELETE 测试

```
curl -X DELETE http://localhost:8888/api/db-test ^
  -H "Content-Type: application/json" ^
  -d "{\"id\":1}"
```

本地 GET、POST、PATCH、DELETE 全部验证通过。

## 9. GitHub 自动部署

### 9.1 初始化 Git

```
git init
git branch -M main
```

配置远程仓库：

```
git remote add origin https://github.com/plvLY/plv-site-monitor-db-test.git
```

### 9.2 .gitignore

```
.netlify/

node_modules/
.env
.env.*
!.env.example

dist/
.DS_Store

migration-backup/
```

注意：

数据库迁移文件需要提交到 GitHub。

本地数据库文件、临时备份、依赖目录和敏感环境变量不应提交。

### 9.3 提交代码

```
git add .
git commit -m "chore: initialize Netlify database integration test"
git push -u origin main
```

本次提交：

```
8665cb6 chore: initialize Netlify database integration test
```

### 9.4 Netlify 连接 GitHub

Netlify 项目连接：

```
Repository: plvLY/plv-site-monitor-db-test
Branch: main
```

构建配置：

| 配置项              | 值                |
| ------------------- | ----------------- |
| Production branch   | main              |
| Base directory      | 空                |
| Build command       | 空                |
| Publish directory   | public            |
| Functions directory | netlify/functions |

### 9.5 自动部署迁移

本次部署日志确认：

```
Netlify Database setup

Loading migrations from netlify/database/migrations directory:
 - 20261104145630_create_planets
 - 20261104145631_seed_planets
 - 20261104152451_create_test_records
```

随后：

```
Pending database migrations:
  - 20261104145630_create_planets
  - 20261104145631_seed_planets
  - 20261104152451_create_test_records

Database snapshot created

Database migrations applied:
  - 20261104145630_create_planets
  - 20261104145631_seed_planets
  - 20261104152451_create_test_records
```

由此确认：

GitHub 推送代码后，Netlify 能够识别迁移目录，并在 Production 部署过程中执行数据库迁移。

## 10. Production 数据库验证

进入：

```
Netlify
  → plv-site-monitor-db-test
  → Database
  → SQL Editor
```

查询数据库表：

```
SELECT
    table_schema,
    table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN (
    'pg_catalog',
    'information_schema'
  )
ORDER BY table_schema, table_name;
```

查询记录：

```
SELECT COUNT(*) AS planets_count
FROM planets;

SELECT COUNT(*) AS test_records_count
FROM test_records;
```

实际结果：

| 表           | 记录数 |
| ------------ | ------ |
| planets      | 8      |
| test_records | 0      |

验证通过。

说明迁移文件已经成功应用到云端 Production 数据库。

## 11. Production Function CRUD 验证

云端接口：

```
https://plv-site-monitor-db-test.netlify.app/api/db-test
```

### 11.1 GET 查询

请求：

```
GET /api/db-test
```

首次返回：

```
{
  "success": true,
  "data": []
}
```

验证通过。

### 11.2 POST 新增

PowerShell：

```
$body = @{
    name = "Cloud Production Test"
    description = "Netlify Function + Drizzle + Production PostgreSQL"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://plv-site-monitor-db-test.netlify.app/api/db-test" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

实际返回：

```
success: True
id: 1
name: Cloud Production Test
```

验证通过。

### 11.3 GET 再次查询

实际返回：

```
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Cloud Production Test",
      "description": "Netlify Function + Drizzle + Production PostgreSQL"
    }
  ]
}
```

验证通过。

### 11.4 PATCH 更新

PowerShell：

```
$body = @{
    id = 1
    name = "Cloud Production Test - Updated"
    description = "PATCH verification passed"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://plv-site-monitor-db-test.netlify.app/api/db-test" `
    -Method PATCH `
    -ContentType "application/json" `
    -Body $body |
    ConvertTo-Json -Depth 5
```

实际返回：

```
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Cloud Production Test - Updated",
    "description": "PATCH verification passed",
    "createdAt": "2026-11-05T10:34:01.000Z",
    "updatedAt": "2026-11-05T10:35:00.979Z"
  }
}
```

验证通过。

### 11.5 DELETE 删除

PowerShell：

```
$body = @{
    id = 1
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://plv-site-monitor-db-test.netlify.app/api/db-test" `
    -Method DELETE `
    -ContentType "application/json" `
    -Body $body |
    ConvertTo-Json -Depth 5
```

实际返回成功，并返回已删除记录。

### 11.6 最终 GET 验证

```
Invoke-RestMethod `
    -Uri "https://plv-site-monitor-db-test.netlify.app/api/db-test" `
    -Method GET |
    ConvertTo-Json -Depth 5
```

实际返回：

```
{
  "success": true,
  "data": []
}
```

验证通过。

## 12. T-01 测试验收结果

| 编号    | 测试内容                     | 结果 |
| ------- | ---------------------------- | ---- |
| T-01-01 | 本地数据库初始化与迁移       | 通过 |
| T-01-02 | 本地 Function + Drizzle CRUD | 通过 |
| T-01-03 | SQL 与 Drizzle 数据一致性    | 通过 |
| T-01-04 | Production 数据库自动迁移    | 通过 |
| T-01-05 | 云端 Function + Drizzle CRUD | 通过 |

**最终结论：T-01 全部通过。**

已验证的技术链路：

```
GitHub
   │
   ▼
Netlify 自动部署
   │
   ├── 识别数据库迁移文件
   │
   ├── 创建数据库快照
   │
   └── 执行数据库迁移
           │
           ▼
     Netlify Functions
           │
           ▼
        Drizzle ORM
           │
           ▼
   Netlify Database
      PostgreSQL
```

## 13. 正式环境实施注意事项

本次验证使用的是临时 Netlify 账号及临时 GitHub 仓库。

正式 PLV Site Monitor 部署时，需要重新创建正式环境。

### 13.1 正式环境重新初始化

正式部署时：

1. 使用新的 Netlify 账号。
2. 创建正式 Netlify Project。
3. 创建正式 Netlify Database。
4. 将正式 GitHub 仓库连接到新项目。
5. 将经过验证的迁移文件提交到正式仓库。
6. 执行正式部署。
7. 验证正式数据库表结构。
8. 验证正式 Function 数据访问。
9. 配置正式域名及环境变量。

### 13.2 数据迁移原则

本次测试数据库的数据不迁移到正式环境。

需要复用的是：

- 数据库 Schema。
- SQL Migration 文件。
- Drizzle ORM 配置。
- Function 实现。
- 项目目录结构。
- 测试脚本。

正式数据库由新的 Netlify 项目自动初始化，并通过迁移文件创建业务表。

### 13.3 生产环境安全要求

正式开发时需要补充：

- 管理后台身份认证。
- API 权限控制。
- Tracker 站点身份校验。
- CORS 域名限制。
- IP 获取及可信代理处理。
- 请求频率限制。
- 请求参数校验。
- 错误日志与异常追踪。
- IP 数据保留周期。
- 数据库备份与恢复策略。
- 数据库资源额度监控。

测试接口 `/api/db-test` 仅供验证，不应作为正式业务接口发布。

## 14. 当前阶段结论

T-01 已完成技术验证，证明以下组合能够正常工作：

**Netlify + Netlify Functions + Netlify Database + Drizzle ORM + GitHub 自动部署。**

后续 PLV Site Monitor 可以在该技术基线上继续进行业务架构设计与开发。

本次验证不代表已经完成生产级安全、性能、成本及可用性验证，相关内容需要在后续阶段单独验收。

**文档结束**