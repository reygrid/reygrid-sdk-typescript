import type { Pagination } from "./types.js";

/**
 * Return type for paginated endpoints that includes
 * the raw fetched data alongside pagination metadata.
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

/**
 * Async generator that automatically pages through a paginated endpoint.
 *
 * @example
 * ```ts
 * const conversations = reygrid.conversations.list(agentId);
 * for await (const page of conversations.pages()) {
 *   for (const c of page.data) {
 *     console.log(c.conversationId);
 *   }
 * }
 * ```
 */
export class Paginator<T> {
  private page = 1;
  private done = false;
  private readonly size: number;

  constructor(
    private readonly fetcher: (page: number, size: number) => Promise<PaginatedResult<T>>,
    size = 20,
  ) {
    this.size = Math.min(Math.max(1, size), 100);
  }

  /** Reset the paginator back to the first page. */
  reset(): void {
    this.page = 1;
    this.done = false;
  }

  /** Fetch the next page.  Returns `null` when exhausted. */
  async next(): Promise<PaginatedResult<T> | null> {
    if (this.done) return null;
    const result = await this.fetcher(this.page, this.size);
    if (!result.pagination.hasNextPage) this.done = true;
    this.page++;
    return result;
  }

  /** Iterate over all pages sequentially. */
  async *pages(): AsyncGenerator<PaginatedResult<T>> {
    this.reset();
    while (true) {
      const result = await this.next();
      if (!result) break;
      yield result;
    }
  }

  /** Collect ALL items from every page into a single array.  Use with caution on large datasets. */
  async all(): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.pages()) {
      all.push(...page.data);
    }
    return all;
  }
}