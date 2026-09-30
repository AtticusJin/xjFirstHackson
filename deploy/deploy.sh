#!/usr/bin/env bash
# 学军黑客松赛事系统 · 阿里云/腾讯云 轻量服务器一键部署脚本
# 用法（服务器上执行）：
#   1) 上传项目到服务器（如 scp -r 到 /opt/xjhack）
#   2) cp deploy/.env.production.example .env 并填写（密钥/邮件/管理员）
#   3) sudo bash deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/xjhack}"
APP_USER="${APP_USER:-xjhack}"

echo "==> 1/5 安装 Node 22（如未安装）"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> 2/5 安装依赖"
cd "$APP_DIR"
npm install --omit=dev

echo "==> 3/5 建专用用户与目录"
sudo id "$APP_USER" >/dev/null 2>&1 || sudo useradd -r -s /usr/sbin/nologin "$APP_USER"
sudo mkdir -p /var/log/xjhack
sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR" /var/log/xjhack

echo "==> 4/5 安装 systemd 服务"
sed -e "s|^User=.*|User=$APP_USER|" -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" \
  deploy/xjhack.service | sudo tee /etc/systemd/system/xjhack.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable xjhack

echo "==> 5/5 启动"
sudo systemctl restart xjhack
sleep 2
sudo systemctl status xjhack --no-pager || true

echo ""
echo "完成。本地验证：curl http://127.0.0.1:3000/"
echo "日志：tail -f /var/log/xjhack/err.log"
echo "下一步：配置 Nginx 反代 + HTTPS（见 README「生产部署」章节）"
