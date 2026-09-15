/**
 * ReyGrid TypeScript Client — powerful, typed SDK.
 *
 * ```ts
 * import { ReyGrid } from "reygrid";
 *
 * const client = new ReyGrid({
 *   apiKey: "your-key",
 *   baseUrl: "https://custom.example.com/api/v1", // optional override
 * });
 *
 * const reply = await client.chat("agent-1", "Hello!");
 * console.log(reply.output.reply.content);
 * ```
 */

// Client
export { ReyGrid, DEFAULT_BASE_URL } from "./client.js";
export type { ReyGridConfig, RequestContext } from "./client.js";

// Errors
export {
  ReyGridError,
  ReyGridApiError,
  ReyGridAuthError,
  ReyGridValidationError,
  ReyGridNotFoundError,
  ReyGridConflictError,
  ReyGridNetworkError,
  ReyGridStreamError,
} from "./errors.js";

// Pagination
export { Paginator } from "./pagination.js";
export type { PaginatedResult } from "./pagination.js";

// SSE
export { parseSSEStream, consumeStream } from "./sse.js";
export type {
  StreamEventCallback,
  StreamDoneCallback,
  StreamErrorCallback,
} from "./sse.js";

// Types
export * from "./types.js";