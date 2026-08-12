import type {
  JobMessageParser,
  ParseJobMessageInput,
  ParseJobMessageResult,
} from "./job-message-parser";

export class JobMessageParserConfigurationError extends Error {
  readonly code = "PARSER_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "JobMessageParserConfigurationError";
  }
}

export const JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE =
  "Job message import is temporarily unavailable";

/** Placeholder parser used when OpenAI is not configured. Keeps the API bootable. */
export class UnconfiguredJobMessageParser implements JobMessageParser {
  constructor(private readonly safeMessage: string = JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE) {}

  getParserVersion(): string {
    return "opsflow.job_message_parser.unconfigured";
  }

  getModelName(): string | null {
    return null;
  }

  async parse(_input: ParseJobMessageInput): Promise<ParseJobMessageResult> {
    throw new JobMessageParserConfigurationError(this.safeMessage);
  }
}
