import {
  buildDocumentFileDisplayFields,
  deriveSafeFileNameFromStorageKey,
  documentMimeTypeOrNull,
} from "./document-file-display";

describe("document-file-display", () => {
  it("deriveSafeFileNameFromStorageKey uses last path segment and sanitizes", () => {
    expect(deriveSafeFileNameFromStorageKey("t1/jobs/j1/trips/tr1/pod_photo/1700000-my%20file.pdf")).toBe(
      "1700000-my_20file.pdf",
    );
  });

  it("deriveSafeFileNameFromStorageKey falls back to file", () => {
    expect(deriveSafeFileNameFromStorageKey("///")).toBe("file");
  });

  it("buildDocumentFileDisplayFields prefers stored originalName", () => {
    expect(
      buildDocumentFileDisplayFields({
        originalName: "delivery-do.pdf",
        sizeBytes: 123,
        storageKey: "t1/jobs/j1/trips/tr1/delivery-do/1700000-WF-IMP.pdf",
      }),
    ).toEqual({
      fileName: "delivery-do.pdf",
      originalFileName: "delivery-do.pdf",
      fileSizeBytes: 123,
    });
  });

  it("buildDocumentFileDisplayFields derives fileName when originalName missing", () => {
    expect(
      buildDocumentFileDisplayFields({
        originalName: "",
        sizeBytes: null,
        storageKey: "t1/jobs/j1/trips/tr1/other/1700000-scan.png",
      }),
    ).toEqual({
      fileName: "1700000-scan.png",
      originalFileName: null,
      fileSizeBytes: null,
    });
  });

  it("documentMimeTypeOrNull trims and nulls empty", () => {
    expect(documentMimeTypeOrNull(" application/pdf ")).toBe("application/pdf");
    expect(documentMimeTypeOrNull("  ")).toBeNull();
    expect(documentMimeTypeOrNull(null)).toBeNull();
  });
});
