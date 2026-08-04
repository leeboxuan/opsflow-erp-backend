import { NotFoundException } from "@nestjs/common";
import {
  assertStorageKeyBelongsToTenant,
  storageKeyBelongsToTenant,
} from "./tenant-storage-key";

describe("tenant-storage-key", () => {
  it("accepts tenant-prefixed keys", () => {
    expect(assertStorageKeyBelongsToTenant("t1/jobs/a.pdf", "t1")).toBe(
      "t1/jobs/a.pdf",
    );
  });

  it("rejects cross-tenant and arbitrary paths neutrally", () => {
    expect(() =>
      assertStorageKeyBelongsToTenant("t2/jobs/a.pdf", "t1"),
    ).toThrow(NotFoundException);
    expect(() =>
      assertStorageKeyBelongsToTenant("../etc/passwd", "t1"),
    ).toThrow(NotFoundException);
    expect(() => assertStorageKeyBelongsToTenant("/abs", "t1")).toThrow(
      NotFoundException,
    );
    expect(() => assertStorageKeyBelongsToTenant("", "t1")).toThrow(
      NotFoundException,
    );
  });

  it("storageKeyBelongsToTenant mirrors assert", () => {
    expect(storageKeyBelongsToTenant("t1/x", "t1")).toBe(true);
    expect(storageKeyBelongsToTenant("t2/x", "t1")).toBe(false);
  });
});
