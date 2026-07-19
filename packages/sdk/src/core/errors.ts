// The `OxyPayError` hierarchy — every non-2xx Gateway/oxy-api response is
// mapped into one of these, never a bare `Error` or a raw `Response`.

export type OxyPayErrorType =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'permission_error'
  | 'api_error'
  | 'signature_verification_error';

export interface OxyPayErrorDetails {
  /** The HTTP status code that produced this error, when applicable. */
  statusCode?: number;
  /**
   * The raw upstream discriminator: `error.type` from the Gateway's own
   * `{ error: { type, message } }` envelope, or the flat `error` code string
   * from `@oxyhq/core`'s auth middleware (`{ error: 'INVALID_TOKEN', ... }`)
   * — see `errorFromResponse`'s doc comment for why both shapes exist.
   */
  code?: string;
}

export class OxyPayError extends Error {
  readonly type: OxyPayErrorType;
  readonly statusCode?: number;
  readonly code?: string;

  constructor(type: OxyPayErrorType, message: string, details: OxyPayErrorDetails = {}) {
    super(message);
    this.name = 'OxyPayError';
    this.type = type;
    this.statusCode = details.statusCode;
    this.code = details.code;
    Object.setPrototypeOf(this, OxyPayError.prototype);
  }
}

export class OxyPayAuthenticationError extends OxyPayError {
  constructor(message: string, details: OxyPayErrorDetails = {}) {
    super('authentication_error', message, details);
    this.name = 'OxyPayAuthenticationError';
    Object.setPrototypeOf(this, OxyPayAuthenticationError.prototype);
  }
}

export class OxyPayInvalidRequestError extends OxyPayError {
  constructor(message: string, details: OxyPayErrorDetails = {}) {
    super('invalid_request_error', message, details);
    this.name = 'OxyPayInvalidRequestError';
    Object.setPrototypeOf(this, OxyPayInvalidRequestError.prototype);
  }
}

export class OxyPayPermissionError extends OxyPayError {
  constructor(message: string, details: OxyPayErrorDetails = {}) {
    super('permission_error', message, details);
    this.name = 'OxyPayPermissionError';
    Object.setPrototypeOf(this, OxyPayPermissionError.prototype);
  }
}

export class OxyPayApiError extends OxyPayError {
  constructor(message: string, details: OxyPayErrorDetails = {}) {
    super('api_error', message, details);
    this.name = 'OxyPayApiError';
    Object.setPrototypeOf(this, OxyPayApiError.prototype);
  }
}

/** Thrown by `webhooks.constructEvent` on a bad/stale/tampered signature. */
export class OxyPaySignatureVerificationError extends OxyPayError {
  constructor(message: string) {
    super('signature_verification_error', message);
    this.name = 'OxyPaySignatureVerificationError';
    Object.setPrototypeOf(this, OxyPaySignatureVerificationError.prototype);
  }
}

interface NestedGatewayErrorBody {
  error: { type: string; message: string };
}

interface FlatGatewayErrorBody {
  error: string;
  message: string;
  code?: string;
}

function isNestedGatewayErrorBody(body: unknown): body is NestedGatewayErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null) return false;
  const nested = error as { type?: unknown; message?: unknown };
  return typeof nested.type === 'string' && typeof nested.message === 'string';
}

function isFlatGatewayErrorBody(body: unknown): body is FlatGatewayErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const { error } = body as { error: unknown };
  return typeof error === 'string';
}

/**
 * Map an HTTP status + parsed JSON body into a typed `OxyPayError`.
 *
 * The Oxy ecosystem returns TWO distinct error envelopes depending on WHERE a
 * request was rejected:
 * - The Gateway's own route handlers use the Stripe-style nested envelope
 *   `{ error: { type, message } }` (`lib/http.ts`'s `sendError`).
 * - `@oxyhq/core`'s Express auth middleware (`oxyClient.serviceAuth()` /
 *   `requireScope()` — rejecting a missing/expired/insufficiently-scoped
 *   service token BEFORE a route handler ever runs) and oxy-api's own
 *   `ApiError.toJSON()` use a FLAT envelope: `{ error: <CODE_STRING>,
 *   message, code? }`.
 *
 * A caller of this SDK hits the flat shape on every auth failure (expired
 * token, missing scope, bad credentials at mint time), so the HTTP status
 * code — not `error.type` — is the primary classifier here; the raw
 * upstream `type`/`code` string is still attached to the resulting error
 * (`.code`) for callers who want it.
 */
export function errorFromResponse(status: number, body: unknown): OxyPayError {
  let upstreamCode: string | undefined;
  let message = `Oxy Pay request failed with status ${status}`;

  if (isNestedGatewayErrorBody(body)) {
    upstreamCode = body.error.type;
    message = body.error.message;
  } else if (isFlatGatewayErrorBody(body)) {
    upstreamCode = body.error;
    message = body.message || message;
  }

  const details: OxyPayErrorDetails = { statusCode: status, code: upstreamCode };
  if (status === 401) return new OxyPayAuthenticationError(message, details);
  if (status === 403) return new OxyPayPermissionError(message, details);
  if (status >= 400 && status < 500) return new OxyPayInvalidRequestError(message, details);
  return new OxyPayApiError(message, details);
}
