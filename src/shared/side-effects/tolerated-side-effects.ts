import { Logger } from "@nestjs/common";

const logger = new Logger("ToleratedSideEffect");

/** Run a post-commit side effect; failures are logged and never roll back committed work. */
export async function runToleratedSideEffect(
  label: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn(
      `${label} failed after commit; committed operation result is unchanged`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
