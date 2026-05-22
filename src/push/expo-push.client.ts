import { Logger } from "@nestjs/common";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_CHUNK_SIZE = 100;

const INVALID_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
  "MismatchSenderId",
  "DeveloperError",
]);

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default" | null;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export type ExpoPushSendFn = (
  messages: ExpoPushMessage[],
) => Promise<ExpoPushTicket[]>;

const defaultLogger = new Logger("ExpoPushClient");

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  sendFn: ExpoPushSendFn = defaultExpoSend,
): Promise<{
  tickets: ExpoPushTicket[];
  invalidTokens: string[];
}> {
  const tickets: ExpoPushTicket[] = [];
  const invalidTokens = new Set<string>();

  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
    const chunkTickets = await sendFn(chunk);
    tickets.push(...chunkTickets);

    chunkTickets.forEach((ticket, index) => {
      if (ticket.status !== "error") {
        return;
      }
      const errorCode = ticket.details?.error ?? ticket.message ?? "";
      if (INVALID_TOKEN_ERRORS.has(errorCode)) {
        invalidTokens.add(chunk[index].to);
      } else {
        defaultLogger.warn(
          `Expo push ticket error for ${chunk[index].to}: ${errorCode || ticket.message}`,
        );
      }
    });
  }

  return { tickets, invalidTokens: [...invalidTokens] };
}

export async function defaultExpoSend(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expo push HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: ExpoPushTicket[] };
  if (!Array.isArray(json.data) || json.data.length !== messages.length) {
    throw new Error("Expo push response missing ticket data");
  }
  return json.data;
}

export function isInvalidExpoTokenError(code: string | undefined): boolean {
  return !!code && INVALID_TOKEN_ERRORS.has(code);
}
