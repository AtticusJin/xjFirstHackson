# XJHACK 学军中学黑客松赛事系统 · 给 AI 编程助手的项目说明

本说明供扣子编程（Coze Code）等 AI 编程工具在导入本项目后理解架构与约束，避免误改核心逻辑。

## 项目是什么

学军中学黑客松的全栈赛事平台：选手认领/开放注册 → 邮箱验证码登录 → 个人资料自助管理（标签/简介/联系方式）→ 组队广场 + 队伍项目状态机 → 等待池 → 管理员后台（赛程/公告/选手/队伍/认领管理）。暗色霓虹视觉，移动端优先。

## 技术栈

- 运行时：**Node.js ≥ 22.5**（用了内置 `node:sqlite` 与全局 fetch）
- 框架：Express 4，前端为 `public/index.html` 单文件应用（无构建步骤）
- 数据库：**双模式数据层**（见下）
- 邮件：`server/mail.js`（MAIL_MODE=dev 时控制台输出验证码；生产用 SMTP/Resend）

## 启动方式

```bash
npm install
npm start        # 读取 .env → node server/index.js
```

默认监听 3000 端口（`PORT` 环境变量可改）。

## 关键：双模式数据层（server/store.js）

**这是本项目最重要的设计，改数据访问前必读。**

- 未设置 `DATABASE_URL` → SQLite 模式：使用 `node:sqlite`，数据文件 `data/xjhack.db`（本地/开发）。
- 设置了 `DATABASE_URL`（扣子/火山引擎部署时平台注入 PostgreSQL 连接串）→ PostgreSQL 模式：自动切换，使用 npm 依赖 `pg`。

所有业务代码只通过 `store.get(sql, ...args)` / `store.all(...)` / `store.run(...)` 访问数据库：

- SQL 参数占位符统一写 `?`（适配层自动翻译为 PG 的 `$1..$n`）；
- 所有 INSERT 必须带 `RETURNING id`，`store.run` 返回 `{ changes, lastInsertRowid }`；
- 时间统一存北京时间字符串 `'YYYY-MM-DD HH:MM:SS'`（两模式 DDL 已保证）；
- `desc` 是 PG 保留字：业务 SQL 中作为列名出现的 `desc` 由适配层自动加引号，请勿在 SQL 中手工写 `"desc"` 以外的形式，也**不要改动适配层**；
- `server/db.js` 是旧版 SQLite 专用文件，**已废弃**，勿再引用。

## 数据与首次导入

- 真实数据快照在 `data/export.json`（58 位真实报名选手 + 演示选手「金熙林」 + 赛程/公告/队伍/认领记录，联系人字段已清空）。
- 扣子上 PostgreSQL 首次启动时，若 players 表为空会自动从 `data/export.json` 导入（含自增序列重置），**无需手工迁移**。
- 更新快照：本地跑 `node scripts/export_data.js`（会排除登录令牌/验证码表，并把演示选手金熙林置为未认领）。
- 数据备份/导出：直接下载 `data/export.json` 即可（PostgreSQL 模式运行中导出需通过 SQL 查询导出后按结构重建，建议以部署前快照为准）。

## 环境变量（.env 或平台环境变量）

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 扣子生产必需 | 平台注入的 PostgreSQL 连接串；本地不要设置（否则走 SQLite） |
| `PORT` | 否 | 默认 3000 |
| `MAIL_MODE` | 是 | `dev`=控制台打印验证码（仅试验期）；`smtp`/`resend`=真实发信 |
| `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM` | smtp 时 | 发信配置 |
| `RESEND_API_KEY` | resend 时 | Resend API Key |
| `ADMIN_EMAILS` | 是 | 管理员邮箱，逗号分隔；验证码登录后自动获得管理后台权限 |
| `ENC_KEY` | 生产强烈建议 | 64 位 hex（32 字节）；联系方式 AES-256-GCM 加密密钥。生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `WECHAT_APPID/WECHAT_APPSECRET/WECHAT_REDIRECT_URI` | 否 | 已确认不需要微信登录，留空即可 |

## 目录结构

```
public/         前端（index.html 单文件应用 + 头像资产 + privacy.html 隐私政策 + admin.html/screen.html 独立页）
server/
  index.js      全部 HTTP 路由与业务逻辑（含限流/加密/会话）
  store.js      双模式数据层（唯一 DB 入口，勿改动适配机制）
  mail.js       验证码邮件
  seed-data.js  内置演示种子（仅当无 export.json 且库为空时使用）
scripts/
  export_data.js  导出真实数据快照 → data/export.json
  pg_e2e.js       PostgreSQL 模式端到端自检（部署后建议跑一次：PORT=<部署端口> DATABASE_URL=... node scripts/pg_e2e.js）
deploy/         阿里云部署三件套 + 扣子部署包（详见 deploy/DEPLOYMENT_GUIDE.md）
data/export.json 数据快照（首次启动自动导入）
```

## 给 AI 的纪律

1. **不要改 `server/store.js` 的适配机制**（除非明确需要支持新数据库特性）。
2. **新增 SQL 一律走 `store.*`，占位符 `?`，INSERT 带 `RETURNING id`**。
3. **不要依赖 SQLite 独有方言**（`datetime('now','localtime')`、`AUTOINCREMENT` 等）——两模式 DDL 已统一，业务 SQL 只写标准 SQL。
4. `public/index.html` 是单文件前端，改动后用 `node -e "new Function(require('fs').readFileSync('public/index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1])"` 做语法自检。
5. 认证、限流、加密（ENC_KEY）、隐私（撤下资料/同意勾选）属安全边界，改动需谨慎并说明。
