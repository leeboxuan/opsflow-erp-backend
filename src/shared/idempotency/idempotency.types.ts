export type IdempotentOutcome = "created" | "replayed";

export type IdempotentExecuteResult<T> = {
  result: T;
  outcome: IdempotentOutcome;
};
