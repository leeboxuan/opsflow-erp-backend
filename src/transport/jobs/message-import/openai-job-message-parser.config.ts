export const OPENAI_JOB_IMPORT_ATTEMPT_TIMEOUT_MS_DEFAULT = 60_000;
export const OPENAI_JOB_IMPORT_MAX_RETRIES_DEFAULT = 1;
export const OPENAI_JOB_IMPORT_TOTAL_DEADLINE_MS_DEFAULT = 125_000;

export type OpenAIJobImportParserRuntimeConfig = {
  attemptTimeoutMs: number;
  maxRetries: number;
  totalDeadlineMs: number;
};

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function readOpenAIJobImportParserConfig(
  env: Partial<Pick<NodeJS.ProcessEnv, "OPENAI_JOB_IMPORT_TIMEOUT_MS">> =
    process.env as Partial<Pick<NodeJS.ProcessEnv, "OPENAI_JOB_IMPORT_TIMEOUT_MS">>,
): OpenAIJobImportParserRuntimeConfig {
  return {
    attemptTimeoutMs:
      parsePositiveInt(env.OPENAI_JOB_IMPORT_TIMEOUT_MS) ??
      OPENAI_JOB_IMPORT_ATTEMPT_TIMEOUT_MS_DEFAULT,
    maxRetries: OPENAI_JOB_IMPORT_MAX_RETRIES_DEFAULT,
    totalDeadlineMs: OPENAI_JOB_IMPORT_TOTAL_DEADLINE_MS_DEFAULT,
  };
}
