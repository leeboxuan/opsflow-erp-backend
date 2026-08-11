import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hasDateParam(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

@ValidatorConstraint({ name: "dashboardDateRangePair", async: false })
class DashboardDateRangePairConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as DashboardSummaryQueryDto;
    return hasDateParam(obj.from) === hasDateParam(obj.to);
  }

  defaultMessage(): string {
    return "from and to must both be provided or both omitted";
  }
}

@ValidatorConstraint({ name: "dashboardDateRangeOrder", async: false })
class DashboardDateRangeOrderConstraint
  implements ValidatorConstraintInterface
{
  validate(to: string | undefined, args: ValidationArguments): boolean {
    const from = (args.object as DashboardSummaryQueryDto).from;
    if (!hasDateParam(from) || !hasDateParam(to)) return true;
    return from! <= to!;
  }

  defaultMessage(): string {
    return "to must be on or after from";
  }
}

function dateDescription(boundary: "from" | "to"): string {
  return `${boundary === "from" ? "Inclusive" : "Inclusive calendar"} date in the tenant timezone (YYYY-MM-DD). Both omitted defaults to Today. Exactly one is rejected. The service converts the pair to an inclusive-exclusive UTC range.`;
}

export class DashboardSummaryQueryDto {
  @ApiPropertyOptional({
    description: dateDescription("from"),
    example: "2026-08-11",
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "from must be YYYY-MM-DD" })
  @IsDateString({ strict: true }, { message: "from must be a valid date" })
  @Validate(DashboardDateRangePairConstraint)
  from?: string;

  @ApiPropertyOptional({
    description: dateDescription("to"),
    example: "2026-08-11",
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "to must be YYYY-MM-DD" })
  @IsDateString({ strict: true }, { message: "to must be a valid date" })
  @Validate(DashboardDateRangeOrderConstraint)
  @Validate(DashboardDateRangePairConstraint)
  to?: string;
}
