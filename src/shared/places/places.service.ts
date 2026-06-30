import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type PlacePrediction = {
  placeId: string;
  description: string;
};

type PlaceAutocompleteResponse = {
  predictions: PlacePrediction[];
};

type PlaceDetailsResponse = {
  formattedAddress: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

@Injectable()
export class PlacesService {
  constructor(private readonly configService: ConfigService) {}

  private get apiKey(): string {
    const key = this.configService.get<string>("GOOGLE_MAPS_API_KEY")?.trim();
    if (!key) {
      throw new InternalServerErrorException("Missing GOOGLE_MAPS_API_KEY");
    }
    return key;
  }

  async autocomplete(input: string): Promise<PlaceAutocompleteResponse> {
    const normalized = (input ?? "").trim();
    if (!normalized) {
      throw new BadRequestException("input is required");
    }

    if (/^\d{6}$/.test(normalized)) {
      return this.autocompleteFromPostalCode(normalized);
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", normalized);
    url.searchParams.set("components", "country:sg");
    url.searchParams.set("key", this.apiKey);

    const json = await this.fetchJson(url.toString(), "Places Autocomplete");
    const status = String(json?.status ?? "");
    if (status !== "OK" && status !== "ZERO_RESULTS") {
      const reason = json?.error_message ?? status ?? "unknown error";
      throw new BadRequestException(
        `Places Autocomplete failed: ${reason}`,
      );
    }

    const predictions: PlacePrediction[] = (json?.predictions ?? [])
      .map((p: any) => ({
        placeId: String(p?.place_id ?? "").trim(),
        description: String(p?.description ?? "").trim(),
      }))
      .filter((p: PlacePrediction) => !!p.placeId && !!p.description);

    return { predictions };
  }

  async details(placeId: string): Promise<PlaceDetailsResponse> {
    const normalized = (placeId ?? "").trim();
    if (!normalized) {
      throw new BadRequestException("placeId is required");
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", normalized);
    url.searchParams.set(
      "fields",
      "place_id,name,formatted_address,address_components,geometry",
    );
    url.searchParams.set("key", this.apiKey);

    const json = await this.fetchJson(url.toString(), "Place Details");
    const status = String(json?.status ?? "");
    if (status !== "OK") {
      const reason = json?.error_message ?? status ?? "unknown error";
      throw new BadRequestException(
        `Place Details failed: ${reason}`,
      );
    }

    const result = json?.result;
    const components: GoogleAddressComponent[] = Array.isArray(result?.address_components)
      ? result.address_components
      : [];

    const geometry = result?.geometry?.location;
    const lat = Number.isFinite(Number(geometry?.lat)) ? Number(geometry.lat) : null;
    const lng = Number.isFinite(Number(geometry?.lng)) ? Number(geometry.lng) : null;

    let postalCode = this.pickAddressComponent(components, "postal_code");
    if (!postalCode && lat != null && lng != null) {
      postalCode = await this.reverseGeocodePostalCode(lat, lng);
    }

    const name = String(result?.name ?? "").trim();
    const block = this.pickAddressComponent(components, "street_number");
    const route = this.pickAddressComponent(components, "route");
    const addressLine1 = this.buildAddressLine1({ name, block, route });
    const addressLine2 = this.buildAddressLine2(components);

    return {
      formattedAddress: String(result?.formatted_address ?? "").trim(),
      addressLine1,
      addressLine2,
      postalCode: postalCode ?? "",
      placeId: String(result?.place_id ?? normalized),
      lat,
      lng,
    };
  }

  private async autocompleteFromPostalCode(
    postalCode: string,
  ): Promise<PlaceAutocompleteResponse> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", `Singapore ${postalCode}`);
    url.searchParams.set("components", "country:SG|postal_code:" + postalCode);
    url.searchParams.set("key", this.apiKey);

    const json = await this.fetchJson(url.toString(), "Geocode");
    const status = String(json?.status ?? "");
    if (status !== "OK" && status !== "ZERO_RESULTS") {
      const reason = json?.error_message ?? status ?? "unknown error";
      throw new BadRequestException(
        `Geocode failed: ${reason}`,
      );
    }

    const predictions: PlacePrediction[] = (json?.results ?? [])
      .map((r: any) => ({
        placeId: String(r?.place_id ?? "").trim(),
        description: String(r?.formatted_address ?? "").trim(),
      }))
      .filter((p: PlacePrediction) => !!p.placeId && !!p.description);

    return { predictions };
  }

  private async reverseGeocodePostalCode(
    lat: number,
    lng: number,
  ): Promise<string | null> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("result_type", "postal_code");
    url.searchParams.set("key", this.apiKey);

    const json = await this.fetchJson(url.toString(), "Reverse Geocode");
    const status = String(json?.status ?? "");
    if (status !== "OK" && status !== "ZERO_RESULTS") return null;

    const first = Array.isArray(json?.results) ? json.results[0] : null;
    const components: GoogleAddressComponent[] = Array.isArray(first?.address_components)
      ? first.address_components
      : [];
    return this.pickAddressComponent(components, "postal_code");
  }

  private pickAddressComponent(
    components: GoogleAddressComponent[],
    type: string,
  ): string | null {
    const found = components.find((c) => c.types?.includes(type));
    const value = String(found?.long_name ?? "").trim();
    return value || null;
  }

  private buildAddressLine1(parts: {
    name: string;
    block: string | null;
    route: string | null;
  }): string {
    const street = [parts.block, parts.route].filter(Boolean).join(" ").trim();
    const tokens = [parts.name, street].filter(Boolean) as string[];
    const deduped: string[] = [];
    for (const token of tokens) {
      if (!deduped.some((x) => x.toLowerCase() === token.toLowerCase())) {
        deduped.push(token);
      }
    }
    return deduped.join(", ");
  }

  private buildAddressLine2(components: GoogleAddressComponent[]): string {
    const subpremise = this.pickAddressComponent(components, "subpremise");
    const premise = this.pickAddressComponent(components, "premise");
    const locality = this.pickAddressComponent(components, "locality");
    const adminArea = this.pickAddressComponent(components, "administrative_area_level_1");
    const country = this.pickAddressComponent(components, "country");
    return [subpremise, premise, locality, adminArea, country]
      .filter(Boolean)
      .join(", ");
  }

  private async fetchJson(url: string, label: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException(`${label} request failed (${res.status})`);
    }
    return res.json();
  }
}
