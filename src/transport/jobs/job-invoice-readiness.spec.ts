import { TripStatus } from "@prisma/client";
import { evaluateJobInvoiceReadiness } from "./job-invoice-readiness";

describe("evaluateJobInvoiceReadiness", () => {
  it("returns ready for completed/done non-cancelled trips", () => {
    const result = evaluateJobInvoiceReadiness([
      { id: "t1", status: TripStatus.COMPLETED },
      { id: "t2", status: TripStatus.DONE },
      { id: "t3", status: TripStatus.CANCELLED },
    ]);
    expect(result.readyForInvoice).toBe(true);
    expect(result.billableTripCount).toBe(2);
    expect(result.blockingTrips).toEqual([]);
  });

  it("returns not ready for all-cancelled trips", () => {
    const result = evaluateJobInvoiceReadiness([
      { id: "t1", status: TripStatus.CANCELLED },
      { id: "t2", status: TripStatus.CANCELLED },
    ]);
    expect(result.readyForInvoice).toBe(false);
    expect(result.billableTripCount).toBe(0);
    expect(result.reason).toBe("No completed trips available for invoicing.");
  });

  it.each([TripStatus.DRAFT, TripStatus.PUBLISHED, TripStatus.ONGOING])(
    "returns blocking trip when non-cancelled trip status is %s",
    (status) => {
      const result = evaluateJobInvoiceReadiness([
        { id: "t1", status: TripStatus.COMPLETED },
        { id: "t2", status },
        { id: "t3", status: TripStatus.CANCELLED },
      ]);
      expect(result.readyForInvoice).toBe(false);
      expect(result.blockingTrips).toEqual([{ id: "t2", status }]);
    },
  );
});
