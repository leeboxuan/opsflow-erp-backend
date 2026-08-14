import { TripStatus } from "@prisma/client";
import {
  DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR,
  assertDriverTripSequenceAllowsStart,
  findBlockingEarlierDriverTrip,
} from "./driver-trip-sequence.helpers";

const TZ = "Asia/Singapore";
const DAY = new Date("2026-08-14T02:00:00.000Z");

function trip(partial: {
  id: string;
  status: TripStatus;
  tripSequence?: number;
  assignedDriverUserId?: string;
  plannedStartAt?: Date;
}): Parameters<typeof findBlockingEarlierDriverTrip>[0]["trips"][number] {
  return {
    id: partial.id,
    status: partial.status,
    tripSequence: partial.tripSequence ?? (Number(partial.id.replace(/\D/g, "")) || 1),
    jobSequence: partial.tripSequence ?? 1,
    assignedDriverUserId: partial.assignedDriverUserId ?? "driver-a",
    plannedStartAt: partial.plannedStartAt ?? DAY,
    createdAt: DAY,
  };
}

describe("driver trip sequence helpers", () => {
  it("allows starting the first assigned trip of the day", () => {
    expect(
      findBlockingEarlierDriverTrip({
        tripId: "t1",
        driverUserId: "driver-a",
        timeZone: TZ,
        now: DAY,
        trips: [
          trip({ id: "t1", status: TripStatus.PUBLISHED, tripSequence: 1 }),
          trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
        ],
      }),
    ).toBeNull();
  });

  it("blocks a later trip while an earlier assigned trip is still PUBLISHED", () => {
    const blocking = findBlockingEarlierDriverTrip({
      tripId: "t2",
      driverUserId: "driver-a",
      timeZone: TZ,
      now: DAY,
      trips: [
        trip({ id: "t1", status: TripStatus.PUBLISHED, tripSequence: 1 }),
        trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
      ],
    });
    expect(blocking?.id).toBe("t1");
    expect(() =>
      assertDriverTripSequenceAllowsStart({
        tripId: "t2",
        driverUserId: "driver-a",
        timeZone: TZ,
        now: DAY,
        trips: [
          trip({ id: "t1", status: TripStatus.PUBLISHED, tripSequence: 1 }),
          trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
        ],
      }),
    ).toThrow(DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR);
  });

  it("blocks while an earlier trip is ONGOING", () => {
    expect(
      findBlockingEarlierDriverTrip({
        tripId: "t2",
        driverUserId: "driver-a",
        timeZone: TZ,
        now: DAY,
        trips: [
          trip({ id: "t1", status: TripStatus.ONGOING, tripSequence: 1 }),
          trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
        ],
      })?.id,
    ).toBe("t1");
  });

  it("does not block when the earlier trip is COMPLETED, DONE, or CANCELLED", () => {
    for (const status of [
      TripStatus.COMPLETED,
      TripStatus.DONE,
      TripStatus.CANCELLED,
    ] as const) {
      expect(
        findBlockingEarlierDriverTrip({
          tripId: "t2",
          driverUserId: "driver-a",
          timeZone: TZ,
          now: DAY,
          trips: [
            trip({ id: "t1", status, tripSequence: 1 }),
            trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
          ],
        }),
      ).toBeNull();
    }
  });

  it("does not block another driver's earlier trip on the same job", () => {
    expect(
      findBlockingEarlierDriverTrip({
        tripId: "t2",
        driverUserId: "driver-b",
        timeZone: TZ,
        now: DAY,
        trips: [
          trip({
            id: "t1",
            status: TripStatus.PUBLISHED,
            tripSequence: 1,
            assignedDriverUserId: "driver-a",
          }),
          trip({
            id: "t2",
            status: TripStatus.PUBLISHED,
            tripSequence: 2,
            assignedDriverUserId: "driver-b",
          }),
        ],
      }),
    ).toBeNull();
  });

  it("ignores DRAFT trips when ordering the run", () => {
    expect(
      findBlockingEarlierDriverTrip({
        tripId: "t2",
        driverUserId: "driver-a",
        timeZone: TZ,
        now: DAY,
        trips: [
          trip({ id: "t-draft", status: TripStatus.DRAFT, tripSequence: 1 }),
          trip({ id: "t2", status: TripStatus.PUBLISHED, tripSequence: 2 }),
        ],
      }),
    ).toBeNull();
  });
});
