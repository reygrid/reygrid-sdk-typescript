# ReyGrid TypeScript SDK

> Powerful, fully-typed TypeScript client for the [ReyGrid API](https://reygrid.com/api/v1).

[![npm version](https://img.shields.io/badge/npm-reygrid-blue)](https://www.npmjs.com/package/reygrid)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

## Features

- **Full control over base URL** — point at any deployment, proxy, or local instance
- **100% typed** — all API responses, requests, errors, and stream events typed from the OpenAPI spec
- **SSE streaming** — native async generator support for streaming chat responses
- **Tool calling** — define agent tools and submit results
- **Pagination helpers** — `Paginator<T>` with async iterator for easy pagination
- **Conversation management** — list, read, delete conversations and messages
- **Rich error hierarchy** — typed errors per status code
- **Universal** — works in Node.js ≥18, Deno, Bun, and modern browsers (no dependencies)

## Install

```bash
npm install reygrid
```

## Quick Start

```typescript
import { ReyGrid } from "reygrid";

// Create the client — base URL defaults to https://reygrid.com/api/v1
const client = new ReyGrid({
  apiKey: "your-api-key",
});

// Health check
const { status } = await client.ping();
console.log("API status:", status); // 'UP'

// Validate key & check usage
const usage = await client.getUsage();
console.log(`Usage: ${usage.total} / ${usage.quotaLimit}`);
```

### Custom base URL

```typescript
const client = new ReyGrid({
  baseUrl: "https://custom-gateway.example.com/reygrid",
  apiKey: "your-api-key",
});
```

## Chat

### Non-streaming — Assistant Agent

Realistic example: a customer-support assistant that can check the caller's plan and hours.

```typescript
const res = await client.chat("agent-id", "Check my current subscription", {
  userId: "user-42", // persistent conversation per user
  tools: [
    {
      type: "function",
      function: {
        name: "check_subscription",
        instructions:
          "Opens the customer current plan, renewal date, and payment status.",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string", description: "The customer user id" },
          },
          required: ["userId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_support_hours",
        instructions:
          'Returns the agent working hours so the assistant can answer "What are your hours?".',
        parameters: { type: "object", properties: {} },
      },
    },
  ],
});

// The assistant reasons with the tool, then replies:
console.log(res.output.reply.content);
// e.g. "Your current subscription: Pro plan — active until Sep 30, prepaid."
```

> **Tip:** pass a fixed `userId` per user — ReyGrid stores the full conversation
> and returns it automatically on each message, so you do not manage history yourself.

### Streaming (SSE)

```typescript
// Async generator — clean and cancellable.
// Each frame: { delta: { reply: { content } } }
for await (const frame of client.streamChat(
  "agent-id",
  "What are your hours?",
)) {
  process.stdout.write(frame.delta?.reply?.content ?? "");
}
```

### Tool results

After the assistant asks for a tool call, send the result back so it can continue:

```typescript
const res = await client.chat("agent-id", "What is the status of my account?", {
  userId: "user-42",
  tools: [checkSubscriptionTool],
  results: [
    {
      toolCallId: "call_xyz",
      output: JSON.stringify({
        plan: "pro",
        status: "active",
        renewsAt: "2026-09-30",
        paymentMethod: "****4242",
      }),
    },
  ],
});
```

## Conversations & Messages

```typescript
// List conversations with pagination
const page1 = await client.listConversations("agent-id", { page: 1, size: 20 });
console.log(page1.conversations);

// Paginator — async generator over ALL pages
const paginator = client.paginateConversations("agent-id");
for await (const page of paginator.pages()) {
  for (const convo of page.data) {
    console.log(convo.conversationId, convo.messagesCount);
  }
}

// List messages (by conversationId OR userId)
const msgs = await client.listMessages("agent-id", "conversation-uuid", {
  page: 1,
  size: 50,
});

// Delete a conversation
await client.deleteConversation("agent-id", "conversation-uuid");

// Delete a message (with cascade)
await client.deleteMessage("agent-id", "convo-uuid", "msg-uuid", true);
```

## Error Handling

```typescript
import {
  ReyGridError,
  ReyGridApiError,
  ReyGridAuthError,
  ReyGridValidationError,
  ReyGridNotFoundError,
  ReyGridNetworkError,
  ReyGridStreamError,
} from "reygrid";

try {
  await client.validate();
} catch (err) {
  if (err instanceof ReyGridAuthError) {
    console.error("Invalid API key!");
  } else if (err instanceof ReyGridApiError) {
    console.error(`API error: ${err.statusCode} — ${err.message}`);
  } else {
    console.error(err);
  }
}
```

## API Reference

| Endpoint                                            | Method | Function                      |
| --------------------------------------------------- | ------ | ----------------------------- |
| `/ping`                                             | GET    | `client.ping()`               |
| `/validate`                                         | GET    | `client.validate()`           |
| `/agents/{id}/chat`                                 | POST   | `client.chat()`               |
| `/agents/{id}/chat` (stream)                        | POST   | `client.streamChat()`         |
| `/agents/{id}/conversations`                        | GET    | `client.listConversations()`  |
| `/agents/{id}/conversations/{ref}/messages`         | GET    | `client.listMessages()`       |
| `/agents/{id}/conversations/{ref}`                  | DELETE | `client.deleteConversation()` |
| `/agents/{id}/conversations/{ref}/messages/{id}`    | DELETE | `client.deleteMessage()`      |
| `/agents/{id}/conversations/{ref}/tool/cancel/{id}` | POST   | `client.cancelToolCall()`     |

## Development

```bash
cd reygrid-sdk-typescript
npm install
npm run build    # tsc → dist/
npm pack         # create the .tgz for community-node install
```
