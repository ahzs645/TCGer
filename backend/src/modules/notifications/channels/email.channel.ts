// ---------------------------------------------------------------------------
// Email has no configured delivery provider. Never report a log line as delivery.
// ---------------------------------------------------------------------------

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  throw Object.assign(new Error('Email delivery is unavailable. Use in-app notifications or a configured Discord/Telegram channel.'), {
    status: 501, code: 'EMAIL_DELIVERY_UNAVAILABLE',
  });
}
