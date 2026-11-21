/**
 * Custom error thrown when an operation is superseded by a newer call.
 */
export class StaleOperationError extends Error {
  readonly isStale: boolean = true;
  readonly code: string = 'ERR_STALE_OPERATION';

  constructor(message: string = 'Operation superseded by a newer request') {
    super(message);
    this.name = 'StaleOperationError';
    Object.setPrototypeOf(this, StaleOperationError.prototype);
  }
}

/**
 * Type guard to check if an error is a StaleOperationError or DOM AbortError.
 */
export function isAbortOrStaleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof StaleOperationError) return true;
  if ('isStale' in error && (error as any).isStale === true) return true;
  if ('name' in error && (error as any).name === 'AbortError') return true;
  if ('code' in error && (error as any).code === 'ERR_STALE_OPERATION') return true;
  return false;
}

export interface RaceGuardContext {
  /** The AbortSignal for this specific execution. */
  signal: AbortSignal;
  /** Unique sequential ID of this invocation. */
  id: number;
  /** Returns true if this invocation has already been superseded by a newer call. */
  isStale: () => boolean;
}

export interface RaceGuardOptions<TResult> {
  /**
   * Whether to automatically abort the previous request's AbortController.
   * Default: true
   */
  abortStale?: boolean;

  /**
   * How to handle promises of superseded/stale operations:
   * - 'reject': Rejects the promise with StaleOperationError (Default).
   * - 'silent': Resolves with undefined, preventing unhandled promise rejections.
   * Default: 'reject'
   */
  onStale?: 'reject' | 'silent';

  /**
   * Optional callback fired only when the absolute latest operation succeeds.
   * Perfect for React/Angular state updates without race conditions.
   */
  onSuccess?: (data: TResult, context: { id: number }) => void;

  /**
   * Optional callback fired when the latest operation fails (ignoring stale aborts).
   */
  onError?: (error: unknown, context: { id: number }) => void;
}

export type AsyncFn<TArgs extends any[], TResult> = (
  ...args: [...args: TArgs, context: RaceGuardContext]
) => Promise<TResult>;

/**
 * RaceGuard manages async operations and guarantees that stale calls
 * are aborted and never overwrite newer state.
 */
export class RaceGuard<TArgs extends any[] = any[], TResult = any> {
  private currentId = 0;
  private activeController: AbortController | null = null;
  private options: Required<Pick<RaceGuardOptions<TResult>, 'abortStale' | 'onStale'>> & RaceGuardOptions<TResult>;

  constructor(
    private readonly fn: AsyncFn<TArgs, TResult>,
    options: RaceGuardOptions<TResult> = {}
  ) {
    this.options = {
      abortStale: options.abortStale ?? true,
      onStale: options.onStale ?? 'reject',
      onSuccess: options.onSuccess,
      onError: options.onError,
    };
  }

  /**
   * The ID of the most recent invocation.
   */
  get latestId(): number {
    return this.currentId;
  }

  /**
   * Checks if an invocation ID is still the latest active one.
   */
  isLatest(id: number): boolean {
    return this.currentId === id;
  }

  /**
   * Manually abort any currently running operation.
   */
  cancelCurrent(reason: string = 'Operation manually cancelled'): void {
    if (this.activeController) {
      this.activeController.abort(new StaleOperationError(reason));
      this.activeController = null;
      this.currentId++;
    }
  }

  /**
   * Execute the protected async function.
   */
  async run(...args: TArgs): Promise<TResult | undefined> {
    // 1. Abort any previous pending call if configured
    if (this.options.abortStale && this.activeController) {
      this.activeController.abort(new StaleOperationError('Superseded by newer call'));
    }

    // 2. Increment call token
    const invocationId = ++this.currentId;
    const controller = new AbortController();
    this.activeController = controller;

    const context: RaceGuardContext = {
      signal: controller.signal,
      id: invocationId,
      isStale: () => !this.isLatest(invocationId),
    };

    let result: TResult;
    try {
      // Execute the user's async function
      result = await this.fn(...args, context);
    } catch (error) {
      // Only a call that a newer call (or cancelCurrent) superseded counts as stale.
      // An AbortError from the caller's own signal on the latest call is a real failure.
      if (!this.isLatest(invocationId)) {
        return this.handleStale(invocationId, error);
      }
      this.options.onError?.(error, { id: invocationId });
      throw error;
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }

    // Verify this is still the latest invocation
    if (!this.isLatest(invocationId)) {
      return this.handleStale(invocationId);
    }

    // Outside the try: an error thrown by onSuccess (e.g. a failed state update)
    // reaches the caller as it is, and is not reported as a failed request.
    this.options.onSuccess?.(result, { id: invocationId });
    return result;
  }

  private handleStale(invocationId: number, error?: unknown): undefined {
    if (this.options.onStale === 'silent') {
      return undefined;
    }
    if (error instanceof StaleOperationError) {
      throw error;
    }
    throw new StaleOperationError(`Call #${invocationId} superseded by call #${this.currentId}`);
  }
}

/**
 * Creates a race-condition-protected async function.
 *
 * @example
 * ```ts
 * const safeSearch = createRaceGuard(async (query: string, { signal }) => {
 *   const res = await fetch(`/api/search?q=${query}`, { signal });
 *   return res.json();
 * });
 *
 * // Call it rapidly without fear of race conditions
 * safeSearch('c');
 * safeSearch('cat');
 * const results = await safeSearch('caterpillar'); // Only this resolves!
 * ```
 */
export function createRaceGuard<TArgs extends any[], TResult>(
  fn: AsyncFn<TArgs, TResult>,
  options?: RaceGuardOptions<TResult>
): ((...args: TArgs) => Promise<TResult | undefined>) & {
  cancel: () => void;
  guard: RaceGuard<TArgs, TResult>;
} {
  const guard = new RaceGuard(fn, options);
  const callable = (...args: TArgs) => guard.run(...args);
  callable.cancel = () => guard.cancelCurrent();
  callable.guard = guard;
  return callable;
}

export default createRaceGuard;
