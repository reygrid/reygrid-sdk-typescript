/**
 * Custom error types for ReyGrid API client.
 */

import type { ApiError } from "./types.js";

/**
 * Base error for all ReyGrid API failures.
 */
export class ReyGridError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ReyGridError";
  }
}

/**
 * Thrown when the API returns an error response (4xx / 5xx).
 * Carries the parsed API error payload.
 */
export class ReyGridApiError extends ReyGridError {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ApiError;

  constructor(statusCode: number, body: ApiError | string) {
    const code = typeof body === "string" ? "UNKNOWN" : body.code;
    const message =
      typeof body === "string" ? body : body.message || `HTTP ${statusCode}`;

    super(message);
    this.name = "ReyGridApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = typeof body === "object" ? body : undefined;
  }
}

/**
 * Thrown when authentication fails (401).
 */
export class ReyGridAuthError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(401, body);
    this.name = "ReyGridAuthError";
  }
}

/**
 * Thrown when the request is invalid (400).
 */
export class ReyGridValidationError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(400, body);
    this.name = "ReyGridValidationError";
  }
}

/**
 * Thrown when the requested resource is not found (404).
 */
export class ReyGridNotFoundError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(404, body);
    this.name = "ReyGridNotFoundError";
  }
}

/**
 * Thrown when a tool call cannot be canceled due to state (409).
 */
export class ReyGridConflictError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(409, body);
    this.name = "ReyGridConflictError";
  }
}

/**
 * Thrown when the request isn't allowed (403): plan limit reached, model not
 * on your plan, or an API key restricted to other agents or IP addresses.
 */
export class ReyGridPermissionError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(403, body);
    this.name = "ReyGridPermissionError";
  }
}

/**
 * Thrown when you're rate limited or the key's quota is used up (429).
 */
export class ReyGridRateLimitError extends ReyGridApiError {
  constructor(body: ApiError | string) {
    super(429, body);
    this.name = "ReyGridRateLimitError";
  }
}

/**
 * Thrown on network-level failures (timeout, DNS, connection refused).
 */
export class ReyGridNetworkError extends ReyGridError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ReyGridNetworkError";
  }
}

/**
 * Thrown when SSE parsing encounters a malformed event stream.
 */
export class ReyGridStreamError extends ReyGridError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ReyGridStreamError";
  }
}

/**
 * Map an HTTP status code and parsed body to the correct error type.
 */
export function mapApiError(status: number, body: unknown): ReyGridApiError {
  // Most errors are `{ success: false, error: { code, message } }`; 401s are `{ error, code }`.
  const nested = (body as { error?: unknown })?.error;
  const payload = (
    nested && typeof nested === "object"
      ? nested
      : typeof body === "object" && body
        ? { message: (body as { error?: string }).error, ...body }
        : body
  ) as ApiError | string;

  switch (status) {
    case 401:
      return new ReyGridAuthError(payload);
    case 400:
      return new ReyGridValidationError(payload);
    case 403:
      return new ReyGridPermissionError(payload);
    case 404:
      return new ReyGridNotFoundError(payload);
    case 409:
      return new ReyGridConflictError(payload);
    case 429:
      return new ReyGridRateLimitError(payload);
    default:
      return new ReyGridApiError(status, payload);
  }
}
