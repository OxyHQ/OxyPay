/**
 * `optionalSocketAuth` is the ROOT of the capability-based realtime model:
 * it decides whether a connection needs identity at all. These tests pin
 * that decision down in isolation (no real `oxyClient`, no Mongo) so the
 * capability semantics can't silently regress underneath the `subscribe`
 * capability check, which is covered end-to-end in `__tests__/e2e.test.ts`.
 */
import { test, expect } from "bun:test";
import { optionalSocketAuth, type SocketAuth } from "../socket";

function fakeSocket(auth: Record<string, unknown> = {}): unknown {
  return { handshake: { auth } };
}

test("optionalSocketAuth: no handshake token connects anonymously without invoking the identity verifier", async () => {
  let called = false;
  const requireIdentity: SocketAuth = (_socket, next) => {
    called = true;
    next();
  };

  let err: Error | undefined;
  await optionalSocketAuth(requireIdentity)(fakeSocket(), (e) => {
    err = e;
  });

  expect(called).toBe(false);
  expect(err).toBeUndefined();
});

test("optionalSocketAuth: an empty-string token is treated the same as no token (anonymous, verifier not invoked)", async () => {
  let called = false;
  const requireIdentity: SocketAuth = (_socket, next) => {
    called = true;
    next();
  };

  let err: Error | undefined;
  await optionalSocketAuth(requireIdentity)(fakeSocket({ token: "" }), (e) => {
    err = e;
  });

  expect(called).toBe(false);
  expect(err).toBeUndefined();
});

test("optionalSocketAuth: a non-string token is treated as absent (anonymous, verifier not invoked)", async () => {
  let called = false;
  const requireIdentity: SocketAuth = (_socket, next) => {
    called = true;
    next();
  };

  let err: Error | undefined;
  await optionalSocketAuth(requireIdentity)(
    fakeSocket({ token: 12345 }),
    (e) => {
      err = e;
    },
  );

  expect(called).toBe(false);
  expect(err).toBeUndefined();
});

test("optionalSocketAuth: a present token is verified by the wrapped identity middleware and accepted through", async () => {
  const socket = fakeSocket({ token: "valid-token" });
  let seenSocket: unknown;
  const requireIdentity: SocketAuth = (s, next) => {
    seenSocket = s;
    next();
  };

  let err: Error | undefined;
  await optionalSocketAuth(requireIdentity)(socket, (e) => {
    err = e;
  });

  expect(seenSocket).toBe(socket);
  expect(err).toBeUndefined();
});

test("optionalSocketAuth: a present but INVALID token is rejected outright — never silently downgraded to anonymous", async () => {
  const requireIdentity: SocketAuth = (_socket, next) => {
    next(new Error("Invalid token"));
  };

  let err: Error | undefined;
  await optionalSocketAuth(requireIdentity)(
    fakeSocket({ token: "forged" }),
    (e) => {
      err = e;
    },
  );

  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toBe("Invalid token");
});
