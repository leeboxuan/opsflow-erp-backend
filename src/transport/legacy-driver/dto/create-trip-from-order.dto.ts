import { IsString } from "class-validator";

export class CreateTripFromOrderDto {
  @IsString()
  orderId!: string;
}