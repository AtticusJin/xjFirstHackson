/* 邮件发送：dev（控制台打印）/ resend（API）/ smtp */
const crypto = require('crypto');

function genCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendCode(email, code) {
  const mode = (process.env.MAIL_MODE || 'dev').toLowerCase();
  if (mode === 'dev') {
    console.log(`[mail-dev] 验证码 ${code}  →  ${email}`);
    return { ok: true, dev: true };
  }
  if (mode === 'resend' && process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.SMTP_FROM || '学军黑客松 <noreply@example.com>',
        to: [email],
        subject: '【学军黑客松】登录验证码',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#0b1220">学军中学黑客松</h2>
          <p>你的登录验证码是：</p>
          <p style="font-size:32px;letter-spacing:6px;font-weight:bold;color:#46f0c8">${code}</p>
          <p>10 分钟内有效，请勿转发给他人。</p>
        </div>`
      })
    });
    if (!r.ok) throw new Error(`resend error ${r.status}`);
    return { ok: true };
  }
  if (mode === 'smtp') {
    // 使用 nodemailer 需要额外安装；本实现通过 SMTP 直连（支持阿里云/腾讯云 SMTP）
    const { sendSmtp } = require('./smtp');
    await sendSmtp(email, code);
    return { ok: true };
  }
  throw new Error('MAIL_MODE 未配置可用通道（dev / resend / smtp）');
}

module.exports = { sendCode, genCode };
