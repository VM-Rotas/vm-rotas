import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.vehicle.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ active: 'desc' }, { status: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { routePlans: true },
        },
      },
    });
  }

  async findOne(user: AuthUser, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        routePlans: {
          take: 10,
          orderBy: [{ routeDate: 'desc' }, { revision: 'desc' }],
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException('Veículo não encontrado.');
    }
    return vehicle;
  }

  async create(user: AuthUser, dto: CreateVehicleDto) {
    this.assertWorkingHours(dto.startHour, dto.endHour);
    const plate = this.normalizePlate(dto.plate);
    const duplicate = await this.prisma.vehicle.findFirst({
      where: { organizationId: user.organizationId, plate },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('Já existe um veículo com esta placa.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const vehicle = await transaction.vehicle.create({
        data: {
          organizationId: user.organizationId,
          plate,
          name: dto.name.trim(),
          status: dto.status ?? 'AVAILABLE',
          capacityWeightKg: dto.capacityWeightKg,
          capacityVolumeM3: dto.capacityVolumeM3,
          startHour: dto.startHour,
          endHour: dto.endHour,
          active: dto.active ?? true,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'VEHICLE_CREATED',
          entityType: 'Vehicle',
          entityId: vehicle.id,
          metadata: { plate: vehicle.plate, name: vehicle.name },
        },
      });
      return vehicle;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateVehicleDto) {
    const existing = await this.findOne(user, id);
    this.assertWorkingHours(
      dto.startHour ?? existing.startHour ?? undefined,
      dto.endHour ?? existing.endHour ?? undefined,
    );
    const data: Prisma.VehicleUncheckedUpdateInput = {};

    if (dto.plate !== undefined) {
      const plate = this.normalizePlate(dto.plate);
      const duplicate = await this.prisma.vehicle.findFirst({
        where: {
          organizationId: user.organizationId,
          plate,
          NOT: { id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('Já existe outro veículo com esta placa.');
      }
      data.plate = plate;
    }
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.capacityWeightKg !== undefined) data.capacityWeightKg = dto.capacityWeightKg;
    if (dto.capacityVolumeM3 !== undefined) data.capacityVolumeM3 = dto.capacityVolumeM3;
    if (dto.startHour !== undefined) data.startHour = dto.startHour;
    if (dto.endHour !== undefined) data.endHour = dto.endHour;
    if (dto.active !== undefined) data.active = dto.active;

    if (dto.active === false && existing.status === 'IN_ROUTE') {
      throw new BadRequestException('Um veículo em rota não pode ser desativado.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const vehicle = await transaction.vehicle.update({ where: { id }, data });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'VEHICLE_UPDATED',
          entityType: 'Vehicle',
          entityId: id,
          metadata: { fields: Object.keys(dto) },
        },
      });
      return vehicle;
    });
  }

  private normalizePlate(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private assertWorkingHours(startHour?: string, endHour?: string): void {
    if (startHour && endHour && startHour >= endHour) {
      throw new BadRequestException('O início da jornada deve ser anterior ao fim.');
    }
  }
}
