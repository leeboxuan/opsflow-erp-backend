import { ApiProperty } from '@nestjs/swagger';

export class LocationDto {
  @ApiProperty()
  driverUserId: string;

  @ApiProperty()
  lat: number;

  @ApiProperty()
  lng: number;

  @ApiProperty({ nullable: true })
  accuracy: number | null;

  @ApiProperty({ nullable: true })
  heading: number | null;

  @ApiProperty({ nullable: true })
  speed: number | null;

  @ApiProperty()
  capturedAt: Date;

  @ApiProperty({ nullable: true })
  recordedAt: Date | null;

  @ApiProperty()
  updatedAt: Date;
}

export class DriverLocationDto extends LocationDto {
  @ApiProperty({ nullable: true })
  driverName: string | null;

  @ApiProperty()
  driverEmail: string;
}
