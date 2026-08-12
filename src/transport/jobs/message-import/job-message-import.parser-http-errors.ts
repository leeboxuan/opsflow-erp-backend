import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

import { JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE } from "./unconfigured-job-message-parser";

export function mapParserError(e: unknown): never {
  const code = (e as { code?: string })?.code ? String((e as { code?: string }).code) : "";

  if (code === "PARSER_CONFIGURATION") {
    throw new ServiceUnavailableException(JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE);
  }
  if (code === "INPUT_TOO_LARGE") {
    throw new BadRequestException("sourceText is too large");
  }
  if (code === "OPENAI_REFUSAL") {
    throw new BadRequestException("AI refused to parse this job message");
  }
  if (code === "OPENAI_INVALID_OUTPUT") {
    throw new BadRequestException("Malformed provider output");
  }
  if (code === "OPENAI_TIMEOUT" || code === "OPENAI_TOTAL_DEADLINE_EXCEEDED") {
    throw new GatewayTimeoutException("AI provider timed out");
  }
  if (code === "OPENAI_RATE_LIMIT") {
    throw new HttpException("AI provider rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
  }
  if (code === "OPENAI_PROVIDER_UNAVAILABLE") {
    throw new ServiceUnavailableException("AI provider is temporarily unavailable");
  }
  throw new ServiceUnavailableException("AI provider failure");
}
