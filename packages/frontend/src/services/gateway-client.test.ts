import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { EnrichmentResult } from "@oxypay/shared-types";

const postMock = mock(async (_path: string, _body: unknown): Promise<unknown> => {
  throw new Error("postMock not configured for this test");
});

const getMock = mock(async (_path: string, _config?: unknown): Promise<unknown> => {
  throw new Error("getMock not configured for this test");
});

mock.module("./oxy-services", () => ({
  oxyServices: {
    createLinkedClient: () => ({ client: { post: postMock, get: getMock } }),
  },
}));

const {
  reserveNextSocialAddress,
  enrichAddresses,
  getSocialReceiveCursor,
  KeylessRecipientError,
} = await import("./gateway-client");

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
});

describe("reserveNextSocialAddress", () => {
  test("returns the reserved address and index", async () => {
    postMock.mockImplementationOnce(async () => ({ address: "TAbC123", index: 1 }));

    const result = await reserveNextSocialAddress("alice", "testnet");

    expect(result).toEqual({ address: "TAbC123", index: 1 });
    expect(postMock).toHaveBeenCalledWith("/v1/social/alice/next_address", {
      network: "testnet",
    });
  });

  test("URL-encodes the username", async () => {
    postMock.mockImplementationOnce(async () => ({ address: "TAbC123", index: 1 }));
    await reserveNextSocialAddress("weird name", "testnet");
    expect(postMock).toHaveBeenCalledWith("/v1/social/weird%20name/next_address", {
      network: "testnet",
    });
  });

  test("wraps a 409 response into KeylessRecipientError", async () => {
    postMock.mockImplementationOnce(async () => {
      const err = new Error("keyless") as Error & { status: number };
      err.status = 409;
      throw err;
    });

    await expect(reserveNextSocialAddress("bob", "testnet")).rejects.toBeInstanceOf(
      KeylessRecipientError,
    );
  });

  test("re-throws a non-409 error unchanged", async () => {
    postMock.mockImplementationOnce(async () => {
      const err = new Error("server exploded") as Error & { status: number };
      err.status = 500;
      throw err;
    });

    await expect(reserveNextSocialAddress("carol", "testnet")).rejects.toThrow(
      "server exploded",
    );
  });
});

describe("enrichAddresses", () => {
  test("posts the batch and returns the data map", async () => {
    // The real linked client's `unwrapResponse` already strips the backend's
    // `{ data: map }` envelope before resolving `client.post(...)`, so the
    // mock must return the NAKED map (the post-unwrap shape), not `{ data }`
    // — otherwise this test can't catch a re-introduced `.data` unwrap.
    const enrichmentMap: Record<string, EnrichmentResult> = {
      TAddr1: { kind: "unknown" },
      TAddr2: { kind: "merchant", displayName: "Shop" },
    };
    postMock.mockImplementationOnce(async () => enrichmentMap);

    const result = await enrichAddresses(["TAddr1", "TAddr2"]);

    expect(postMock).toHaveBeenCalledWith("/v1/enrich", { addresses: ["TAddr1", "TAddr2"] });
    expect(result).toEqual(enrichmentMap);
  });
});

describe("getSocialReceiveCursor", () => {
  test("returns the cursor directly (no {data} double-unwrap) and sends network as a query param", async () => {
    // The real Gateway route sends `{ reservedThrough }` with no `data`
    // envelope, so the mock returns the NAKED shape (the post-unwrap shape)
    // — otherwise this test can't catch a re-introduced `.data` unwrap.
    getMock.mockImplementationOnce(async () => ({ reservedThrough: 7 }));

    const result = await getSocialReceiveCursor("testnet");

    expect(getMock).toHaveBeenCalledWith("/v1/social/me/cursor", {
      params: { network: "testnet" },
    });
    expect(result).toEqual({ reservedThrough: 7 });
  });

  test("returns reservedThrough: 0 for a caller with no reservation cursor yet", async () => {
    getMock.mockImplementationOnce(async () => ({ reservedThrough: 0 }));

    const result = await getSocialReceiveCursor("mainnet");

    expect(result).toEqual({ reservedThrough: 0 });
  });
});
