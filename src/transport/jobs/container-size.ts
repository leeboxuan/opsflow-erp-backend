import { BadRequestException } from "@nestjs/common";
import { ContainerSize } from "@prisma/client";

/** Wire / UI values for JobItem.containerSize. */
export const CONTAINER_SIZE_WIRE_VALUES = ["20ft", "40ft", "45ft"] as const;
export type ContainerSizeWire = (typeof CONTAINER_SIZE_WIRE_VALUES)[number];

const WIRE_TO_PRISMA: Record<ContainerSizeWire, ContainerSize> = {
  "20ft": ContainerSize.FT_20,
  "40ft": ContainerSize.FT_40,
  "45ft": ContainerSize.FT_45,
};

const PRISMA_TO_WIRE: Record<ContainerSize, ContainerSizeWire> = {
  [ContainerSize.FT_20]: "20ft",
  [ContainerSize.FT_40]: "40ft",
  [ContainerSize.FT_45]: "45ft",
};

export function isContainerSizeWire(value: string): value is ContainerSizeWire {
  return (CONTAINER_SIZE_WIRE_VALUES as readonly string[]).includes(value);
}

/** Map ops equipment tokens (40HC, 1x20GP) onto the wire size enum without inventing identity. */
export function parseContainerSizeFromEquipmentText(
  raw: unknown,
): ContainerSize | null {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return null;
  const compact = text.replace(/\s+/g, "");
  if (/(?:^|X)45(FT|HC|HQ|GP)?(?:$|[^0-9])/.test(compact) || compact === "45") {
    return ContainerSize.FT_45;
  }
  if (/(?:^|X)40(FT|HC|HQ|GP|DC)?(?:$|[^0-9])/.test(compact) || compact === "40") {
    return ContainerSize.FT_40;
  }
  if (/(?:^|X)20(FT|HC|HQ|GP|DC|FR)?(?:$|[^0-9])/.test(compact) || compact === "20") {
    return ContainerSize.FT_20;
  }
  return null;
}

/** Serialize Prisma enum (or legacy string) to API wire value. */
export function toContainerSizeWire(
  value: ContainerSize | string | null | undefined,
): ContainerSizeWire | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isContainerSizeWire(trimmed)) return trimmed;
    if (trimmed in PRISMA_TO_WIRE) {
      return PRISMA_TO_WIRE[trimmed as ContainerSize];
    }
    return null;
  }
  return PRISMA_TO_WIRE[value] ?? null;
}

/**
 * Parse create/update input to Prisma enum.
 * Empty / omitted → null (legacy-compatible).
 * Present but unsupported → BadRequestException.
 */
export function parseContainerSizeInput(
  raw: unknown,
  opts?: { required?: boolean; fieldLabel?: string },
): ContainerSize | null {
  const label = opts?.fieldLabel ?? "Container size";
  if (raw == null || raw === "") {
    if (opts?.required) {
      throw new BadRequestException(`${label} is required`);
    }
    return null;
  }
  const text = String(raw).trim();
  if (!text) {
    if (opts?.required) {
      throw new BadRequestException(`${label} is required`);
    }
    return null;
  }
  if (isContainerSizeWire(text)) return WIRE_TO_PRISMA[text];
  // Accept Prisma member names for internal/compat callers.
  if (text === "FT_20") return ContainerSize.FT_20;
  if (text === "FT_40") return ContainerSize.FT_40;
  if (text === "FT_45") return ContainerSize.FT_45;
  const fromEquipment = parseContainerSizeFromEquipmentText(text);
  if (fromEquipment) return fromEquipment;
  throw new BadRequestException(
    `${label} must be one of: ${CONTAINER_SIZE_WIRE_VALUES.join(", ")}`,
  );
}
