import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/types/auth-user';
import { parseDateOnly } from '../../common/utils/date.utils';
import { Prisma, type ServiceOrder } from '../../generated/prisma/client';
import { MapsService } from '../maps/maps.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateMissionDto } from './dto/create-mission.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

interface MissionPointInput {
  type: 'PICKUP' | 'DELIVERY';
  name: string;
  address: string;
  addressNumber: string;
  addressComplement?: string;
  postalCode?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  locationConfirmed?: boolean;
  city?: string;
  neighborhood?: string;
  state?: string;
  item: string;
  time?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapsService,
  ) {}

  async list(user: AuthUser, query: ListOrdersQueryDto) {
    const where: Prisma.ServiceOrderWhereInput = {
      organizationId: user.organizationId,
      ...(query.date ? { plannedDate: parseDateOnly(query.date) } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { externalReference: { contains: query.search, mode: 'insensitive' } },
              { recipientName: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
              { addressLine: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceOrder.findMany({
        where,
        include: { customer: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: query.take,
        skip: query.skip,
      }),
      this.prisma.serviceOrder.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(user: AuthUser, id: string) {
    const order = await this.prisma.serviceOrder.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        customer: true,
        routeStops: {
          include: { routePlan: { include: { vehicle: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Ordem não encontrada.');
    }
    return order;
  }

  async createMission(user: AuthUser, dto: CreateMissionDto) {
    const pickup = this.buildMissionPoint('PICKUP', {
      name: dto.pickupName,
      address: dto.pickupAddress,
      formattedAddress: dto.pickupFormattedAddress,
      addressNumber: dto.pickupAddressNumber,
      addressComplement: dto.pickupAddressComplement,
      postalCode: dto.pickupPostalCode,
      latitude: dto.pickupLatitude,
      longitude: dto.pickupLongitude,
      locationConfirmed: dto.pickupLocationConfirmed,
      city: dto.pickupCity,
      neighborhood: dto.pickupNeighborhood,
      state: dto.pickupState,
      item: dto.pickupItem,
      time: dto.pickupTime,
    });
    const delivery = this.buildMissionPoint('DELIVERY', {
      name: dto.deliveryName,
      address: dto.deliveryAddress,
      formattedAddress: dto.deliveryFormattedAddress,
      addressNumber: dto.deliveryAddressNumber,
      addressComplement: dto.deliveryAddressComplement,
      postalCode: dto.deliveryPostalCode,
      latitude: dto.deliveryLatitude,
      longitude: dto.deliveryLongitude,
      locationConfirmed: dto.deliveryLocationConfirmed,
      city: dto.deliveryCity,
      neighborhood: dto.deliveryNeighborhood,
      state: dto.deliveryState,
      item: dto.deliveryItem,
      time: dto.deliveryTime,
    });
    const points = [pickup, delivery].filter(
      (point): point is MissionPointInput => point !== null,
    );

    if (points.length === 0) {
      throw new BadRequestException('Informe uma coleta, uma entrega ou as duas.');
    }

    const plannedDate = parseDateOnly(dto.plannedDate);
    const reference = this.generateMissionCode();
    const geocodedPoints = await Promise.all(
      points.map(async (point) => ({
        point,
        // Quando o usuário confirma o pino no minimapa, essas coordenadas
        // representam a entrada exata escolhida. Nesse caso, não substituímos o
        // ponto por uma nova geocodificação aproximada da rua.
        geocoded:
          point.locationConfirmed && point.latitude != null && point.longitude != null
            ? {
                latitude: point.latitude,
                longitude: point.longitude,
                formattedAddress: this.missionSearchAddress(point),
                placeId: 'confirmed-map-pin',
                city: point.city,
                neighborhood: point.neighborhood,
                state: point.state,
                postalCode: point.postalCode,
                accuracy: 'BUILDING' as const,
              }
            : point.addressNumber
              ? await this.tryGeocode(this.missionSearchAddress(point))
              : point.latitude != null && point.longitude != null
                ? {
                    latitude: point.latitude,
                    longitude: point.longitude,
                    formattedAddress: point.formattedAddress ?? point.address,
                    placeId: 'selected-address',
                    city: point.city,
                    neighborhood: point.neighborhood,
                    state: point.state,
                    postalCode: point.postalCode,
                  }
                : await this.tryGeocode(this.missionSearchAddress(point)),
      })),
    );

    return this.prisma.$transaction(async (transaction) => {
      const created: ServiceOrder[] = [];

      for (const { point, geocoded } of geocodedPoints) {
        const inferredLocation = this.inferCityAndState(
          point.formattedAddress ?? geocoded?.formattedAddress ?? this.missionSearchAddress(point),
        );
        const location = {
          city: point.city ?? geocoded?.city ?? inferredLocation.city,
          neighborhood: point.neighborhood ?? geocoded?.neighborhood,
          state: (point.state ?? geocoded?.state ?? inferredLocation.state).toUpperCase(),
        };
        const typeSuffix = point.type === 'PICKUP' ? 'C' : 'E';
        const timeWindowStart = this.missionDateTime(dto.plannedDate, point.time);
        const timeWindowEnd = timeWindowStart
          ? new Date(timeWindowStart.getTime() + 60 * 60 * 1_000)
          : null;

        const order = await transaction.serviceOrder.create({
          data: {
            organizationId: user.organizationId,
            createdById: user.sub,
            code: `${reference}-${typeSuffix}`,
            externalReference: reference,
            type: point.type,
            status: 'READY',
            priority: dto.priority ?? 'NORMAL',
            plannedDate,
            timeWindowStart,
            timeWindowEnd,
            serviceDurationMin: 10,
            recipientName: point.name.trim(),
            addressLine: point.address.trim(),
            addressNumber: point.addressNumber.trim(),
            addressComplement: point.addressComplement?.trim() || null,
            neighborhood: location.neighborhood?.trim() || null,
            city: location.city,
            state: location.state,
            postalCode: point.postalCode?.trim() || geocoded?.postalCode || null,
            formattedAddress:
              geocoded?.formattedAddress ??
              this.missionSearchAddress(point),
            latitude: geocoded?.latitude ?? point.latitude,
            longitude: geocoded?.longitude ?? point.longitude,
            notes: this.buildMissionNotes(point.item, dto.notes),
          },
        });
        created.push(order);
      }

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'MISSION_CREATED',
          entityType: 'Mission',
          entityId: reference,
          metadata: {
            reference,
            priority: dto.priority ?? 'NORMAL',
            orderIds: created.map((order) => order.id),
            types: created.map((order) => order.type),
          },
        },
      });

      return { reference, orders: created };
    });
  }

  async cancelMission(user: AuthUser, reference: string) {
    const normalizedReference = reference.trim();
    const orders = await this.prisma.serviceOrder.findMany({
      where: {
        organizationId: user.organizationId,
        externalReference: normalizedReference,
      },
      select: { id: true, code: true, status: true },
    });

    if (orders.length === 0) {
      throw new NotFoundException('Missão não encontrada.');
    }
    if (orders.some((order) => ['IN_PROGRESS', 'COMPLETED'].includes(order.status))) {
      throw new BadRequestException(
        'Não é possível cancelar uma missão em execução ou concluída.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.serviceOrder.updateMany({
        where: {
          organizationId: user.organizationId,
          externalReference: normalizedReference,
        },
        data: { status: 'CANCELLED' },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'MISSION_CANCELLED',
          entityType: 'Mission',
          entityId: normalizedReference,
          metadata: {
            reference: normalizedReference,
            orderIds: orders.map((order) => order.id),
          },
        },
      });
      return { reference: normalizedReference, cancelledStops: result.count };
    });
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    this.assertCoordinatePair(dto.latitude, dto.longitude);
    this.assertTimeWindow(dto.timeWindowStart, dto.timeWindowEnd);
    const plannedDate = parseDateOnly(dto.plannedDate);
    const address = this.formatAddress(dto);
    const geocoded =
      dto.latitude != null && dto.longitude != null
        ? null
        : await this.maps.geocode(address, false);
    const code = dto.code?.trim() || this.generateOrderCode();

    return this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.serviceOrder.findFirst({
        where: { organizationId: user.organizationId, code },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('Já existe uma ordem com este código.');
      }

      let customerId = dto.customerId;
      if (customerId) {
        const customer = await transaction.customer.findFirst({
          where: { id: customerId, organizationId: user.organizationId },
          select: { id: true },
        });
        if (!customer) {
          throw new BadRequestException('Cliente inválido para esta organização.');
        }
      } else {
        const customer = await transaction.customer.create({
          data: {
            organizationId: user.organizationId,
            name: dto.customerName?.trim() || dto.recipientName.trim(),
            phone: dto.recipientPhone?.trim() || null,
          },
        });
        customerId = customer.id;
      }

      const created = await transaction.serviceOrder.create({
        data: {
          organizationId: user.organizationId,
          customerId,
          createdById: user.sub,
          code,
          externalReference: dto.externalReference?.trim() || null,
          type: dto.type,
          status: dto.status ?? 'READY',
          priority: dto.priority ?? 'NORMAL',
          plannedDate,
          timeWindowStart: dto.timeWindowStart ? new Date(dto.timeWindowStart) : null,
          timeWindowEnd: dto.timeWindowEnd ? new Date(dto.timeWindowEnd) : null,
          serviceDurationMin: dto.serviceDurationMin ?? 10,
          weightKg: dto.weightKg,
          volumeM3: dto.volumeM3,
          recipientName: dto.recipientName.trim(),
          recipientPhone: dto.recipientPhone?.trim() || null,
          addressLine: dto.addressLine.trim(),
          addressNumber: dto.addressNumber?.trim() || null,
          addressComplement: dto.addressComplement?.trim() || null,
          neighborhood: dto.neighborhood?.trim() || null,
          city: dto.city.trim(),
          state: dto.state.trim().toUpperCase(),
          postalCode: dto.postalCode?.trim() || null,
          formattedAddress: geocoded?.formattedAddress ?? address,
          latitude: dto.latitude ?? geocoded?.latitude,
          longitude: dto.longitude ?? geocoded?.longitude,
          notes: dto.notes?.trim() || null,
        },
        include: { customer: true },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'ORDER_CREATED',
          entityType: 'ServiceOrder',
          entityId: created.id,
          metadata: { code: created.code, priority: created.priority },
        },
      });

      return created;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto) {
    const existing = await this.findOne(user, id);
    if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestException('Uma ordem concluída ou cancelada não pode ser alterada.');
    }

    this.assertCoordinatePair(dto.latitude, dto.longitude);
    this.assertTimeWindow(
      dto.timeWindowStart ?? existing.timeWindowStart?.toISOString(),
      dto.timeWindowEnd ?? existing.timeWindowEnd?.toISOString(),
    );

    if (dto.customerId !== undefined) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Cliente inválido para esta organização.');
      }
    }
    if (dto.code !== undefined && dto.code !== existing.code) {
      const duplicate = await this.prisma.serviceOrder.findFirst({
        where: {
          organizationId: user.organizationId,
          code: dto.code.trim(),
          NOT: { id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('Já existe uma ordem com este código.');
      }
    }

    const data: Prisma.ServiceOrderUncheckedUpdateInput = {};
    const scalarFields = [
      'code',
      'externalReference',
      'type',
      'status',
      'priority',
      'serviceDurationMin',
      'weightKg',
      'volumeM3',
      'recipientName',
      'recipientPhone',
      'addressLine',
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'city',
      'state',
      'postalCode',
      'notes',
    ] as const;

    for (const field of scalarFields) {
      if (dto[field] !== undefined) {
        (data as unknown as Record<string, unknown>)[field] = dto[field];
      }
    }

    if (dto.customerId !== undefined) {
      data.customerId = dto.customerId;
    }
    if (dto.plannedDate) {
      data.plannedDate = parseDateOnly(dto.plannedDate);
    }
    if (dto.timeWindowStart !== undefined) {
      data.timeWindowStart = dto.timeWindowStart ? new Date(dto.timeWindowStart) : null;
    }
    if (dto.timeWindowEnd !== undefined) {
      data.timeWindowEnd = dto.timeWindowEnd ? new Date(dto.timeWindowEnd) : null;
    }
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      data.latitude = dto.latitude;
      data.longitude = dto.longitude;
    }

    const addressChanged = [
      'addressLine',
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'city',
      'state',
      'postalCode',
    ].some((field) => dto[field as keyof UpdateOrderDto] !== undefined);

    if (addressChanged) {
      const merged = {
        addressLine: dto.addressLine ?? existing.addressLine,
        addressNumber: dto.addressNumber ?? existing.addressNumber ?? undefined,
        addressComplement: dto.addressComplement ?? existing.addressComplement ?? undefined,
        neighborhood: dto.neighborhood ?? existing.neighborhood ?? undefined,
        city: dto.city ?? existing.city,
        state: dto.state ?? existing.state,
        postalCode: dto.postalCode ?? existing.postalCode ?? undefined,
      };
      const address = this.formatAddress(merged);
      if (dto.latitude != null && dto.longitude != null) {
        data.formattedAddress = address;
      } else {
        const geocoded = await this.maps.geocode(address, false);
        data.formattedAddress = geocoded?.formattedAddress ?? address;
        if (geocoded) {
          data.latitude = geocoded.latitude;
          data.longitude = geocoded.longitude;
        } else {
          data.latitude = null;
          data.longitude = null;
        }
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.serviceOrder.update({
        where: { id },
        data,
        include: { customer: true },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'ORDER_UPDATED',
          entityType: 'ServiceOrder',
          entityId: id,
          metadata: { fields: Object.keys(dto) },
        },
      });
      return updated;
    });
  }

  async complete(user: AuthUser, id: string): Promise<ServiceOrder> {
    const existing = await this.prisma.serviceOrder.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        routeStops: {
          where: { status: { notIn: ['COMPLETED', 'FAILED', 'SKIPPED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Missão não encontrada.');
    }
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Uma missão cancelada não pode ser concluída.');
    }
    if (existing.status === 'COMPLETED') {
      return existing;
    }

    if (
      existing.type === 'DELIVERY' &&
      existing.externalReference?.startsWith('MIS-')
    ) {
      const pickup = await this.prisma.serviceOrder.findFirst({
        where: {
          organizationId: user.organizationId,
          externalReference: existing.externalReference,
          type: 'PICKUP',
        },
        select: { status: true },
      });

      if (pickup && pickup.status !== 'COMPLETED') {
        throw new BadRequestException(
          'Conclua a coleta antes de marcar a entrega como realizada.',
        );
      }
    }

    const now = new Date();
    const activeStop = existing.routeStops[0];

    return this.prisma.$transaction(async (transaction) => {
      if (activeStop) {
        await transaction.routeStop.update({
          where: { id: activeStop.id },
          data: {
            status: 'COMPLETED',
            actualArrivalAt: activeStop.actualArrivalAt ?? now,
            actualDepartureAt: now,
          },
        });
      }

      const completed = await transaction.serviceOrder.update({
        where: { id: existing.id },
        data: { status: 'COMPLETED' },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action:
            existing.type === 'PICKUP'
              ? 'MISSION_PICKUP_COMPLETED'
              : 'MISSION_DELIVERY_COMPLETED',
          entityType: 'ServiceOrder',
          entityId: existing.id,
          metadata: {
            code: existing.code,
            reference: existing.externalReference,
            type: existing.type,
            routeStopId: activeStop?.id,
          },
        },
      });

      return completed;
    });
  }

  async cancel(user: AuthUser, id: string): Promise<ServiceOrder> {
    const existing = await this.findOne(user, id);
    if (['IN_PROGRESS', 'COMPLETED'].includes(existing.status)) {
      throw new BadRequestException('Não é possível cancelar uma ordem em execução ou concluída.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const cancelled = await transaction.serviceOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'ORDER_CANCELLED',
          entityType: 'ServiceOrder',
          entityId: id,
          metadata: { code: cancelled.code },
        },
      });
      return cancelled;
    });
  }

  private buildMissionPoint(
    type: 'PICKUP' | 'DELIVERY',
    values: {
      name?: string;
      address?: string;
      formattedAddress?: string;
      addressNumber?: string;
      addressComplement?: string;
      postalCode?: string;
      latitude?: number;
      longitude?: number;
      locationConfirmed?: boolean;
      city?: string;
      neighborhood?: string;
      state?: string;
      item?: string;
      time?: string;
    },
  ): MissionPointInput | null {
    const supplied = [values.name, values.address, values.item, values.time].some(
      (value) => Boolean(value?.trim()),
    );
    if (!supplied) return null;

    if (
      !values.name?.trim() ||
      !values.address?.trim() ||
      !values.addressNumber?.trim() ||
      !values.city?.trim() ||
      !values.item?.trim()
    ) {
      const label = type === 'PICKUP' ? 'coleta' : 'entrega';
      throw new BadRequestException(
        `Preencha nome/local, endereço, número, cidade e o que será feito na ${label}.`,
      );
    }

    if ((values.latitude == null) !== (values.longitude == null)) {
      const label = type === 'PICKUP' ? 'coleta' : 'entrega';
      throw new BadRequestException(
        `Selecione novamente o endereço da ${label} para confirmar a localização.`,
      );
    }

    if (
      values.locationConfirmed !== true ||
      values.latitude == null ||
      values.longitude == null
    ) {
      const label = type === 'PICKUP' ? 'coleta' : 'entrega';
      throw new BadRequestException(
        `Confirme no mapa o ponto exato do GPS da ${label}.`,
      );
    }

    return {
      type,
      name: values.name.trim(),
      address: values.address.trim(),
      addressNumber: values.addressNumber!.trim(),
      addressComplement: values.addressComplement?.trim() || undefined,
      postalCode: values.postalCode?.trim() || undefined,
      formattedAddress: values.formattedAddress?.trim() || undefined,
      latitude: values.latitude,
      longitude: values.longitude,
      locationConfirmed: values.locationConfirmed === true,
      city: values.city.trim(),
      neighborhood: values.neighborhood?.trim() || undefined,
      state: values.state?.trim().toUpperCase() || 'PR',
      item: values.item.trim(),
      time: values.time?.trim() || undefined,
    };
  }

  private missionSearchAddress(point: MissionPointInput): string {
    return [
      [point.address, point.addressNumber].filter(Boolean).join(', '),
      point.addressComplement,
      point.neighborhood,
      `${point.city} - ${point.state ?? 'PR'}`,
      point.postalCode,
      'Brasil',
    ]
      .filter(Boolean)
      .join(', ');
  }

  private async tryGeocode(address: string) {
    try {
      return await this.maps.geocode(address, false);
    } catch {
      return null;
    }
  }

  private missionDateTime(plannedDate: string, time?: string): Date | null {
    if (!time) return null;
    const value = new Date(`${plannedDate}T${time}:00-03:00`);
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Horário inválido na missão.');
    }
    return value;
  }

  private buildMissionNotes(item: string, generalNotes?: string): string {
    const notes = generalNotes?.trim();
    return notes ? `${item.trim()}\nObservação: ${notes}` : item.trim();
  }

  private inferCityAndState(address: string): { city: string; state: string } {
    const cityState = address.match(/,\s*([^,]+?)\s*-\s*([A-Za-z]{2})(?:\s*,|$)/);
    if (cityState?.[1] && cityState[2]) {
      return { city: cityState[1].trim(), state: cityState[2].toUpperCase() };
    }
    const state = address.match(/(?:^|[\s,-])([A-Za-z]{2})(?:\s*$)/)?.[1];
    return { city: 'Informado no endereço', state: state?.toUpperCase() ?? 'PR' };
  }

  private generateMissionCode(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    return `MIS-${timestamp}-${suffix}`;
  }

  private generateOrderCode(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    return `VM-${timestamp}-${suffix}`;
  }

  private assertCoordinatePair(latitude?: number, longitude?: number): void {
    if ((latitude == null) !== (longitude == null)) {
      throw new BadRequestException('Informe latitude e longitude em conjunto.');
    }
  }

  private assertTimeWindow(start?: string, end?: string): void {
    if (!start || !end) return;
    if (new Date(start).getTime() >= new Date(end).getTime()) {
      throw new BadRequestException('O início da janela deve ser anterior ao fim.');
    }
  }

  private formatAddress(dto: {
    addressLine: string;
    addressNumber?: string | null;
    addressComplement?: string | null;
    neighborhood?: string | null;
    city: string;
    state: string;
    postalCode?: string | null;
  }): string {
    return [
      [dto.addressLine, dto.addressNumber].filter(Boolean).join(', '),
      dto.addressComplement,
      dto.neighborhood,
      `${dto.city} - ${dto.state}`,
      dto.postalCode,
      'Brasil',
    ]
      .filter(Boolean)
      .join(', ');
  }
}
