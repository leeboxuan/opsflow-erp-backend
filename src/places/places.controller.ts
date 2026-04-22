import { Controller, Get, Query } from "@nestjs/common";
import {
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { PlacesService } from "./places.service";

@ApiTags("places")
@Controller("places")
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get("autocomplete")
  @ApiOperation({ summary: "Autocomplete Singapore addresses or postal code search" })
  @ApiQuery({ name: "input", required: true, type: String })
  autocomplete(@Query("input") input: string) {
    return this.places.autocomplete(input);
  }

  @Get("details")
  @ApiOperation({ summary: "Get normalized place details for FE auto-population" })
  @ApiQuery({ name: "placeId", required: true, type: String })
  details(@Query("placeId") placeId: string) {
    return this.places.details(placeId);
  }
}
