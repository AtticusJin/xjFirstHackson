# 学军中学黑客松赛事系统 · 部署说明文档

> 适用版本：2026-09-30（含隐私政策 / 同意勾选 / 联系方式加密 / 撤下资料 / **双模式数据层：SQLite 本地 + PostgreSQL 扣子生产**）
> 推荐部署路径：**A. 阿里云轻量应用服务器（大陆节点）+ ICP 备案**；或 **B. 扣子编程（Coze）托管（火山引擎 + 内置 PostgreSQL）**

---

## 0. 部署路径对比（先看这个）

| 方案 | 是否可行 | 说明 |
|---|---|---|
| **A. 阿里云/腾讯云轻量服务器（大陆）** | ✅ **推荐（长期稳定）** | 数据不出境、合规、可长期稳定运行；本仓库 `deploy/` 已备好一键部署三件套 |
| **B. 扣子编程（Coze）托管** | ✅ **可行（已改造，快速上线）** | 2026-09-30 起本项目支持双模式数据层：平台注入 `DATABASE_URL`（PostgreSQL）即自动切换，首次启动自动导入 `data/export.json` 真实数据。见本文档「1B 扣子部署」章节。**注意**：扣子生产环境容器可缩容/沙箱磁盘不持久，因此必须使用 PostgreSQL 模式，不能跑 SQLite 文件库 |
| C. 本机/局域网（现在） | ✅ 临时可用 | `npm start` 后手机访问局域网 IP，适合赛前测试与现场局域网演示 |
| D. Vercel / 腾讯云 CloudBase 等 | ⚠️ 需改造 | 需换云数据库 + 对象存储，改动量大，不建议 |

**结论：追求最快上线选 B（扣子）；追求长期稳定与自定义运维选 A。** 两者数据层都已兼容，切换只需换 `DATABASE_URL` 环境变量。

---

## 1A. 阿里云部署（方案 A，长期稳定）

### 1A.1 需要准备的东西

| 项目 | 说明 | 费用参考 |
|---|---|---|
| 服务器 | 阿里云轻量应用服务器，**地域选大陆**（如杭州/上海/北京），2C2G 起 | ¥50–100/月，学生认证更便宜 |
| 域名 | 阿里云万网注册，`.cn` 或 `.com` 均可 | ¥30–60/年 |
| ICP 备案 | 域名绑定大陆服务器必须备案；**主体建议用学校/组委会名义** | 免费，约 1–2 周 |
| 邮箱 | 发送验证码：Resend 或阿里云邮件推送/腾讯云 SES | 免费额度足够 |

> ⚠️ **备案期间**：域名无法通过 80/443 访问公网，可用 `http://服务器公网IP:3000` 先做内测；备案通过后再切域名 + HTTPS。

### 1A.2 服务器购买建议（方案 A）

- 轻量应用服务器 → **2 核 2G / 4G**，系统 **Ubuntu 22.04**（或 Debian）
- 流量：赛事周期百人规模，每月几百 GB 完全够
- 选大陆地域（杭州离学校近，网络体验好）；**不要选香港/海外**（数据出境涉及合规且无备案通道）
- 购买后开安全组：放行 **80（HTTP）/ 443（HTTPS）/ 22（SSH）**；3000 端口可先放开用于备案期访问，上线 HTTPS 后建议关闭

---

## 1B. 扣子编程（Coze）部署（方案 B，最快上线）

> 前提：本项目 **2026-09-30 起支持双模式数据层**——扣子部署时平台会注入 `DATABASE_URL`（PostgreSQL 连接串），服务自动切换 PostgreSQL 并从 `data/export.json` 导入真实数据（58 位选手 + 赛程 + 公告 + 队伍），**无需任何手工建库**。

### 1B.1 部署包

`deploy/xjhack-coze-deploy.zip`（28MB）已打好，内容：
- `server/`（含 `store.js` 双模式数据层、`index.js` 全量路由）
- `public/`（前端 + 头像资产 + 隐私政策页）
- `data/export.json`（真实数据快照，首次启动自动导入）
- `package.json` + `package-lock.json`（含 pg 依赖）
- `AGENTS.md`（给 AI 编程助手的项目说明，强烈建议导入时让扣子阅读）
- `README.md`、`scripts/`（含 `pg_e2e.js` 部署后自检）

### 1B.2 扣子端操作步骤

1. 打开扣子编程（code.coze.cn）→ 「从本地导入」→ 选择 `xjhack-coze-deploy.zip` 导入为项目（或先推到 GitHub 再「导入 GitHub 项目」）。
2. 项目类型选择 **「网页应用 / Web App」**，运行环境 Node.js（项目自带 `.engines` 约束 Node ≥ 22.5，扣子 Node 环境满足）。
3. 平台会要求配置：
   - **数据库**：勾选「启用数据库」（基于 PostgreSQL 引擎）。**首次部署时勾选「同步开发环境数据到生产」**——若未勾选也没关系，本项目首次启动会在 players 表为空时自动从 `data/export.json` 导入。
   - **环境变量**（在部署配置里添加）：
     - `PORT`：按平台默认（或由平台分配）
     - `ADMIN_EMAILS`：组委会邮箱，逗号分隔（登录后即管理员）
     - `ENC_KEY`：生成命令 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`（联系方式加密，务必保存）
     - `MAIL_MODE`：先 `dev` 内测；正式开赛前改 `resend`/`smtp` 并配好发信密钥
     - `WECHAT_*`：留空（已确认不需要微信登录）
   - **域名**：默认分配 `*.coze.site` 子域名即可内测；正式对外建议绑定自定义域名（需在火山引擎备案系统对该域名做 ICP 备案，1–20 个工作日；平台提供免费 SSL 证书，3 个月有效期，每年 20 张额度，到期续签）。
4. 点击部署。首次部署约 1–3 分钟，日志出现 `[store] 已从 export.json 导入真实数据（players:58 ...）` 即数据就绪。

### 1B.3 部署后自检

```bash
# 在项目根目录跑（需先 npm install）
DATABASE_URL=<平台提供的连接串> PORT=<平台端口> MAIL_MODE=dev node scripts/pg_e2e.js
```

预期输出：`结果：通过 31 项 / 失败 0 项`（覆盖：公开数据 / 体验登录 / 开放注册 / 资料更新 / 建队状态流转 / 认领 / 等待池 / 管理员）。

### 1B.4 扣子部署注意事项

| 事项 | 说明 |
|---|---|
| 数据持久化 | 扣子生产容器**沙箱磁盘不持久**（可缩容至 0），因此**严禁**在该环境用 SQLite 文件库；`DATABASE_URL` 存在时自动用 PostgreSQL，数据都在平台数据库里 |
| 数据备份 | 数据库由扣子托管，重要数据快照可随时用本地 `node scripts/export_data.js` 从 SQLite 导出；生产数据如需导出请通过平台数据库管理或 SQL 查询 |
| 更新迭代 | 改代码后重新打 zip 导入覆盖即可（数据保留在平台数据库）；或连接 GitHub 仓库持续部署 |
| 头像/静态资源 | 在 `public/assets/` 内随代码部署；若后续做对象存储 CDN，只需改选手 `avatar` 字段为完整 URL |
| 备案 | 凡在中国内地提供服务的网站都需 ICP 备案；扣子默认域名 `.coze.site` 用于内测，正式上线建议备案自定义域名（主体建议学校/组委会） |
| 限流 | 后端限流为单机内存 Map；扣子若开启多实例，限流各实例独立（对验证码防刷影响极小，仍建议生产把邮件真实接入） |

---

## 2. 域名 + ICP 备案

1. 在阿里云控制台「域名」注册域名（实名认证）
2. 「ICP 备案」→ 新增备案，填主体信息（学校/组委会，或经办人）
3. 阿里云会要求：主体证件、负责人、网站名称（如「学军中学黑客松赛事系统」）、网站备注
4. 备案审核约 1–2 周；审核期间保持服务器 80 端口可访问（阿里云备案要求）
5. 备案通过后：域名解析 A 记录 → 服务器公网 IP

---

## 3. 上传项目并配置

### 3.1 上传到服务器

```bash
# 本地 Mac 上执行（把项目整个传上去，排除 node_modules 和 .env）
cd /Users/jinkeep/Mac_Work/AtticusWork/XJ_Hackson
rsync -av --exclude node_modules --exclude .env --exclude 'data/*.db-*' ./ root@你的服务器IP:/opt/xjhack/
```

或手动 `scp`。确认服务器上目录结构：

```
/opt/xjhack/
├── server/index.js
├── server/db.js
├── public/
├── data/xjhack.db        # 数据库（含 58+1 位选手真实数据）
├── deploy/
│   ├── .env.production.example
│   ├── xjhack.service
│   └── deploy.sh
└── package.json
```

### 3.2 生成并配置生产 .env

```bash
cd /opt/xjhack
cp deploy/.env.production.example .env
vi .env
```

逐项填写（必填 4 项）：

```ini
# ① 加密密钥（联系方式加密存储，必填！）
ENC_KEY=<生成命令结果>

# ② 邮件发送模式（生产必选 resend 或 smtp）
MAIL_MODE=resend
RESEND_API_KEY=<你的 key>          # resend 模式填这个

# ③ 发件人（域名验证后可用）
SMTP_FROM="学军黑客松 <noreply@你的域名>"

# ④ 管理员邮箱（登录后自动获得管理员权限，逗号分隔）
ADMIN_EMAILS=组委会邮箱1,组委会邮箱2
```

**ENC_KEY 生成命令（在服务器上执行）：**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ `ENC_KEY` 一定要**保存好**（可记在密码管理器）：它用于加密选手联系方式，丢失后已加密的联系方式将无法解密。

---

## 4. 一键部署

```bash
cd /opt/xjhack
sudo bash deploy/deploy.sh
```

脚本自动完成：
1. 安装 Node 22（如未安装）
2. `npm install --omit=dev` 安装生产依赖
3. 创建专用运行用户 `xjhack` + 日志目录 `/var/log/xjhack`
4. 安装 systemd 服务 `xjhack.service` 并设为开机自启
5. 启动服务

**验证：**

```bash
curl http://127.0.0.1:3000/          # 返回 200 首页 HTML
curl http://127.0.0.1:3000/privacy.html   # 隐私政策页 200
tail -f /var/log/xjhack/err.log      # 看日志（应无 ENC_KEY 告警）
```

看到首页 HTML 即部署成功。

---

## 5. Nginx + HTTPS（备案通过后）

### 5.1 安装 Nginx + 证书

```bash
sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 5.2 Nginx 配置（`/etc/nginx/sites-available/xjhack`）

```nginx
server {
    listen 80;
    server_name xjhack.你的域名.com;
    # 强制 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name xjhack.你的域名.com;

    # 证书（certbot 自动生成后填入，或用 certonly 手动模式）
    ssl_certificate     /etc/letsencrypt/live/xjhack.你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/xjhack.你的域名.com/privkey.pem;

    # 静态资源长缓存
    location /assets/ { proxy_pass http://127.0.0.1:3000; expires 7d; }

    # 反代到 Node
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/xjhack /etc/nginx/sites-enabled/
sudo certbot --nginx -d xjhack.你的域名.com   # 自动签证书并配置
sudo nginx -t && sudo systemctl reload nginx
```

### 5.3 收尾

- 安全组关闭 3000 端口公网访问（只留 80/443/22）
- 浏览器访问 `https://xjhack.你的域名.com` 验证

---

## 6. 上线前最终 Checklist

| # | 事项 | 状态 |
|---|---|---|
| 1 | `MAIL_MODE=resend|smtp` + 真实发信密钥，验证码真实送达 | ☐ |
| 2 | `ADMIN_EMAILS` 换成组委会真实邮箱 | ☐ |
| 3 | `ENC_KEY` 已生成并写入 `.env` | ☐ |
| 4 | 域名解析生效 + HTTPS 强制跳转 | ☐ |
| 5 | 备份 `data/xjhack.db`（复制文件即可） | ☐ |
| 6 | 给选手发认领通知（找自己 → 认领 → 邮箱验证码登录） | ☐ |

> 上线前如需补充选手微信防冒领校验字段：`UPDATE players SET wechat='xxx' WHERE name='xxx'`（可选，不补也可正常认领）。

---

## 7. 数据备份与恢复

```bash
# 备份（建议每天/每次改动前）
cp /opt/xjhack/data/xjhack.db /var/backups/xjhack_$(date +%F).db

# 恢复
systemctl stop xjhack
cp /var/backups/xjhack_2026-10-01.db /opt/xjhack/data/xjhack.db
chown xjhack:xjhack /opt/xjhack/data/xjhack.db
systemctl start xjhack
```

> SQLite 单文件，整个数据库就是一个文件，备份即复制。

---

## 8. 常见问题

| 问题 | 处理 |
|---|---|
| 验证码收不到 | 检查 `MAIL_MODE` 是否已从 `dev` 改掉；`dev` 模式验证码打印在服务器日志/接口响应里；Resend 需先验证发信域名；查 `/var/log/xjhack/err.log` |
| 登录提示「发送太频繁」 | 限流保护：同邮箱 60s/1 封、同 IP 60s/5 封，属正常防刷 |
| 备案期无法用域名 | 用 `http://IP:3000` 内测；备案通过后再切域名 |
| 需要换服务器/迁移 | 拷贝项目目录 + `data/xjhack.db` + `.env` 到新机，重跑 `deploy.sh` |
| ENC_KEY 丢失 | 已加密联系方式无法解密（选手可自行在「我的」重新填写覆盖），务必提前备份 |
| 选手要求删除资料 | 登录后「我的」→「账号」→「撤下我的资料」自助完成；彻底注销联系组委会 |

---

## 9. 本次部署包清单（`deploy/` 目录）

| 文件 | 用途 |
|---|---|
| `.env.production.example` | 生产环境配置模板（ENC_KEY / 邮件 / 管理员） |
| `xjhack.service` | systemd 服务文件（开机自启 + 崩溃自动重启 + 日志） |
| `deploy.sh` | 一键部署脚本（Node 22 + 依赖 + 用户 + 服务） |
| `DEPLOYMENT_GUIDE.md` | 本文档 |

> 技术栈：Node 22（内置 `node:sqlite`）+ Express + 原生前端（无构建）。数据量百人级，SQLite 单文件足够，无需数据库服务。
