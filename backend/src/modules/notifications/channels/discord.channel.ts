// ---------------------------------------------------------------------------
// Discord webhook notification channel
// ---------------------------------------------------------------------------

export async function sendDiscord(webhookUrl: string, title: string, body: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          description: body,
          color: 0x5865F2 // Discord blurple
        }]
      })
    });
  } catch (err) {
    console.error('[discord] Webhook delivery failed:', err);
  }
}
