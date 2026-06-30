import {
  clearSignedUrlCacheForTests,
  createCachedJobDocumentSignedUrl,
  JOB_DOCUMENT_SIGNED_URL_CACHE_MS,
} from "./job-document-signed-url";

describe("createCachedJobDocumentSignedUrl", () => {
  beforeEach(() => {
    clearSignedUrlCacheForTests();
  });

  it("caches signed URLs by storageKey", async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed.example/a" }, error: null });
    const supabase = {
      storage: { from: () => ({ createSignedUrl }) },
    };

    const first = await createCachedJobDocumentSignedUrl(supabase as any, "t1/jobs/a.pdf");
    const second = await createCachedJobDocumentSignedUrl(supabase as any, "t1/jobs/a.pdf");

    expect(first).toBe("https://signed.example/a");
    expect(second).toBe("https://signed.example/a");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("refetches after cache expiry", async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValueOnce({ data: { signedUrl: "https://signed.example/old" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://signed.example/new" }, error: null });
    const supabase = {
      storage: { from: () => ({ createSignedUrl }) },
    };

    const dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(0);
    await createCachedJobDocumentSignedUrl(supabase as any, "key1");

    dateNowSpy.mockReturnValue(JOB_DOCUMENT_SIGNED_URL_CACHE_MS + 1);
    const refreshed = await createCachedJobDocumentSignedUrl(supabase as any, "key1");

    expect(refreshed).toBe("https://signed.example/new");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    dateNowSpy.mockRestore();
  });
});
