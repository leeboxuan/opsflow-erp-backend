import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  ValidateIf,
  IsString,
  IsDateString,
  MinLength,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsBoolean,
  IsNotEmpty,
} from "class-validator";
import { CollectionType, JobType } from "@prisma/client";
import { Type } from "class-transformer";


export class CreateJobItemDto {
  @ApiPropertyOptional({ description: "LCL item code; container types may use containerNumber instead" })
  @IsOptional()
  @IsString()
  itemCode?: string | null;

  @ApiPropertyOptional({
    description: "IMPORT/EXPORT/COLLECTION: stored as itemCode when itemCode omitted",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional({
    description: "Seal number (persisted as sealNo)",
  })
  @IsOptional()
  @IsString()
  sealNo?: string;

  @ApiPropertyOptional({
    description: "API alias for sealNo",
  })
  @IsOptional()
  @IsString()
  sealNumber?: string;

  @ApiPropertyOptional({
    description:
      "Deprecated for container-style jobs: use job-level pickupReference. Ignored on IMPORT/EXPORT/COLLECTION writes.",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  pickupReference?: string;

  @ApiPropertyOptional({
    description:
      "LCL item description. For container-style jobs, use job-level description instead (per-item description is ignored on write).",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "LCL quantity; optional for container-style job types" })
  @IsOptional()
  @IsNumber()
  qty?: number;

  @ApiPropertyOptional({
    enum: ["20ft", "40ft", "45ft"],
    description:
      "Container size for IMPORT/EXPORT/COLLECTION. Required for new container rows; wire values are 20ft|40ft|45ft.",
  })
  @IsOptional()
  @IsString()
  containerSize?: string | null;
}

export class AutoTripDocumentRequirementDto {
  @ApiPropertyOptional({ description: "0-based generated trip order" })
  @IsOptional()
  @IsNumber()
  tripIndex?: number;

  @ApiPropertyOptional({ description: "Create a signed Delivery DO requirement for this trip" })
  @IsOptional()
  @IsBoolean()
  signedDeliveryDoRequired?: boolean;

  @ApiPropertyOptional({ description: "Create a signed Lorry Chit requirement for this trip" })
  @IsOptional()
  @IsBoolean()
  signedLorryChitRequired?: boolean;
}

export class CreateJobImportDetailsDto {
  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for import pickup port; converted to pickupPortCode server-side",
  })
  @IsOptional()
  @IsString()
  pickupPortId?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional IMPORT port/terminal metadata (master_singapore_ports.code). Stored when sent; trip origin uses pickup address autocomplete when address/geo fields are provided.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  pickupPortCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  portTerminalCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  portName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vesselName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  vesselEta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional({
    description:
      "RETURN intake only: operator explicitly marked return depot as not confirmed yet. Allows Draft create without a resolved depot; publish still requires a depot.",
  })
  @IsOptional()
  @IsBoolean()
  returningDepotPending?: boolean;

  @ApiPropertyOptional({
    description:
      "Preserved TBA/source wording while returningDepotPending is true. Never stored as deliveryAddress1.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotPendingText?: string | null;

  @ApiPropertyOptional({
    description:
      "IMPORT empty-container return depot code (master_singapore_depots.code). Required with address or code so Customer → Depot can be generated.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string | null;

  @ApiPropertyOptional({
    description: "IMPORT return depot address line 1 when Places intake is used",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotAddress1?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  returningDepotAddress2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  returningDepotPostal?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  returningDepotPlaceId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  returningDepotLat?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  returningDepotLng?: number | null;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: optional logistics location id for return depot; converted to returningDepotCode server-side",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotId?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional container return due date. Does not require or imply a return depot/trip when omitted.",
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string | null;
}

export class CreateJobExportDetailsDto {
  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for export pickup depot; converted server-side",
  })
  @IsOptional()
  @IsString()
  pickupDepotId?: string | null;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for return depot (ignored for EXPORT routing)",
  })
  @IsOptional()
  @IsString()
  returnDepotId?: string | null;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for export port (optional context)",
  })
  @IsOptional()
  @IsString()
  exportPortId?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional EXPORT empty-depot commercial/reference metadata (master depot code). Not required and does not create Trips.",
  })
  @IsOptional()
  @IsString()
  pickupDepotCode?: string;

  @ApiPropertyOptional({
    description:
      "Optional empty-container collection address (compatibility). Ignored by create-time EXPORT topology.",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  containerPickupAddress1?: string;

  @ApiPropertyOptional({
    description: "Container pickup source address line 2",
  })
  @IsOptional()
  @IsString()
  containerPickupAddress2?: string;

  @ApiPropertyOptional({
    description: "Container pickup source postal code",
  })
  @IsOptional()
  @IsString()
  containerPickupPostal?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination address line 1",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  stuffingAddress1?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination address line 2",
  })
  @IsOptional()
  @IsString()
  stuffingAddress2?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination postal code",
  })
  @IsOptional()
  @IsString()
  stuffingPostal?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination contact person",
  })
  @IsOptional()
  @IsString()
  stuffingContactName?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination contact phone",
  })
  @IsOptional()
  @IsString()
  stuffingContactPhone?: string;

  @ApiPropertyOptional({
    description: "Container return destination depot code",
  })
  @IsOptional()
  @IsString()
  returnDepotCode?: string;

  @ApiPropertyOptional({
    description: "Container return due date",
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional({
    description: "Export origin depot code (legacy alias of pickupDepotCode)",
  })
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional({ description: "Singapore export port code (context)" })
  @IsOptional()
  @IsString()
  exportPortCode?: string;

  @ApiPropertyOptional({
    description: "Export port / terminal address line 1 (Places intake)",
  })
  @IsOptional()
  @IsString()
  exportPortAddress1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportPortAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportPortPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportPortPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  exportPortLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  exportPortLng?: number;

  @ApiPropertyOptional({ description: "Export terminal code (optional context)" })
  @IsOptional()
  @IsString()
  exportTerminalCode?: string;

  @ApiPropertyOptional({ description: "Vessel name for export context" })
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional({ description: "Vessel ETA for export context" })
  @IsOptional()
  @IsDateString()
  vesselEta?: string;
}

export class CreateJobDto {
  @ApiPropertyOptional({
    enum: JobType,
    isArray: true,
    description:
      "Canonical multi-value job types (Phase 4). Prefer this over singular jobType.",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(JobType, { each: true })
  jobTypes?: JobType[];

  @ApiPropertyOptional({
    enum: JobType,
    description:
      "Legacy singular job type. Accepted only when jobTypes is omitted, or must agree with jobTypes.",
  })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional({
    enum: CollectionType,
    description:
      "Required when COLLECTION is among job types (EMPTY or LOADED). Ignored otherwise.",
  })
  @ValidateIf(
    (o) =>
      o.jobType === JobType.COLLECTION ||
      (Array.isArray(o.jobTypes) && o.jobTypes.includes(JobType.COLLECTION)),
  )
  @IsNotEmpty({ message: "collectionType is required when job includes COLLECTION" })
  @IsEnum(CollectionType)
  collectionType?: CollectionType;

  @ApiProperty()
  @IsString()
  customerCompanyId: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Optional accepted CustomerQuotation id that governs this job. Must belong to the same customer.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== "")
  @IsString()
  sourceCustomerQuotationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Requested pickup time precision. true = explicit time; false = date-only; null/omit with null pickupDate clears both. Legacy rows may be null.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  pickupDateHasTime?: boolean | null;

  @ApiPropertyOptional({
    description: "Requested customer delivery instant (ISO). Date-only uses tenant-local midnight as calendar anchor only.",
  })
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Requested delivery time precision. true = explicit time; false = date-only; null/omit with null deliveryDate clears both. Legacy rows may be null.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  deliveryDateHasTime?: boolean | null;

  @ApiPropertyOptional({
    description:
      "Job-level pickup reference (IMPORT/EXPORT/COLLECTION). Preferred over per-item pickupReference.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  pickupReference?: string | null;

  @ApiPropertyOptional({
    description:
      "Job-level description (all job types). Distinct from LCL item descriptions and notes.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description: "Carrier name (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  carrierName?: string | null;

  @ApiPropertyOptional({
    description: "Voyage / voyage number (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  voyage?: string | null;

  @ApiPropertyOptional({
    description: "Shipper (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  shipper?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLng?: number;

  @ApiPropertyOptional({
    description:
      "Delivery / destination address. Required unless job type is RETURN and returningDepotPending is true (Draft intake with unset destination).",
  })
  @ValidateIf((o: CreateJobDto) => {
    const types =
      Array.isArray(o.jobTypes) && o.jobTypes.length > 0
        ? o.jobTypes
        : o.jobType
          ? [o.jobType]
          : [];
    const pureReturn = types.length === 1 && types[0] === JobType.RETURN;
    const pending =
      o.returningDepotPending === true ||
      o.importDetails?.returningDepotPending === true;
    // Pending-depot exemption is RETURN-only. Other job types still require destination.
    return !(pureReturn && pending);
  })
  @IsString()
  @MinLength(1)
  deliveryAddress1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLng?: number;

  @ApiPropertyOptional({
    description:
      "Delivery contact name. Optional for IMPORT, EXPORT, COLLECTION, and LCL.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  receiverName?: string | null;

  @ApiPropertyOptional({
    description:
      "Delivery contact phone. Optional for IMPORT, EXPORT, COLLECTION, and LCL.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  receiverPhone?: string | null;

  @ApiPropertyOptional({
    description:
      "Client order reference (external ref). Omit or set to null if not provided.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({
    type: [CreateJobItemDto],
    description:
      "LCL item/qty lines (optional). IMPORT/EXPORT/COLLECTION container lines (optional containerNumber, sealNo/sealNumber). Pickup reference and description are job-level fields.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  items?: CreateJobItemDto[];

  @ApiPropertyOptional({
    type: [CreateJobItemDto],
    description: "Alias for items (same shape). Optional for LCL only.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  cargoItems?: CreateJobItemDto[];

  @ApiPropertyOptional({
    type: [AutoTripDocumentRequirementDto],
    description:
      "Per auto-generated trip document flags. Omitted or false = do not seed Delivery DO or Lorry Chit.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoTripDocumentRequirementDto)
  autoTripDocumentRequirements?: AutoTripDocumentRequirementDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional({
    description:
      "Optional legacy job-level container number. Seeds generated trips for IMPORT/EXPORT only.",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional({
    type: CreateJobImportDetailsDto,
    description:
      "IMPORT-only nested details. Preferred shape for import routing and vessel fields.",
  })
  @ValidateIf(
    (o) =>
      o.jobType === JobType.IMPORT ||
      (Array.isArray(o.jobTypes) && o.jobTypes.includes(JobType.IMPORT)),
  )
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobImportDetailsDto)
  importDetails?: CreateJobImportDetailsDto;

  @ApiPropertyOptional({
    type: CreateJobExportDetailsDto,
    description: "EXPORT-only nested details. Preferred shape for export routing fields.",
  })
  @ValidateIf(
    (o) =>
      o.jobType === JobType.EXPORT ||
      (Array.isArray(o.jobTypes) && o.jobTypes.includes(JobType.EXPORT)),
  )
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobExportDetailsDto)
  exportDetails?: CreateJobExportDetailsDto;

  @ApiPropertyOptional({
    description:
      "Legacy flat field (prefer importDetails.pickupPortCode). Optional metadata; route origin uses pickup address when address/geo fields are provided.",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  pickupPortCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portTerminalCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  portTerminalCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portName)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  portName?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.psaStorageRentLastDay)",
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string;

  @ApiPropertyOptional({
    description:
      "Vessel name (all job types). Prefer top-level carrierName/voyage/shipper/vesselName/vesselEta for shipping details.",
  })
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional({
    description: "Vessel ETA (all job types)",
  })
  @IsOptional()
  @IsDateString()
  vesselEta?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portnetReady)",
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.permitReady)",
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional({
    description:
      "RETURN intake: depot not confirmed yet. Allows Draft Job/Trip without a resolved destination; publish still requires a depot.",
  })
  @IsOptional()
  @IsBoolean()
  returningDepotPending?: boolean;

  @ApiPropertyOptional({
    description:
      "Preserved TBA/source wording while returningDepotPending is true. Never used as a real address.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotPendingText?: string | null;

  @ApiPropertyOptional({
    description:
      "Legacy flat field (prefer importDetails.returningDepotCode). Optional depot endpoint for the auto-created customer → depot trip.",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional({
    description:
      "Legacy flat field (prefer importDetails.returnLastDay). Optional metadata only; does not require return depot.",
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer exportDetails.pickupDepotCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer exportDetails.exportPortCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  exportPortCode?: string;

}


