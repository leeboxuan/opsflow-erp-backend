import { OmitType } from "@nestjs/swagger";
import { StatisticsDriversQueryDto } from "./statistics-drivers.query.dto";
import { StatisticsExceptionsQueryDto } from "./statistics-exceptions.query.dto";
import { StatisticsFinanceQueryDto } from "./statistics-finance.query.dto";

/**
 * Export queries deliberately omit pagination. Global whitelist validation
 * rejects page/pageSize rather than allowing a client-controlled export bound.
 */
export class StatisticsDriversExportQueryDto extends OmitType(
  StatisticsDriversQueryDto,
  ["page", "pageSize"] as const,
) {}

export class StatisticsFinanceExportQueryDto extends StatisticsFinanceQueryDto {}

export class StatisticsExceptionsExportQueryDto extends OmitType(
  StatisticsExceptionsQueryDto,
  ["page", "pageSize"] as const,
) {}
