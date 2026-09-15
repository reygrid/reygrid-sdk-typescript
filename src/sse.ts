/**
 * Lightweight SSE (Server-Sent Events) stream parser.
 *
 * ReyGrid's streaming API emits data-only messages using the `data:` field
 * with no explicit event field.  Each `data:` line carries a JSON-encoded
 * delta event; an empty `data:` signals the end of the stream.
 */

import { ReyGridStreamError } from "./errors.js";
import type { ChatDeltaEvent } from "./types.js";

export type StreamEventCallback = (event: ChatDeltaEvent) => void;
export type StreamDoneCallback = () => void;
export type StreamErrorCallback = (error: Error) => void;

/**
 * Parse an SSE text stream and yield parsed delta events.
 *
 * Conforms to the spec: data-only SSE messages, each `data:` line is a
 * JSON object.  Multiple `data:` lines in one message are joined by '\n'.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<ChatDeltaEvent> {
  if (!body) throw new ReyGridStreamError("Response body is null — stream not available");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = extractEvents(buffer);
      buffer = events.remainder;

      for (const raw of events.complete) {
        if (raw.trim() === "") continue; // end-of-stream marker
        try {
          const parsed: ChatDeltaEvent = JSON.parse(raw);
          yield parsed;
        } catch (e) {
          throw new ReyGridStreamError(
            `Failed to parse SSE data frame: ${raw.slice(0, 120)}`,
            e,
          );
        }
      }
    }

    // Process any remaining data in the buffer
    const remaining = buffer.trim();
    if (remaining) {
      try {
        const parsed: ChatDeltaEvent = JSON.parse(remaining);
        yield parsed;
      } catch {
        // Silently ignore trailing garbage
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Internal: split raw SSE text into complete `data:` frames. */
function extractEvents(
  chunk: string,
): { complete: string[]; remainder: string } {
  const lines = chunk.split("\n");
  const complete: string[] = [];
  let current: string[] = [];
  let remainder = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    } else if (line === "" && current.length > 0) {
      // Empty line = end of an SSE message
      complete.push(current.join("\n"));
      current = [];
    } else if (line.startsWith(":")) {
      // Comment line — ignore
      continue;
    }
    // Other lines (event:, id:, retry:) — we don't use them but preserve data
  }

  if (current.length > 0) {
    remainder = current.join("\n");
  }

  return { complete, remainder };
}

// ---------------------------------------------------------------------------
// Convenience wrapper: use with a callback
// ---------------------------------------------------------------------------

export function consumeStream(
  stream: AsyncIterable<ChatDeltaEvent>,
  onEvent: StreamEventCallback,
  onDone?: StreamDoneCallback,
  onError?: StreamErrorCallback,
): () => void {
  let cancelled = false;

  (async () => {
    try {
      for await (const event of stream) {
        if (cancelled) break;
        onEvent(event);
      }
      if (!cancelled) onDone?.();
    } catch (e) {
      if (!cancelled) onError?.(e instanceof Error ? e : new ReyGridStreamError(String(e)));
    }
  })();

  return () => {
    cancelled = true;
  };
}