import { IsInt, IsOptional, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminPageQueryDto } from 'src/admin/dto/admin-page-query.dto';
export class BuybackRankingDto extends AdminPageQueryDto {
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() startTime?: number;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() endTime?: number;
  @Matches(/^0x[0-9a-fA-F]{40}$/) @IsOptional() account?: string;
}
