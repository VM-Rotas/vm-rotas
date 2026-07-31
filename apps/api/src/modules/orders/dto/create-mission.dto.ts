import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
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

  @ApiPropertyOptional({ example: '350' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  pickupAddressNumber?: string;

  @ApiPropertyOptional({ example: 'Fundos, portão azul' })
  @IsOptional()
  @IsString()
  pickupAddressComplement?: string;

  @ApiPropertyOptional({ example: '86990-000' })
  @IsOptional()
  @IsString()
  pickupPostalCode?: string;

  @ApiPropertyOptional({ example: 'Rua Exemplo, 120, Centro, Marialva, Paraná, Brasil' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  pickupFormattedAddress?: string;

  @ApiPropertyOptional({ example: -23.485 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLatitude?: number;

  @ApiPropertyOptional({ example: -51.79 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLongitude?: number;


  @ApiPropertyOptional({ example: 'Centro' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  pickupNeighborhood?: string;

  @ApiPropertyOptional({ example: 'Marialva' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  pickupCity?: string;

  @ApiPropertyOptional({ example: 'PR' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  pickupState?: string;

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

  @ApiPropertyOptional({ example: '120' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  deliveryAddressNumber?: string;

  @ApiPropertyOptional({ example: 'Barracão dos fundos' })
  @IsOptional()
  @IsString()
  deliveryAddressComplement?: string;

  @ApiPropertyOptional({ example: '87000-000' })
  @IsOptional()
  @IsString()
  deliveryPostalCode?: string;

  @ApiPropertyOptional({ example: 'Avenida Brasil, 350, Centro, Marialva, Paraná, Brasil' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  deliveryFormattedAddress?: string;

  @ApiPropertyOptional({ example: -23.485 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  deliveryLatitude?: number;

  @ApiPropertyOptional({ example: -51.79 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  deliveryLongitude?: number;


  @ApiPropertyOptional({ example: 'Centro' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  deliveryNeighborhood?: string;

  @ApiPropertyOptional({ example: 'Marialva' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  deliveryCity?: string;

  @ApiPropertyOptional({ example: 'PR' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  deliveryState?: string;

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
