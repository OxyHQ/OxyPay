import type { Server, Socket } from "socket.io";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import { PaymentIntent } from "../models/PaymentIntent";
import { toPaymentIntentDTO, type PaymentIntentDocument } from "../lib/serialize";

/** Realtime room a single intent's updates are broadcast to. */
export function intentRoom(id: string): string {
  return `intent:${id}`;
}

/** Socket.io connection-authentication middleware `(socket, next) => …`. */
export type SocketAuth = (
  socket: unknown,
  next: (err?: Error) => void,
) => void | Promise<void>;

export interface SocketDeps {
  /** Override the connection auth (tests inject a stub; prod uses Oxy). */
  socketAuth?: SocketAuth;
}

interface SubscribeRequest {
  intentId: string;
  clientSecret: string;
}

function parseSubscribe(payload: unknown): SubscribeRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { intentId, clientSecret } = payload as Record<string, unknown>;
  if (typeof intentId !== "string" || typeof clientSecret !== "string") {
    return null;
  }
  return { intentId, clientSecret };
}

/**
 * Wire the realtime layer. Connections are authenticated with Oxy identity
 * (`oxyClient.authSocket()`), but joining a specific intent's room additionally
 * requires proving possession of that intent's `client_secret` — so an authed
 * user can only subscribe to intents they are actually paying, never enumerate
 * someone else's. The payer's wallet then receives live `intent.updated` events
 * as the settlement watcher advances the intent.
 */
export function initSocket(io: Server, deps: SocketDeps = {}): void {
  const socketAuth = deps.socketAuth ?? oxyClient.authSocket();
  io.use(socketAuth);

  io.on("connection", (socket: Socket) => {
    socket.on(
      "subscribe",
      async (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
        const request = parseSubscribe(payload);
        if (request === null) {
          ack?.({ ok: false });
          return;
        }

        const intent = await PaymentIntent.findOne({ id: request.intentId });
        if (
          intent === null ||
          !verifySecret(request.clientSecret, intent.clientSecret)
        ) {
          ack?.({ ok: false });
          return;
        }

        await socket.join(intentRoom(request.intentId));
        ack?.({ ok: true });
      },
    );
  });
}

/** Broadcast an intent's current state to every subscriber of its room. */
export function emitIntentUpdate(
  io: Server,
  intent: PaymentIntentDocument,
): void {
  io.to(intentRoom(intent.id)).emit("intent.updated", toPaymentIntentDTO(intent));
}
