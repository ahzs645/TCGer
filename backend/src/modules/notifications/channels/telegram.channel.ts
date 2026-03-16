// ---------------------------------------------------------------------------
// Telegram bot notification channel
// ---------------------------------------------------------------------------

export async function sendTelegram(chatId: string, botToken: string, title: string, body: string): Promise<void> {
  if (!chatId || !botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `*${title}*\n${body}`,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('[telegram] Message delivery failed:', err);
  }
}
