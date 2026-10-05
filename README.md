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
- **Knowledge management** — add text, Q&A, files and websites; list and delete sources
- **Search** — retrieve the closest knowledge passages without generating an answer
- **Agents, models & usage** — list and update agents, see models and your usage report
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

## Agents

```typescript
const { agents } = await client.listAgents();

const { agent } = await client.getAgent("agent-id");
console.log(agent.sources, agent.storage); // { text, qa, file, website }, { used, limit }

await client.updateAgent("agent-id", { instructions: "Answer in a friendly tone." });
```

## Knowledge

```typescript
import { openAsBlob } from "node:fs";

await client.addTextSource("agent-id", {
  title: "Refund policy",
  content: "Orders can be refunded within 30 days of delivery.",
});

await client.addQaSource("agent-id", {
  question: "Do you ship abroad?",
  answer: "Yes, to 40 countries. Delivery takes 5 to 10 days.",
});

// PDF, DOC, DOCX or TXT, up to 30 MB
await client.uploadFile("agent-id", await openAsBlob("handbook.pdf"), "handbook.pdf");

// Crawls pages on the same domain; returns when done
const { pagesCrawled } = await client.crawlWebsite("agent-id", "https://docs.example.com");

// List (filter by type / search) and delete
const { sources } = await client.listSources("agent-id", { type: "text", search: "refund" });
await client.deleteSource("agent-id", sources[0].id);

// Every source, page by page
const all = await client.paginateSources("agent-id", { type: "file" }).all();
```

## Search

Retrieval only: the closest passages from the agent's knowledge, no model call and no credits.

```typescript
const { results } = await client.search("agent-id", "How do I get a refund?", { limit: 3 });
for (const r of results) console.log(r.score, r.source.title, r.content);
```

## Feedback

```typescript
await client.rateMessage("agent-id", "conversation-id", "msg_abc123", {
  rating: "down",
  comment: "The shipping times are out of date",
});
```

## Models & usage

```typescript
const { models } = await client.listModels(); // { id, name, provider, pricing, available }

const report = await client.getUsageReport({ days: 7 });
console.log(report.balance.credits, report.totals.requests, report.daily);
```

## Error Handling

```typescript
import {
  ReyGridError,
  ReyGridApiError,
  ReyGridAuthError,
  ReyGridValidationError,
  ReyGridNotFoundError,
  ReyGridPermissionError,
  ReyGridRateLimitError,
  ReyGridNetworkError,
  ReyGridStreamError,
} from "reygrid";

try {
  await client.validate();
} catch (err) {
  if (err instanceof ReyGridAuthError) {
    console.error("Invalid API key!");
  } else if (err instanceof ReyGridPermissionError) {
    console.error("Not allowed:", err.code); // e.g. PLAN_LIMIT_REACHED, AGENT_NOT_ALLOWED
  } else if (err instanceof ReyGridApiError) {
    console.error(`API error: ${err.statusCode} ${err.code} — ${err.message}`);
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
| `/agents/{id}/conversations/{ref}/messages/{id}/feedback` | POST | `client.rateMessage()` |
| `/agents`                                           | GET    | `client.listAgents()`         |
| `/agents/{id}`                                      | GET    | `client.getAgent()`           |
| `/agents/{id}`                                      | PATCH  | `client.updateAgent()`        |
| `/agents/{id}/sources`                              | GET    | `client.listSources()` / `paginateSources()` |
| `/agents/{id}/sources/text`                         | POST   | `client.addTextSource()`      |
| `/agents/{id}/sources/qa`                           | POST   | `client.addQaSource()`        |
| `/agents/{id}/sources/files`                        | POST   | `client.uploadFile()`         |
| `/agents/{id}/sources/website`                      | POST   | `client.crawlWebsite()`       |
| `/agents/{id}/sources/{sourceId}`                   | DELETE | `client.deleteSource()`       |
| `/agents/{id}/search`                               | POST   | `client.search()`             |
| `/models`                                           | GET    | `client.listModels()`         |
| `/usage`                                            | GET    | `client.getUsageReport()`     |

## Development

```bash
cd reygrid-sdk-typescript
npm install
npm run build    # tsc → dist/
npm pack         # create the .tgz for community-node install
```
