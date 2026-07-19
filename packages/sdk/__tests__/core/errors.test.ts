import { describe, expect, test } from 'bun:test';
import {
  errorFromResponse,
  OxyPayApiError,
  OxyPayAuthenticationError,
  OxyPayError,
  OxyPayInvalidRequestError,
  OxyPayPermissionError,
} from '../../src/core/errors';

describe('errorFromResponse', () => {
  test('maps a nested Gateway envelope (sendError shape) using error.type/message', () => {
    const err = errorFromResponse(422, {
      error: { type: 'invalid_request_error', message: 'amount must be a base-unit integer string' },
    });
    expect(err).toBeInstanceOf(OxyPayInvalidRequestError);
    expect(err).toBeInstanceOf(OxyPayError);
    expect(err.message).toBe('amount must be a base-unit integer string');
    expect(err.type).toBe('invalid_request_error');
    expect(err.code).toBe('invalid_request_error');
    expect(err.statusCode).toBe(422);
  });

  test('401 nested envelope maps to OxyPayAuthenticationError', () => {
    const err = errorFromResponse(401, {
      error: { type: 'authentication_error', message: 'missing service app credentials' },
    });
    expect(err).toBeInstanceOf(OxyPayAuthenticationError);
  });

  test('403 nested envelope maps to OxyPayPermissionError', () => {
    const err = errorFromResponse(403, {
      error: { type: 'permission_error', message: 'invalid client_secret' },
    });
    expect(err).toBeInstanceOf(OxyPayPermissionError);
  });

  test('5xx nested envelope maps to OxyPayApiError', () => {
    const err = errorFromResponse(500, {
      error: { type: 'api_error', message: 'internal error' },
    });
    expect(err).toBeInstanceOf(OxyPayApiError);
  });

  test('502 (webhook-style api_error) maps to OxyPayApiError', () => {
    const err = errorFromResponse(502, {
      error: { type: 'api_error', message: 'failed to resolve recipient — try again' },
    });
    expect(err).toBeInstanceOf(OxyPayApiError);
  });

  // `@oxyhq/core`'s Express auth middleware (serviceAuth()/requireScope())
  // rejects a missing/expired/insufficiently-scoped service token with a
  // FLAT envelope, not the Gateway's own nested `sendError` shape. A caller
  // of this SDK hits this shape on the most common failure — an expired
  // service token — so it must classify correctly by status.
  test('flat envelope (requireScope 403 INSUFFICIENT_SCOPE) maps to OxyPayPermissionError', () => {
    const err = errorFromResponse(403, {
      error: 'INSUFFICIENT_SCOPE',
      message: "Required scope 'payments:write' not granted",
      code: 'INSUFFICIENT_SCOPE',
      status: 403,
    });
    expect(err).toBeInstanceOf(OxyPayPermissionError);
    expect(err.message).toBe("Required scope 'payments:write' not granted");
    expect(err.code).toBe('INSUFFICIENT_SCOPE');
  });

  test('flat envelope (serviceAuth 401 TOKEN_EXPIRED) maps to OxyPayAuthenticationError', () => {
    const err = errorFromResponse(401, {
      error: 'TOKEN_EXPIRED',
      message: 'Service token expired',
      code: 'TOKEN_EXPIRED',
      status: 401,
    });
    expect(err).toBeInstanceOf(OxyPayAuthenticationError);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });

  test('flat envelope (oxy-api ApiError.toJSON) maps to OxyPayInvalidRequestError on 400', () => {
    const err = errorFromResponse(400, {
      error: 'BAD_REQUEST',
      message: 'apiKey and apiSecret are required',
    });
    expect(err).toBeInstanceOf(OxyPayInvalidRequestError);
  });

  test('an unparseable/empty body still maps by status with a generic message', () => {
    const err = errorFromResponse(500, undefined);
    expect(err).toBeInstanceOf(OxyPayApiError);
    expect(err.message).toBe('Oxy Pay request failed with status 500');
    expect(err.code).toBeUndefined();
  });

  test('OxyPayError subclasses are also instanceof Error', () => {
    const err = errorFromResponse(404, { error: { type: 'invalid_request_error', message: 'not found' } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('OxyPayInvalidRequestError');
  });
});
