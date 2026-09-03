export type JobMessageImportParsedLocation = {
  rawText: string | null;
};

export type JobMessageImportFieldEvidence = {
  field: string;
  sourceText: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type JobMessageImportParseWarning = {
  code: string;
  field: string | null;
  message: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
};

export type JobMessageImportParsedJobItem = {
  containerNumber: string | null;
  sealNumber: string | null;
  referenceNumber: string | null;
  quantity: number | null;
};

export type JobMessageImportParsedDraft = {
  clientDraftId: string;
  movementType: "COLLECTION" | "IMPORT" | "EXPORT" | "LCL" | "RETURN" | "ONE_WAY" | "UNKNOWN";

  customerNameText: string | null;

  earliestAt: string | null;
  latestAt: string | null;
  timingText: string | null;

  pickup: JobMessageImportParsedLocation;
  delivery: JobMessageImportParsedLocation;

  carrier: string | null;
  shipper: string | null;
  vessel: string | null;
  voyage: string | null;

  containerSizeType: string | null;
  items: JobMessageImportParsedJobItem[];

  picName: string | null;
  picPhone: string | null;
  instructions: string[];
  notes: string | null;

  sourceFragment: string;
  fieldEvidence: JobMessageImportFieldEvidence[];
  warnings: JobMessageImportParseWarning[];
};

export type JobMessageImportParsedJobMessage = {
  parserVersion: string;
  drafts: JobMessageImportParsedDraft[];
  batchWarnings: JobMessageImportParseWarning[];
};

export type ParseJobMessageInput = {
  tenantId: string;
  timezone: string;
  sourceChannel: "WHATSAPP";
  sourceText: string;
  correlationId?: string | null;
  /** Fake parser only. Never sent to OpenAI. */
  testFixtureId?: string | null;
};

export type JobMessageParseMeta = {
  modelName: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  providerRequestId: string | null;
};

export type ParseJobMessageResult = {
  message: JobMessageImportParsedJobMessage;
  meta: JobMessageParseMeta;
};

export interface JobMessageParser {
  parse(input: ParseJobMessageInput): Promise<ParseJobMessageResult>;
  /**
   * Parser identity for audit/fingerprints.
   * Must not include secrets.
   */
  getParserVersion(): string;
  getModelName(): string | null;
}

