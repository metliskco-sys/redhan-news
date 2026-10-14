/**
 * Transactional email.
 *
 * There are no SMTP credentials in this project, so the default transport
 * writes the message to the server log. That is enough for development and for
 * a first deploy where the reset link can be read out of the logs.
 *
 * To actually deliver, set these and uncomment the transport block in
 * sendResetEmail:
 *
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465
 *   MAIL_FROM=no-reply@redhan.mv
 *
 * or call sendResetEmail from a job that posts to your provider's API.
 */

const SITE_NAME = 'Redhan';

function buildResetEmail(to, resetUrl) {
    return {
        to,
        subject: `Reset your ${SITE_NAME} password`,
        text: [
            `We received a request to reset your ${SITE_NAME} password.`,
            '',
            'Open this link to choose a new one:',
            resetUrl,
            '',
            'The link expires in one hour and can be used once.',
            '',
            `If you did not ask for this, you can ignore this email — your password stays as it is.`,
            '',
            `— ${SITE_NAME}`
        ].join('\n'),
        html: `
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a1628;color:#e7eef9;padding:32px;border-radius:12px">
  <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px">Reset your ${SITE_NAME} password</h1>
  <p style="color:#a2b5d0;line-height:1.6">We received a request to reset your ${SITE_NAME} password. Choose a new one using the button below.</p>
  <p style="margin:24px 0">
    <a href="${resetUrl}" style="display:inline-block;padding:12px 22px;background:#4aa3ef;color:#04101f;text-decoration:none;border-radius:6px;font-weight:600">Choose a new password</a>
  </p>
  <p style="color:#6e82a3;font-size:13px;line-height:1.6">This link expires in one hour and can only be used once. If you did not request it, you can safely ignore this email.</p>
</div>`.trim()
    };
}

/**
 * Deliver a password reset link.
 * Never throws: a failed email must not turn into a 500 or leak that an
 * account exists.
 */
async function sendResetEmail(to, resetUrl) {
    const { to: recipient, subject, text, html } = buildResetEmail(to, resetUrl);

    // ----- Development / no-Credentials transport: log it -----
    console.log('\n--- PASSWORD RESET EMAIL ---');
    console.log(`To: ${recipient}`);
    console.log(`Subject: ${subject}`);
    console.log(text.split('\n').map(l => `  ${l}`).join('\n'));
    console.log('----------------------------\n');

    // ----- Production transport (uncomment once credentials exist) -----
    // if (process.env.SMTP_URL) {
    //   const nodemailer = require('nodemailer');
    //   const transport = nodemailer.createTransport(process.env.SMTP_URL);
    //   await transport.sendMail({
    //     from: process.env.MAIL_FROM || 'no-reply@redhan.mv',
    //     to: recipient,
    //     subject,
    //     text,
    //     html
    //   });
    // }

    return { delivered: false, logged: true };
}

module.exports = { sendResetEmail, buildResetEmail };
