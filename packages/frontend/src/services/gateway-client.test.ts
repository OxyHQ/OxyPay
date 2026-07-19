import { describe, test, expect, mock, beforeEach } from "bun:test";

const postMock = mock(async (_path: string, _body: unknown): Promise<unknown> => {
  throw new Error("postMock not configured for this test");
});

mock.module("./oxy-services", () => ({
  oxyServices: {
    createLinkedClient: () => ({ client: { post: postMock } }),
  },
}));

const { reserveNextSocialAddress, enrichAddresses, KeylessRecipientError } = await import(
  "./gateway-client"
);

beforeEach(() => {
  postMock.mockReset();
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
    postMock.mockImplementationOnce(async () => ({
      data: {
        TAddr1: { kind: "unknown" },
        TAddr2: { kind: "merchant", displayName: "Shop" },
      },
    }));

    const result = await enrichAddresses(["TAddr1", "TAddr2"]);

    expect(postMock).toHaveBeenCalledWith("/v1/enrich", { addresses: ["TAddr1", "TAddr2"] });
    expect(result.TAddr1).toEqual({ kind: "unknown" });
    expect(result.TAddr2).toEqual({ kind: "merchant", displayName: "Shop" });
  });
});
