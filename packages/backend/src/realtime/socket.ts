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
  /**
   * Override the MANDATORY identity verifier invoked for a connection that
   * DOES present a handshake token (tests inject a stub; prod uses
   * `oxyClient.authSocket()`). Always wrapped in `optionalSocketAuth` below —
   * a connection with no token is let through anonymously without ever
   * calling this verifier.
   */
  socketAuth?: SocketAuth;
}

/**
 * Wrap a MANDATORY identity-verifying socket middleware so identity becomes
 * OPTIONAL on the connection itself: a handshake with no `auth.token` is let
 * through anonymously (`socket.user` / `socket.data.userId` stay unset). A
 * handshake that DOES present a token is still fully verified by the wrapped
 * middleware, and the connection is REJECTED if that token is invalid — a bad
 * token is never silently downgraded to an anonymous connection.
 *
 * Anonymous payers get no identity from the connection at all; they instead
 * prove authorization per-intent through the `subscribe` capability check
 * below (a verified `client_secret`) — the same checkout-payer model Stripe
 * uses. This is why the connection can safely go identity-optional: nothing
 * reachable from an anonymous socket is identity-scoped (see `initSocket`).
 */
export function optionalSocketAuth(requireIdentity: SocketAuth): SocketAuth {
  return (socket, next) => {
    const handshake = (socket as { handshake?: { auth?: { token?: unknown } } })
      .handshake;
    const token = handshake?.auth?.token;
    if (typeof token !== "string" || token.length === 0) {
      next();
      return;
    }
    void requireIdentity(socket, next);
  };
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
 * Wire the realtime layer. The CONNECTION is identity-optional (see
 * `optionalSocketAuth`) — a checkout/embed payer with no Oxy session can
 * still connect. Joining a specific intent's room is capability-scoped: it
 * requires proving possession of that intent's `client_secret`, verified in
 * constant time, regardless of whether the socket carries an identity — so
 * ANY holder of a valid client_secret can subscribe to that intent (and only
 * that intent), never enumerate someone else's. The payer's wallet then
 * receives live `intent.updated` events as the settlement watcher advances
 * the intent. `subscribe` is the only event this layer handles; if a future
 * event needs to be identity/merchant-scoped, it must check `socket.user`
 * itself — the optional connection auth does NOT imply every event is safe
 * for an anonymous socket.
 */
export function initSocket(io: Server, deps: SocketDeps = {}): void {
  const identityAuth = deps.socketAuth ?? oxyClient.authSocket();
  io.use(optionalSocketAuth(identityAuth));

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
