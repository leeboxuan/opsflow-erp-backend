import { NotFoundException } from "@nestjs/common";
import {
  buildDocumentSignedUrlResponse,
  clearSignedUrlCacheForTests,
} from "./job-document-signed-url";

describe("job-document-signed-url tenant boundary", () => {
  beforeEach(() => clearSignedUrlCacheForTests());

  it("refuses to sign cross-tenant storage keys", async () => {
    const createSignedUrl = jest.fn();
    const supabase = {
      storage: {
        from: () => ({ createSignedUrl }),
      },
    };
    await expect(
      buildDocumentSignedUrlResponse(
        supabase,
        "other-tenant/jobs/a.pdf",
        "t1",
      ),
    ).rejects.toThrow(NotFoundException);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs tenant-prefixed keys", async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://signed" },
      error: null,
    });
    const supabase = {
      storage: {
        from: () => ({ createSignedUrl }),
      },
    };
    const res = await buildDocumentSignedUrlResponse(
      supabase,
      "t1/jobs/a.pdf",
      "t1",
    );
    expect(res.previewUrl).toBe("https://signed");
    expect(createSignedUrl).toHaveBeenCalled();
  });
});
