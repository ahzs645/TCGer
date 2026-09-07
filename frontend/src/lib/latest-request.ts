export type RequestResult<T> =
  | { value: T; error?: never }
  | { value?: never; error: Error };

/** Discards superseded results and errors, including providers without abort support. */
export class LatestRequest {
  private generation = 0;

  cancel(): void {
    this.generation += 1;
  }

  async run<T>(
    operation: () => Promise<T>,
    complete: (result: RequestResult<T>) => void,
  ): Promise<void> {
    const request = ++this.generation;
    let result: RequestResult<T>;
    try {
      result = { value: await operation() };
    } catch (error) {
      result = { error: error instanceof Error ? error : new Error(String(error)) };
    }
    if (request === this.generation) complete(result);
  }
}
