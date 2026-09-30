/* 零依赖 SMTP 客户端（AUTH LOGIN + TLS），用于阿里云邮件推送 / 腾讯云 SES 等 465 端口 */
const net = require('net');
const tls = require('tls');

function smtpCmd(sock, expect, line) {
  return new Promise((resolve, reject) => {
    const onData = buf => {
      const text = buf.toString('utf8');
      const code = parseInt(text.slice(0, 3), 10);
      if (code === expect) {
        sock.removeListener('data', onData);
        resolve(text);
      } else if (code >= 500) {
        sock.removeListener('data', onData);
        reject(new Error(`SMTP ${expect} 期望失败: ${text.trim()}`));
      }
      // 其他中间码继续等待
    };
    sock.on('data', onData);
    sock.write(line + '\r\n');
  });
}

async function sendSmtp(to, code) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || '学军黑客松 <noreply@example.com>';
  if (!host || !user || !pass) throw new Error('SMTP 配置缺失（SMTP_HOST/SMTP_USER/SMTP_PASS）');

  const raw = net.connect({ host, port });
  const sock = port === 465 ? tls.connect({ socket: raw, servername: host }) : raw;
  await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });

  await smtpCmd(sock, 220, 'EHLO xjhack.local');
  // EHLO 可能有多次 250 响应，最后再发 AUTH
  sock.removeAllListeners('data');
  await smtpCmd(sock, 250, 'AUTH LOGIN');
  await smtpCmd(sock, 334, Buffer.from(user).toString('base64'));
  await smtpCmd(sock, 235, Buffer.from(pass).toString('base64'));
  await smtpCmd(sock, 250, `MAIL FROM:<${from.match(/<([^>]+)>/)?.[1] || from}>`);
  await smtpCmd(sock, 250, `RCPT TO:<${to}>`);
  await smtpCmd(sock, 354, 'DATA');
  const html = `学军中学黑客松登录验证码：<b>${code}</b>（10 分钟内有效）`;
  await smtpCmd(sock, 250, `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from('【学军黑客松】登录验证码').toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n.`);
  await smtpCmd(sock, 221, 'QUIT');
  sock.end();
  return true;
}

module.exports = { sendSmtp };
