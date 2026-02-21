import { Injectable, BadRequestException } from "@nestjs/common";

type LatLng = { lat: number; lng: number };

@Injectable()
export class GoogleMapsService {
  private key = process.env.GOOGLE_MAPS_API_KEY;

  private ensureKey() {
    if (!this.key) throw new BadRequestException("Missing GOOGLE_MAPS_API_KEY");
  }

  async geocodeAddress(address: string): Promise<{ location: LatLng; placeId?: string }> {
    this.ensureKey();

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.key}`;

    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException(`Geocode failed (${res.status})`);
    const json: any = await res.json();

    const first = json.results?.[0];
    if (!first?.geometry?.location) throw new BadRequestException("Geocode: no results");

    return {
      location: first.geometry.location,
      placeId: first.place_id,
    };
  }

  /**
   * Optimizes waypoint order using Directions optimize:true.
   * Returns order indices for the waypoints array.
   */
  async optimizeRoute(params: {
    origin: LatLng;
    destination: LatLng;
    waypoints: LatLng[];
  }): Promise<{ waypointOrder: number[]; polyline?: string }> {
    this.ensureKey();

    const origin = `${params.origin.lat},${params.origin.lng}`;
    const destination = `${params.destination.lat},${params.destination.lng}`;
    const waypointsStr =
      "optimize:true|" +
      params.waypoints.map((w) => `${w.lat},${w.lng}`).join("|");

    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypointsStr)}&key=${this.key}`;

    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException(`Directions failed (${res.status})`);
    const json: any = await res.json();

    const route = json.routes?.[0];
    if (!route) throw new BadRequestException("Directions: no route");

    return {
      waypointOrder: route.waypoint_order ?? [],
      polyline: route.overview_polyline?.points,
    };
  }
}