import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignMissionVehicleDto {
  @ApiPropertyOptional({
    description: 'ID do veículo designado. Envie null para voltar ao modo automático.',
    example: '4abdb504-ef85-4f38-9c80-421c1d1cdd9e',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  assignedVehicleId?: string | null;
}
