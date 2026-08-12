import { FakeJobMessageParser } from "./fake-job-message-parser";
import type { JobMessageParser } from "./job-message-parser";
import { OpenAIJobMessageParser } from "./openai-job-message-parser";
import {
  JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE,
  UnconfiguredJobMessageParser,
} from "./unconfigured-job-message-parser";

export type JobMessageParserEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "NODE_ENV" | "JOB_MESSAGE_IMPORT_PARSER" | "OPENAI_API_KEY" | "OPENAI_JOB_IMPORT_MODEL"
  >
>;

export { JobMessageParserConfigurationError, JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE } from "./unconfigured-job-message-parser";

/**
 * Selects the job message import parser from environment.
 *
 * Never throws during module bootstrap: a missing key keeps the ERP online and
 * preview requests fail later with PARSER_CONFIGURATION.
 */
export function createJobMessageParser(
  env: JobMessageParserEnv = process.env as JobMessageParserEnv,
): JobMessageParser {
  const nodeEnv = (env.NODE_ENV ?? "development").trim().toLowerCase();
  const parserMode = env.JOB_MESSAGE_IMPORT_PARSER?.trim().toUpperCase();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_JOB_IMPORT_MODEL?.trim() || "gpt-4.1-mini";

  if (parserMode === "FAKE") {
    if (nodeEnv === "production") {
      return new UnconfiguredJobMessageParser();
    }
    return new FakeJobMessageParser();
  }

  if (nodeEnv === "test" && !apiKey) {
    return new FakeJobMessageParser();
  }

  if (!apiKey) {
    return new UnconfiguredJobMessageParser();
  }

  return new OpenAIJobMessageParser({ apiKey, model });
}
