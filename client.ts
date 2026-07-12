/**
 * Telegram Bot API client. sendMessage() is called only from the queue
 * worker (src/worker/queue.ts) — never from the webhook handler — so that
 * Telegram's availability never affects webhook response latency.
 */

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
  error_code?: number;
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<TelegramSendResult>;
}

export function createTelegramClient(botToken: string): TelegramClient {
  if (!botToken) {
    throw new Error("[telegram] botToken is required to construct a TelegramClient");
  }

  return {
    async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      // Telegram returns a JSON body even on 4xx/5xx — parse regardless of
      // HTTP status so callers get `description`/`error_code` on failure.
      const body = await response.json() as TelegramSendResult;
      return body;
    },
  };
}
