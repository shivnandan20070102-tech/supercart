// Invoice email sender — Resend (primary) + Gmail SMTP/Nodemailer (fallback).
// SELECTED SERVICE: Resend (https://resend.com) — Render Free Tier par sabse
// aasaan, koi SMTP port/firewall issue nahi, sirf 1 API key chahiye.
// Free Tier: 100 emails/day, 3000/month — SuperCart ke liye kaafi.
//
// SETUP (exact steps):
//  1. https://resend.com par signup karo (GitHub/Google se 1-click).
//  2. Dashboard -> "API Keys" -> "Create API Key" -> key copy karo.
//  3. Render Dashboard -> tumhari backend service -> Environment ->
//     RESEND_API_KEY=<copied-key> add karo + Save (auto-redeploy).
//  4. INVOICE_FROM_EMAIL me:
//     - Bina domain ke test: onboarding@resend.dev (sirf Resend account
//       wale email par jayega — customer ko bhejne ke liye STEP 5 zaroori).
//     - Production (har customer ko): "Domains" -> "Add Domain" ->
//       apna domain verify karo (2 DNS records), phir
//       INVOICE_FROM_EMAIL=orders@tumhara-domain.com set karo.
//  5. GMAIL FALLBACK (agar Resend key/domain ready nahi):
//     Google Account -> Manage Account -> Security -> 2-Step Verification ON
//     -> "App passwords" -> app=Mail, device=Other(Render) -> 16-char
//     password copy karo. Render env me:
//     SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=tum@gmail.com
//     SMTP_PASS=<16-char-app-password> INVOICE_FROM_EMAIL=tum@gmail.com
//     (Gmail free: ~500 emails/day, kisi bhi customer ko bhej sakte ho.)
//
// Priority: RESEND_API_KEY set ho to Resend, warna SMTP_* set ho to Gmail,
// warna sirf server log (order/email flow kabhi crash nahi hoga).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY) ||
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export const emailProvider = () => {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'log-only';
};

const sendViaResend = async ({ to, subject, text, pdfBuffer, filename }) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.INVOICE_FROM_EMAIL || 'onboarding@resend.dev',
      to: [to],
      subject,
      text,
      attachments: [
        { filename, content: Buffer.from(pdfBuffer).toString('base64') },
      ],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || json?.error || `Resend error (${res.status})`);
  return { provider: 'resend', id: json?.id || null };
};

const sendViaSmtp = async ({ to, subject, text, pdfBuffer, filename }) => {
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: process.env.INVOICE_FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments: [{ filename, content: Buffer.from(pdfBuffer), contentType: 'application/pdf' }],
  });
  return { provider: 'smtp', id: info?.messageId || null };
};

export const sendInvoiceEmail = async ({ to, subject, text, pdfBuffer, filename }) => {
  const cleanTo = String(to || '').trim();
  if (!EMAIL_RE.test(cleanTo)) return { sent: false, reason: 'no-customer-email' };
  if (!pdfBuffer || pdfBuffer.length === 0) return { sent: false, reason: 'empty-pdf' };
  const mail = {
    to: cleanTo,
    subject: subject || `SuperCart Order Receipt`,
    text: text || 'Thank you for shopping with SuperCart! Invoice attached.',
    pdfBuffer,
    filename: filename || 'SuperCart-Invoice.pdf',
  };
  try {
    if (process.env.RESEND_API_KEY) {
      const r = await sendViaResend(mail);
      console.log(`📧 Invoice email sent via Resend to ${cleanTo} (${r.id || 'ok'})`);
      return { sent: true, to: cleanTo, ...r };
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const r = await sendViaSmtp(mail);
      console.log(`📧 Invoice email sent via SMTP to ${cleanTo} (${r.id || 'ok'})`);
      return { sent: true, to: cleanTo, ...r };
    }
    console.log(`📧 [log-only] Email NOT configured — invoice for ${cleanTo} skipped. Set RESEND_API_KEY or SMTP_* in Render env.`);
    return { sent: false, reason: 'email-not-configured', to: cleanTo, provider: 'log-only' };
  } catch (e) {
    console.warn(`⚠️ Invoice email failed to ${cleanTo}: ${e.message}`);
    return { sent: false, reason: e.message, to: cleanTo };
  }
};

export default { sendInvoiceEmail, isEmailConfigured, emailProvider };
