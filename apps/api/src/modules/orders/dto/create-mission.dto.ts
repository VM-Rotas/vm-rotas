import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateMissionDto {
  @ApiProperty({ example: '2026-07-30' })
  @IsString()
  @Length(10, 10)
  plannedDate: string;

  @ApiPropertyOptional({
    enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    default: 'NORMAL',
  })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @ApiPropertyOptional({ example: 'Costureira Maria' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  pickupName?: string;

  @ApiPropertyOptional({ example: 'Rua Exemplo, 120, Marialva - PR' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  pickupAddress?: string;

  @ApiPropertyOptional({ example: 'Buscar 30 jalecos prontos' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  pickupItem?: string;

  @ApiPropertyOptional({ example: '09:30' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'O horário da coleta deve estar no formato HH:mm.' })
  pickupTime?: string;

  @ApiPropertyOptional({ example: 'Bordado Marialva' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  deliveryName?: string;

  @ApiPropertyOptional({ example: 'Avenida Brasil, 350, Marialva - PR' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Levar os 30 jalecos para bordar' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  deliveryItem?: string;

  @ApiPropertyOptional({ example: '10:30' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'O horário da entrega deve estar no formato HH:mm.' })
  deliveryTime?: string;

  @ApiPropertyOptional({ example: 'Falar com a responsável antes de sair.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
