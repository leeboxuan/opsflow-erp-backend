import {
  resolveDocumentUploadedByFields,
  resolveUserDisplayName,
} from "./document-uploader.utils";

describe("document-uploader.utils", () => {
  it("prefers joined user name over snapshot", () => {
    const fields = resolveDocumentUploadedByFields({
      uploadedByUserId: "u1",
      uploadedByNameSnapshot: "Old Snapshot",
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
      uploadedBy: { name: "Ops Admin", displayName: null, email: "ops@example.com" },
    });
    expect(fields.uploadedByName).toBe("Ops Admin");
    expect(fields.uploadedByEmail).toBe("ops@example.com");
  });

  it("falls back to email when name missing", () => {
    const fields = resolveDocumentUploadedByFields({
      uploadedByUserId: "u1",
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
      uploadedBy: { name: null, displayName: null, email: "driver@example.com" },
    });
    expect(fields.uploadedByName).toBe("driver@example.com");
    expect(fields.uploadedByEmail).toBe("driver@example.com");
  });

  it("uses System for generated documents without uploader", () => {
    const fields = resolveDocumentUploadedByFields({
      uploadedByUserId: null,
      uploadedByNameSnapshot: "System",
      generatedBySystem: true,
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
    });
    expect(fields.uploadedByName).toBe("System");
    expect(fields.uploadedByUserId).toBeNull();
  });

  it("uses snapshot when user join is absent", () => {
    const fields = resolveDocumentUploadedByFields({
      uploadedByUserId: "u1",
      uploadedByNameSnapshot: "Driver A",
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
    });
    expect(fields.uploadedByName).toBe("Driver A");
  });

  it("resolveUserDisplayName prefers displayName after name", () => {
    expect(
      resolveUserDisplayName({
        name: "Legal Name",
        displayName: "Display",
        email: "x@y.com",
      }),
    ).toBe("Legal Name");
    expect(
      resolveUserDisplayName({
        name: null,
        displayName: "Display",
        email: "x@y.com",
      }),
    ).toBe("Display");
  });
});
