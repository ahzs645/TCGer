// ---------------------------------------------------------------------------
// Email notification channel (placeholder — swap in nodemailer when SMTP configured)
// ---------------------------------------------------------------------------

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  // TODO: integrate nodemailer with SMTP config from env
  console.log(`[email] Would send to ${to}: ${subject}`);
}
