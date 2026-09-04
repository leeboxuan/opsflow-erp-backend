import { BadRequestException } from "@nestjs/common";
import { JobType } from "@prisma/client";
import type {
  CreateJobExportDetailsDto,
  CreateJobImportDetailsDto,
} from "./dto/create-job.dto";

export function clearIncompatibleTypeSpecificJobFields(
  data: Record<string, unknown>,
  nextJobType: JobType,
): void {
  if (nextJobType !== JobType.IMPORT) {
    data.pickupPortCode = null;
    data.portTerminalCode = null;
    data.portName = null;
    data.psaStorageRentLastDay = null;
    data.psaStorageRentLastDayHasTime = null;
    data.portnetReady = false;
    data.permitReady = false;
  }
  if (nextJobType !== JobType.IMPORT && nextJobType !== JobType.RETURN) {
    data.returningDepotCode = null;
    data.returnLastDay = null;
    data.returningDepotPending = false;
    data.returningDepotPendingText = null;
  }
  if (nextJobType !== JobType.EXPORT) {
    data.exportOriginDepotCode = null;
    data.exportPortCode = null;
  }
}

export function applyOptionalTrimmedNullable(
  data: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    data[key] = null;
    return;
  }
  data[key] = value.trim() || null;
}

export function applyOptionalDateNullable(
  data: Record<string, unknown>,
  key: string,
  value: string | Date | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    data[key] = null;
    return;
  }
  data[key] = value instanceof Date ? value : new Date(value);
}

export function applyImportDetailsPatch(
  data: Record<string, unknown>,
  details: CreateJobImportDetailsDto,
): void {
  applyOptionalTrimmedNullable(data, "pickupPortCode", details.pickupPortCode);
  applyOptionalTrimmedNullable(data, "portTerminalCode", details.portTerminalCode);
  applyOptionalTrimmedNullable(data, "portName", details.portName);
  applyOptionalDateNullable(
    data,
    "psaStorageRentLastDay",
    details.psaStorageRentLastDay,
  );
  if (details.psaStorageRentLastDayHasTime !== undefined) {
    data.psaStorageRentLastDayHasTime = details.psaStorageRentLastDayHasTime;
  } else if (details.psaStorageRentLastDay !== undefined) {
    const raw = String(details.psaStorageRentLastDay ?? "").trim();
    data.psaStorageRentLastDayHasTime = !raw
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? false
        : true;
  }
  applyOptionalTrimmedNullable(data, "vesselName", details.vesselName);
  applyOptionalDateNullable(data, "vesselEta", details.vesselEta);
  if (details.portnetReady !== undefined) data.portnetReady = details.portnetReady;
  if (details.permitReady !== undefined) data.permitReady = details.permitReady;
  applyOptionalTrimmedNullable(
    data,
    "returningDepotCode",
    details.returningDepotCode,
  );
  applyOptionalDateNullable(data, "returnLastDay", details.returnLastDay);
  if (details.returningDepotPending !== undefined) {
    data.returningDepotPending = details.returningDepotPending === true;
    if (details.returningDepotPending === true) {
      // Pending intake: never keep TBA/fabricated address on the job row.
      data.deliveryAddress1 = "";
      data.deliveryAddress2 = null;
      data.deliveryPostal = null;
      data.returningDepotCode = null;
    }
  }
  applyOptionalTrimmedNullable(
    data,
    "returningDepotPendingText",
    details.returningDepotPendingText,
  );
}

export function applyExportDetailsPatch(
  data: Record<string, unknown>,
  details: CreateJobExportDetailsDto,
): void {
  if (details.exportOriginDepotCode !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "exportOriginDepotCode",
      details.exportOriginDepotCode,
    );
  } else if (details.pickupDepotCode !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "exportOriginDepotCode",
      details.pickupDepotCode,
    );
  }
  applyOptionalTrimmedNullable(data, "exportPortCode", details.exportPortCode);
  applyOptionalTrimmedNullable(data, "vesselName", details.vesselName);
  applyOptionalDateNullable(data, "vesselEta", details.vesselEta);

  if (details.containerPickupAddress1) {
    data.pickupAddress1 = details.containerPickupAddress1.trim();
  }
  if (details.containerPickupAddress2 !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "pickupAddress2",
      details.containerPickupAddress2,
    );
  }
  if (details.containerPickupPostal !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "pickupPostal",
      details.containerPickupPostal,
    );
  }

  if (details.stuffingAddress1) {
    data.deliveryAddress1 = details.stuffingAddress1.trim();
  }
  if (details.stuffingAddress2 !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "deliveryAddress2",
      details.stuffingAddress2,
    );
  }
  if (details.stuffingPostal !== undefined) {
    applyOptionalTrimmedNullable(data, "deliveryPostal", details.stuffingPostal);
  }
  if (details.stuffingContactName !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "receiverName",
      details.stuffingContactName,
    );
  }
  if (details.stuffingContactPhone !== undefined) {
    applyOptionalTrimmedNullable(
      data,
      "receiverPhone",
      details.stuffingContactPhone,
    );
  }
}

export function assertTypeSpecificDetailsMatchJobType(
  effectiveJobType: JobType,
  dto: {
    importDetails?: CreateJobImportDetailsDto | null;
    exportDetails?: CreateJobExportDetailsDto | null;
  },
): void {
  if (dto.importDetails != null && effectiveJobType !== JobType.IMPORT) {
    throw new BadRequestException(
      "importDetails is only valid when jobType is IMPORT",
    );
  }
  if (dto.exportDetails != null && effectiveJobType !== JobType.EXPORT) {
    throw new BadRequestException(
      "exportDetails is only valid when jobType is EXPORT",
    );
  }
}
