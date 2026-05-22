export interface DriverPushCopy {
  title: string;
  body: string;
}

export function driverPushCopyForType(type: string): DriverPushCopy {
  const map: Record<string, DriverPushCopy> = {
    "trip.assigned": {
      title: "New trip assigned",
      body: "You have a new trip to review.",
    },
    "trip.published": {
      title: "Trip ready to start",
      body: "A trip has been published for you.",
    },
    "trip.updated": {
      title: "Trip updated",
      body: "Details for one of your trips were updated.",
    },
    "trip.unpublished": {
      title: "Trip unpublished",
      body: "A trip is no longer published.",
    },
    "trip.cancelled": {
      title: "Trip cancelled",
      body: "A trip assigned to you was cancelled.",
    },
    "document.uploaded": {
      title: "New document available",
      body: "A document was added to your trip.",
    },
    "document.signed": {
      title: "Document signed",
      body: "A document on your trip was signed.",
    },
  };

  return (
    map[type] ?? {
      title: "OpsFlow update",
      body: "You have a new notification.",
    }
  );
}
