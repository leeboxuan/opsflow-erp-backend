import {
  CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
  CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
} from "../create-job-interactive-tx";

export const JOB_MESSAGE_PARSER_TOKEN = Symbol("JOB_MESSAGE_PARSER_TOKEN");

export const JOB_MESSAGE_IMPORT_MAX_INPUT_CHARS = 20_000;

export const JOB_MESSAGE_IMPORT_SOURCE_CHANNEL = "WHATSAPP" as const;

/** Parser version returned by the deterministic test fixture parser. */
export const FAKE_JOB_MESSAGE_PARSER_VERSION = "fake.fixture.v1";

/** Interactive-transaction bounds for confirm (DB writes only). Same as canonical job create. */
export const JOB_MESSAGE_IMPORT_CONFIRM_TX_MAX_WAIT_MS =
  CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS;
export const JOB_MESSAGE_IMPORT_CONFIRM_TX_TIMEOUT_MS =
  CANONICAL_JOB_CREATE_TX_TIMEOUT_MS;

/** Post-commit finalize: independent Jobs, bounded — not unbounded Promise.all. */
export const JOB_MESSAGE_IMPORT_FINALIZE_CONCURRENCY = 3;

