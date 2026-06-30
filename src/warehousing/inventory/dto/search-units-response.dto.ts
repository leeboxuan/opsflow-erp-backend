import { ApiProperty } from '@nestjs/swagger';

export class SearchUnitsResponseDto<T = any> {
  @ApiProperty({ isArray: true })
  rows!: T[];

  @ApiProperty({ nullable: true, example: 'ckxyz...' })
  nextCursor!: string | null;

  @ApiProperty({ example: true })
  hasMore!: boolean;

  @ApiProperty({ example: 187 })
  totalCount!: number;

  @ApiProperty({
    example: {
      total: 187,
      available: 120,
      reserved: 40,
      inTransit: 20,
      delivered: 5,
      other: 2,
    },
  })
  stats!: {
    total: number;
    available: number;
    reserved: number;
    inTransit: number;
    delivered: number;
    other: number;
  };
}
