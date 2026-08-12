import { FakeJobMessageParser } from "./fake-job-message-parser";
import {
  JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE,
  JobMessageParserConfigurationError,
  createJobMessageParser,
} from "./job-message-parser.factory";
import { OpenAIJobMessageParser } from "./openai-job-message-parser";
import { UnconfiguredJobMessageParser } from "./unconfigured-job-message-parser";

describe("createJobMessageParser", () => {
  it("uses OpenAI in production when OPENAI_API_KEY is set", () => {
    const parser = createJobMessageParser({
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
      OPENAI_JOB_IMPORT_MODEL: "gpt-4.1-mini",
    });
    expect(parser).toBeInstanceOf(OpenAIJobMessageParser);
    expect(parser.getParserVersion()).toBe("opsflow.job_message_parser.v1");
    expect(parser.getModelName()).toBe("gpt-4.1-mini");
  });

  it("boots with an unconfigured parser in production when OPENAI_API_KEY is missing", () => {
    const parser = createJobMessageParser({
      NODE_ENV: "production",
      OPENAI_API_KEY: "",
    });
    expect(parser).toBeInstanceOf(UnconfiguredJobMessageParser);
    expect(parser.getParserVersion()).toBe("opsflow.job_message_parser.unconfigured");
    expect(parser.getModelName()).toBeNull();
  });

  it("does not allow the fixture parser in production even when explicitly requested", () => {
    const parser = createJobMessageParser({
      NODE_ENV: "production",
      JOB_MESSAGE_IMPORT_PARSER: "FAKE",
      OPENAI_API_KEY: "sk-test",
    });
    expect(parser).toBeInstanceOf(UnconfiguredJobMessageParser);
  });

  it("returns an unconfigured parser outside tests when OPENAI_API_KEY is missing", () => {
    expect(
      createJobMessageParser({
        NODE_ENV: "development",
        OPENAI_API_KEY: undefined,
      }),
    ).toBeInstanceOf(UnconfiguredJobMessageParser);
  });

  it("fails preview requests safely when OpenAI is not configured", async () => {
    const parser = createJobMessageParser({
      NODE_ENV: "production",
      OPENAI_API_KEY: undefined,
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "hello",
      }),
    ).rejects.toMatchObject({
      code: "PARSER_CONFIGURATION",
      message: JOB_MESSAGE_IMPORT_UNAVAILABLE_MESSAGE,
    });
    await expect(
      parser.parse({
        tenantId: "t1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP",
        sourceText: "hello",
      }),
    ).rejects.toBeInstanceOf(JobMessageParserConfigurationError);
  });

  it("allows the fixture parser only when explicitly enabled outside production", () => {
    const parser = createJobMessageParser({
      NODE_ENV: "development",
      JOB_MESSAGE_IMPORT_PARSER: "FAKE",
    });
    expect(parser).toBeInstanceOf(FakeJobMessageParser);
    expect(parser.getParserVersion()).toBe("fake.fixture.v1");
    expect(parser.getModelName()).toBeNull();
  });

  it("defaults to the fixture parser in test when no API key is configured", () => {
    const parser = createJobMessageParser({
      NODE_ENV: "test",
      OPENAI_API_KEY: undefined,
    });
    expect(parser).toBeInstanceOf(FakeJobMessageParser);
  });
});
