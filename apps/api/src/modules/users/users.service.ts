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
    const passwordHash = await hash(dto.password, 12);

    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          organizationId: user.organizationId,
          name: dto.name.trim(),
          email,
          passwordHash,
          role: dto.role,
          active: dto.active ?? true,
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
          metadata: { email: created.email, role: created.role },
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
      if (ownerCount <= 1) throw new BadRequestException('A organização deve manter ao menos um proprietário ativo.');
    }

    const passwordHash = dto.password ? await hash(dto.password, 12) : undefined;
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: publicUserSelect,
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'USER_UPDATED',
          entityType: 'User',
          entityId: id,
          metadata: { fields: Object.keys(dto), role: updated.role, active: updated.active },
        },
      });
      return updated;
    });
  }

  private assertCanManageRole(user: AuthUser, targetRole: AuthUser['role']): void {
    if (targetRole === 'OWNER' && user.role !== 'OWNER') {
      throw new ForbiddenException('Apenas proprietários podem administrar outro proprietário.');
    }
  }
}
