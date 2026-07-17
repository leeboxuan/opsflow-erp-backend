import {
  compareTripsByEffectiveSchedule,
  evaluateTripStartDateGate,
  tripStartDateGateErrorMessage,
} from "./driver-trip-schedule.helpers";

describe("driver-trip-schedule.helpers", () => {
  const tz = "Asia/Singapore";

  describe("compareTripsByEffectiveSchedule", () => {
    it("orders by plannedStartAt ascending regardless of creation order", () => {
      const laterCreatedEarlierPickup = {
        id: "a",
        plannedStartAt: new Date("2026-07-17T06:00:00.000Z"), // 14:00 SGT
        createdAt: new Date("2026-07-16T12:00:00.000Z"),
      };
      const earlierCreatedLaterPickup = {
        id: "b",
        plannedStartAt: new Date("2026-07-17T07:00:00.000Z"), // 15:00 SGT
        createdAt: new Date("2026-07-16T10:00:00.000Z"),
      };
      const rows = [earlierCreatedLaterPickup, laterCreatedEarlierPickup].sort(
        compareTripsByEffectiveSchedule,
      );
      expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("falls back to job.pickupDate when plannedStartAt is null", () => {
      const withPickup = {
        id: "p",
        plannedStartAt: null,
        jobPickupDate: new Date("2026-07-17T02:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      };
      const withPlanned = {
        id: "t",
        plannedStartAt: new Date("2026-07-17T01:00:00.000Z"),
        jobPickupDate: null,
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      };
      const rows = [withPickup, withPlanned].sort(compareTripsByEffectiveSchedule);
      expect(rows.map((r) => r.id)).toEqual(["t", "p"]);
    });

    it("places unscheduled entries last", () => {
      const unscheduled = {
        id: "u",
        plannedStartAt: null,
        jobPickupDate: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      };
      const scheduled = {
        id: "s",
        plannedStartAt: new Date("2026-07-17T08:00:00.000Z"),
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      };
      const rows = [unscheduled, scheduled].sort(compareTripsByEffectiveSchedule);
      expect(rows.map((r) => r.id)).toEqual(["s", "u"]);
    });
  });

  describe("evaluateTripStartDateGate", () => {
    it("allows start on the scheduled Singapore calendar day", () => {
      // 17 July 2026 10:00 SGT = 2026-07-17T02:00:00.000Z
      const result = evaluateTripStartDateGate({
        plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
        now: new Date("2026-07-17T08:00:00.000Z"), // still 17 Jul SGT
        timeZone: tz,
      });
      expect(result).toEqual({ allowed: true });
    });

    it("blocks start before the scheduled day", () => {
      const result = evaluateTripStartDateGate({
        plannedStartAt: new Date("2026-07-18T02:00:00.000Z"),
        now: new Date("2026-07-17T08:00:00.000Z"),
        timeZone: tz,
      });
      expect(result.allowed).toBe(false);
      if (result.allowed === false) {
        expect(result.reason).toBe("too_early");
        expect(tripStartDateGateErrorMessage(result)).toContain(
          "cannot be started yet",
        );
      }
    });

    it("blocks start after the scheduled day", () => {
      const result = evaluateTripStartDateGate({
        plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
        now: new Date("2026-07-18T02:00:00.000Z"),
        timeZone: tz,
      });
      expect(result.allowed).toBe(false);
      if (result.allowed === false) {
        expect(result.reason).toBe("too_late");
        expect(tripStartDateGateErrorMessage(result)).toBe(
          "This trip was scheduled for 17 July 2026 and can no longer be started.",
        );
      }
    });

    it("uses Singapore calendar day around UTC midnight boundary", () => {
      // 16 July 2026 23:30 SGT = 2026-07-16T15:30:00.000Z — still 16 Jul locally
      const beforeMidnight = evaluateTripStartDateGate({
        plannedStartAt: new Date("2026-07-17T02:00:00.000Z"), // 17 Jul SGT
        now: new Date("2026-07-16T15:30:00.000Z"),
        timeZone: tz,
      });
      expect(beforeMidnight.allowed).toBe(false);
      if (beforeMidnight.allowed === false) {
        expect(beforeMidnight.reason).toBe("too_early");
      }

      // 17 July 2026 00:30 SGT = 2026-07-16T16:30:00.000Z
      const afterMidnight = evaluateTripStartDateGate({
        plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
        now: new Date("2026-07-16T16:30:00.000Z"),
        timeZone: tz,
      });
      expect(afterMidnight).toEqual({ allowed: true });
    });

    it("falls back to job.pickupDate when plannedStartAt is null", () => {
      const result = evaluateTripStartDateGate({
        plannedStartAt: null,
        jobPickupDate: new Date("2026-07-17T02:00:00.000Z"),
        now: new Date("2026-07-18T02:00:00.000Z"),
        timeZone: tz,
      });
      expect(result.allowed).toBe(false);
      if (result.allowed === false) {
        expect(result.reason).toBe("too_late");
      }
    });
  });
});
