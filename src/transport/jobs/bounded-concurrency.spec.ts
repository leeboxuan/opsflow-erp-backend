import { mapWithConcurrency } from "./bounded-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves order and respects the concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("still runs remaining items when one mapper fails", async () => {
    const seen: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});
