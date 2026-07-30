import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-07-30' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  date?: string;
}
