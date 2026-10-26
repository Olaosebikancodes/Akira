/** Thrown by background jobs when their signal is aborted. */
export class JobCancelledError extends Error {
  override name = "JobCancelledError";
}

export function throwIfCancelled(signal: AbortSignal | undefined, message = "The job was cancelled."): void {
  if (signal?.aborted) throw new JobCancelledError(message);
}
