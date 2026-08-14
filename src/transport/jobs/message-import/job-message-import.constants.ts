export const JOB_MESSAGE_PARSER_TOKEN = Symbol("JOB_MESSAGE_PARSER_TOKEN");

export const JOB_MESSAGE_IMPORT_MAX_INPUT_CHARS = 20_000;

export const JOB_MESSAGE_IMPORT_SOURCE_CHANNEL = "WHATSAPP" as const;

/** Parser version returned by the deterministic test fixture parser. */
export const FAKE_JOB_MESSAGE_PARSER_VERSION = "fake.fixture.v1";

/** Interactive-transaction bounds for confirm (DB writes only). */
export const JOB_MESSAGE_IMPORT_CONFIRM_TX_MAX_WAIT_MS = 10_000;
export const JOB_MESSAGE_IMPORT_CONFIRM_TX_TIMEOUT_MS = 20_000;

/** Post-commit finalize: independent Jobs, bounded — not unbounded Promise.all. */
export const JOB_MESSAGE_IMPORT_FINALIZE_CONCURRENCY = 3;

