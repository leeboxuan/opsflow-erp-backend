import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

import { mapParserError } from "./job-message-import.parser-http-errors";

function expectHttpError(code: string, Expected: new (...args: any[]) => object, status: number) {
  try {
    mapParserError({ code, message: "test" });
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(Expected);
    expect((e as { getStatus: () => number }).getStatus()).toBe(status);
  }
}

describe("mapParserError", () => {
  it("maps parser timeout to 504 Gateway Timeout", () => {
    expectHttpError("OPENAI_TIMEOUT", GatewayTimeoutException, 504);
    expectHttpError("OPENAI_TOTAL_DEADLINE_EXCEEDED", GatewayTimeoutException, 504);
  });

  it("maps provider unavailable/network failures to 503", () => {
    expectHttpError("OPENAI_PROVIDER_UNAVAILABLE", ServiceUnavailableException, 503);
    expectHttpError("OPENAI_PROVIDER_FAILURE", ServiceUnavailableException, 503);
    expectHttpError("PARSER_CONFIGURATION", ServiceUnavailableException, 503);
  });

  it("maps rate limits to 429", () => {
    expectHttpError("OPENAI_RATE_LIMIT", HttpException, HttpStatus.TOO_MANY_REQUESTS);
  });

  it("maps invalid input/output to 400", () => {
    expectHttpError("INPUT_TOO_LARGE", BadRequestException, 400);
    expectHttpError("OPENAI_INVALID_OUTPUT", BadRequestException, 400);
    expectHttpError("OPENAI_REFUSAL", BadRequestException, 400);
  });
});
