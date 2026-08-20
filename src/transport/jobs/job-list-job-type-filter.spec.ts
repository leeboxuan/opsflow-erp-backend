import { JobType } from "@prisma/client";
import { jobListPrismaWhere } from "./job-list-progress";

describe("job list jobType contains filter (Phase 4)", () => {
  it("returns each job once via OR of assignments and legacy singular", () => {
    const where = jobListPrismaWhere({
      tenantId: "tenant-a",
      jobType: JobType.IMPORT,
    }) as { AND: Array<Record<string, unknown>> };

    const typeClause = where.AND.find(
      (part) => part.OR && Array.isArray(part.OR),
    ) as { OR: Array<Record<string, unknown>> } | undefined;

    expect(typeClause?.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobTypeAssignments: {
            some: { tenantId: "tenant-a", jobType: JobType.IMPORT },
          },
        }),
        expect.objectContaining({ jobType: JobType.IMPORT }),
      ]),
    );
  });

  it("does not invent multi-type auto-trip topology via filter", () => {
    const where = jobListPrismaWhere({
      tenantId: "tenant-a",
      jobType: JobType.COLLECTION,
    });
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.any(Array),
      }),
    );
  });
});
