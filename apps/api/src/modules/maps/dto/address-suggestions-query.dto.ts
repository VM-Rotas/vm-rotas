import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AddressSuggestionsQueryDto {
  @ApiProperty({ example: 'Rua Santos Dumont, Marialva' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  query: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 8, default: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  limit = 6;
}
