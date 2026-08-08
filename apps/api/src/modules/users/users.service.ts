import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  assignedVehicleId: true,
  assignedVehicle: {
    select: {
      id: true,
      name: true,
      plate: true,
      status: true,
      active: true,
    },
  },
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: publicUserSelect,
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthUser, dto: CreateUserDto) {
    this.assertCanManageRole(user, dto.role);
    const email = dto.email.trim().toLowerCase();
    const duplicate = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (duplicate) throw new BadRequestException('Já existe um usuário com este e-mail.');

    const active = dto.active ?? true;
    const assignedVehicleId =
      dto.role === 'DRIVER' && active && dto.assignedVehicleId
        ? await this.validateDriverVehicle(user.organizationId, dto.assignedVehicleId)
        : null;

    if (dto.assignedVehicleId && dto.role !== 'DRIVER') {
      throw new BadRequestException('Somente contas com função Motorista podem receber um veículo fixo.');
    }

    const passwordHash = await hash(dto.password, 12);
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          organizationId: user.organizationId,
          name: dto.name.trim(),
          email,
          passwordHash,
          role: dto.role,
          assignedVehicleId,
          active,
        },
        select: publicUserSelect,
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'USER_CREATED',
          entityType: 'User',
          entityId: created.id,
          metadata: {
            email: created.email,
            role: created.role,
            assignedVehicleId: created.assignedVehicleId,
          },
        },
      });
      return created;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id, organizationId: user.organizationId },
      select: publicUserSelect,
    });
    if (!existing) throw new NotFoundException('Usuário não encontrado.');

    this.assertCanManageRole(user, existing.role);
    if (dto.role) this.assertCanManageRole(user, dto.role);

    if (id === user.sub && dto.active === false) {
      throw new BadRequestException('Você não pode desativar o próprio usuário.');
    }

    if (
      existing.role === 'OWNER' &&
      ((dto.role !== undefined && dto.role !== 'OWNER') || dto.active === false)
    ) {
      const ownerCount = await this.prisma.user.count({
        where: { organizationId: user.organizationId, role: 'OWNER', active: true },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('A organização deve manter ao menos um proprietário ativo.');
      }
    }

    const normalizedEmail = dto.email?.trim().toLowerCase();
    if (normalizedEmail && normalizedEmail !== existing.email) {
      const duplicate = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Já existe um usuário com este e-mail.');
      }
    }

    const targetRole = dto.role ?? existing.role;
    const targetActive = dto.active ?? existing.active;
    let assignedVehicleId: string | null | undefined;

    if (targetRole !== 'DRIVER' || !targetActive) {
      assignedVehicleId = null;
    } else if (dto.assignedVehicleId !== undefined) {
      assignedVehicleId = dto.assignedVehicleId
        ? await this.validateDriverVehicle(user.organizationId, dto.assignedVehicleId, id)
        : null;
    }

    if (dto.assignedVehicleId && targetRole !== 'DRIVER') {
      throw new BadRequestException('Somente contas com função Motorista podem receber um veículo fixo.');
    }

    const passwordHash = dto.password ? await hash(dto.password, 12) : undefined;
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(assignedVehicleId !== undefined ? { assignedVehicleId } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: publicUserSelect,
      });

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: dto.password ? 'USER_PASSWORD_RESET' : 'USER_UPDATED',
          entityType: 'User',
          entityId: id,
          metadata: {
            fields: Object.keys(dto).filter((field) => field !== 'password'),
            passwordReset: Boolean(dto.password),
            email: updated.email,
            role: updated.role,
            active: updated.active,
            assignedVehicleId: updated.assignedVehicleId,
          },
        },
      });

      return updated;
    });
  }

  private async validateDriverVehicle(
    organizationId: string,
    vehicleId: string,
    currentUserId?: string,
  ): Promise<string> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId, active: true },
      select: { id: true, name: true, plate: true },
    });
    if (!vehicle) throw new BadRequestException('O veículo selecionado não existe ou está inativo.');

    const assignedToAnother = await this.prisma.user.findFirst({
      where: {
        organizationId,
        assignedVehicleId: vehicleId,
        ...(currentUserId ? { NOT: { id: currentUserId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (assignedToAnother) {
      throw new BadRequestException(
        `${vehicle.name} já está atribuído ao motorista ${assignedToAnother.name}. Remova esse vínculo antes de continuar.`,
      );
    }
    return vehicle.id;
  }

  private assertCanManageRole(user: AuthUser, targetRole: AuthUser['role']): void {
    if (targetRole === 'OWNER' && user.role !== 'OWNER') {
      throw new ForbiddenException('Apenas proprietários podem administrar outro proprietário.');
    }
  }
}
