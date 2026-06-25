import type { PaginatedResponse } from "../common/pagination";

export type TrackingStatus = "ONLINE" | "STALE" | "OFFLINE" | "UNASSIGNED";

export interface AssignedGpsDeviceDto {
  id: string;
  terminalId: string;
  imei: string | null;
  simNumber: string | null;
  model: string;
  protocol: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
}

export interface FleetTrackingChassisDto {
  id: string;
  tenantId: string;
  chassisNo: string;
  label: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedGpsDevice: AssignedGpsDeviceDto | null;
  trackingStatus: TrackingStatus;
  lastSeenAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
  ageSeconds: number | null;
}

export interface FleetTrackingGpsDeviceDto {
  id: string;
  tenantId: string;
  terminalId: string;
  imei: string | null;
  simNumber: string | null;
  model: string;
  protocol: string;
  isActive: boolean;
  chassisId: string | null;
  chassis: {
    id: string;
    chassisNo: string;
    label: string | null;
    status: string;
  } | null;
  lastSeenAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
  trackingStatus: TrackingStatus;
  ageSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeleteChassisResult {
  id: string;
  deleted: boolean;
  deactivated: boolean;
}

export interface LiveChassisLocationItem {
  chassisId: string;
  chassisNo: string;
  label: string | null;
  chassisStatus: string;
  gpsDeviceId: string | null;
  terminalId: string | null;
  imei: string | null;
  simNumber: string | null;
  model: string | null;
  protocol: string | null;
  isDeviceActive: boolean | null;
  trackingStatus: TrackingStatus;
  lastSeenAt: string | null;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  heading: number | null;
  ageSeconds: number | null;
}

export interface LiveChassisLocationsResponse {
  generatedAt: string;
  items: LiveChassisLocationItem[];
}

export type ListFleetTrackingChassisResult = PaginatedResponse<FleetTrackingChassisDto>;
export type ListFleetTrackingGpsDevicesResult = PaginatedResponse<FleetTrackingGpsDeviceDto>;
