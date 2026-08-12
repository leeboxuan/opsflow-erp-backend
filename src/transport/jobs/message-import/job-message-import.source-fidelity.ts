import { BadRequestException } from "@nestjs/common";

import type { JobMessageImportParsedDraft } from "./job-message-parser";

/** Collapse whitespace for substring checks without altering semantic content. */
export function normalizeSourceTextForTraceability(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Every draft sourceFragment must be traceable to the submitted sourceText.
 * Rejects fixture/hallucinated fragments that are absent from the request.
 */
export function assertSourceFragmentsTraceable(
  sourceText: string,
  drafts: ReadonlyArray<Pick<JobMessageImportParsedDraft, "sourceFragment">>,
): void {
  const normalizedSource = normalizeSourceTextForTraceability(sourceText);
  if (!normalizedSource) {
    throw new BadRequestException("sourceText is required");
  }

  for (const draft of drafts) {
    const fragment = draft.sourceFragment?.trim();
    if (!fragment) {
      throw new BadRequestException("Malformed provider output: empty sourceFragment");
    }
    const normalizedFragment = normalizeSourceTextForTraceability(fragment);
    if (!normalizedSource.includes(normalizedFragment)) {
      throw new BadRequestException(
        "Parser output is not traceable to the submitted source text",
      );
    }
  }
}

import { FAKE_JOB_MESSAGE_PARSER_VERSION } from "./job-message-import.constants";