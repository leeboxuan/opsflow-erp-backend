import { IsString } from "class-validator";

export class AddOrderToTripDto {
  @IsString()
  orderId!: string;
}