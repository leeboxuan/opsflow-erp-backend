import { PartialType } from '@nestjs/swagger';
import { CreateWarehouseJobCargoLineDto } from './create-warehouse-job-cargo-line.dto';

export class UpdateWarehouseJobCargoLineDto extends PartialType(
  CreateWarehouseJobCargoLineDto,
) {}
