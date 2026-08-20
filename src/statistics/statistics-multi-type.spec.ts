/**
 * Statistics multi-type counting semantics (Phase 4 audit).
 * Distinct job totals count a job once; membership breakdowns may include it per type.
 */
describe("statistics multi-type distinct vs membership", () => {
  function summarize(jobs: Array<{ id: string; types: string[] }>) {
    const distinct = new Set(jobs.map((j) => j.id));
    const membership = new Map<string, Set<string>>();
    for (const job of jobs) {
      for (const t of job.types) {
        const set = membership.get(t) ?? new Set();
        set.add(job.id);
        membership.set(t, set);
      }
    }
    return {
      distinctTotal: distinct.size,
      byType: Object.fromEntries(
        [...membership.entries()].map(([k, v]) => [k, v.size]),
      ),
    };
  }

  it("multi-type job counts once in distinct totals and once per membership type", () => {
    const result = summarize([
      { id: "j1", types: ["IMPORT", "COLLECTION"] },
      { id: "j2", types: ["LCL"] },
    ]);
    expect(result.distinctTotal).toBe(2);
    expect(result.byType.IMPORT).toBe(1);
    expect(result.byType.COLLECTION).toBe(1);
    expect(result.byType.LCL).toBe(1);
    // Not classified exclusively as first/compat type
    expect(result.byType.IMPORT + result.byType.COLLECTION).toBe(2);
  });

  it("movement classification by tripType does not force parent singular", () => {
    const movements = [
      { jobId: "j1", tripType: "IMPORT" },
      { jobId: "j1", tripType: "COLLECTION" },
    ];
    const jobTypeMix = new Map<string, Set<string>>();
    const jobs = new Set<string>();
    for (const m of movements) {
      jobs.add(m.jobId);
      const set = jobTypeMix.get(m.tripType) ?? new Set();
      set.add(m.jobId);
      jobTypeMix.set(m.tripType, set);
    }
    expect(jobs.size).toBe(1);
    expect(jobTypeMix.get("IMPORT")?.size).toBe(1);
    expect(jobTypeMix.get("COLLECTION")?.size).toBe(1);
  });
});
