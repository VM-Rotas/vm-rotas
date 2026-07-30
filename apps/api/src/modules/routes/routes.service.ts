import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { formatDateOnly, parseDateOnly } from '../../common/utils/date.utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import type { OptimizeRoutesDto } from './dto/optimize-routes.dto';
import type { RecalculateRouteDto } from './dto/recalculate-route.dto';
import type { UpdateStopStatusDto } from './dto/update-stop-status.dto';
import type {
  OptimizationContext,
  OptimizableOrder,
  OptimizableVehicle,
  OptimizedVehicleRoute,
} from './providers/route-optimizer.types';
import { RouteOptimizationService } from './route-optimization.service';

const FINISHED_STOP_STATUSES = ['COMPLETED', 'FAILED', 'SKIPPED'] as const;

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly optimizer: RouteOptimizationService,
  ) {}

  list(user: AuthUser, query: ListRoutesQueryDto) {
    return this.prisma.routePlan.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query.date ? { routeDate: parseDateOnly(query.date) } : {}),
        ...(query.status ? { status: query.status } : { status: { not: 'SUPERSEDED' } }),
      },
      include: {
        depot: true,
        vehicle: true,
        driver: { select: { id: true, name: true, email: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            serviceOrder: {
              select: { id: true, code: true, priority: true, type: true, recipientPhone: true },
            },
          },
        },
      },
      orderBy: [{ routeDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(user: AuthUser, id: string) {
    const route = await this.prisma.routePlan.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        depot: true,
        vehicle: true,
        driver: { select: { id: true, name: true, email: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          include: { serviceOrder: { include: { customer: true } } },
        },
        optimizationRuns: {
          take: 10,
          orderBy: { startedAt: 'desc' },
        },
      },
    });
    if (!route) throw new NotFoundException('Rota não encontrada.');
    return route;
  }

  async optimize(user: AuthUser, dto: OptimizeRoutesDto) {
    const routeDate = parseDateOnly(dto.routeDate);
    const depot = await this.findDepot(user.organizationId, dto.depotId);
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        status: 'AVAILABLE',
        ...(dto.vehicleIds?.length ? { id: { in: dto.vehicleIds } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    if (vehicles.length === 0) {
      throw new BadRequestException('Nenhum veículo disponível foi encontrado.');
    }

    const selectedVehicleIds = vehicles.map((vehicle) => vehicle.id);
    const candidateOrders = await this.prisma.serviceOrder.findMany({
      where: {
        organizationId: user.organizationId,
        plannedDate: routeDate,
        OR: [
          {
            status: { in: ['PLANNED', 'READY'] },
            ...(dto.orderIds?.length ? { id: { in: dto.orderIds } } : {}),
          },
          {
            status: 'ROUTED',
            routeStops: {
              some: {
                routePlan: {
                  vehicleId: { in: selectedVehicleIds },
                  status: { in: ['DRAFT', 'OPTIMIZED'] },
                },
              },
            },
          },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    const missingCoordinates = candidateOrders.filter(
      (order) => order.latitude == null || order.longitude == null,
    );
    const eligibleOrders = candidateOrders.filter(
      (order) => order.latitude != null && order.longitude != null,
    );
    if (eligibleOrders.length === 0) {
      throw new BadRequestException(
        'Nenhuma ordem pronta e georreferenciada foi encontrada para esta data.',
      );
    }

    const context = this.buildContext(routeDate, depot, eligibleOrders, vehicles);
    const requestedProvider = dto.provider ?? undefined;
    const run = await this.prisma.optimizationRun.create({
      data: {
        organizationId: user.organizationId,
        requestedById: user.sub,
        provider: requestedProvider === 'google' ? 'GOOGLE' : 'LOCAL',
        status: 'PENDING',
        requestPayload: this.toJson({
          routeDate: dto.routeDate,
          depotId: depot.id,
          orderIds: eligibleOrders.map((order) => order.id),
          vehicleIds: vehicles.map((vehicle) => vehicle.id),
          requestedProvider: requestedProvider ?? 'environment-default',
        }),
      },
    });

    try {
      const result = await this.optimizer.optimize(context, requestedProvider);
      if (result.routes.length === 0) {
        throw new BadRequestException(
          'O otimizador não conseguiu gerar nenhuma rota com os dados e capacidades informados.',
        );
      }
      const allSkippedOrderIds = [
        ...new Set([
          ...missingCoordinates.map((order) => order.id),
          ...result.skippedOrderIds,
        ]),
      ];
      const createdRoutes = await this.persistOptimizedRoutes(
        user,
        depot.id,
        routeDate,
        eligibleOrders,
        vehicles,
        result.routes,
        result.provider,
        allSkippedOrderIds,
      );
      const warnings = [...result.warnings];
      if (missingCoordinates.length > 0) {
        warnings.push(
          `${missingCoordinates.length} ordem(ns) ficaram fora por não possuírem latitude e longitude.`,
        );
      }

      await this.prisma.optimizationRun.update({
        where: { id: run.id },
        data: {
          routePlanId: createdRoutes[0]?.id,
          provider: result.provider,
          status: 'SUCCESS',
          completedAt: new Date(),
          responsePayload: this.toJson({
            routeIds: createdRoutes.map((route) => route.id),
            skippedOrderIds: allSkippedOrderIds,
            warnings,
            provider: result.provider,
            rawResponse: result.rawResponse,
          }),
        },
      });

      return {
        date: formatDateOnly(routeDate),
        provider: result.provider,
        routes: createdRoutes,
        skippedOrderIds: allSkippedOrderIds,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida na otimização.';
      await this.prisma.optimizationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message,
        },
      });
      throw error;
    }
  }

  async recalculate(user: AuthUser, routeId: string, dto: RecalculateRouteDto) {
    const route = await this.findOne(user, routeId);
    if (['COMPLETED', 'CANCELLED', 'SUPERSEDED'].includes(route.status)) {
      throw new BadRequestException('Esta rota não pode mais ser recalculada.');
    }
    const hasLatitude = dto.currentLatitude != null;
    const hasLongitude = dto.currentLongitude != null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException('Informe latitude e longitude atuais em conjunto.');
    }

    const recalculationProvider =
      dto.provider ?? (route.provider === 'GOOGLE' ? 'google' : 'local');

    const remainingOrders = route.stops
      .filter(
        (stop) =>
          stop.type === 'SERVICE' &&
          !FINISHED_STOP_STATUSES.includes(
            stop.status as (typeof FINISHED_STOP_STATUSES)[number],
          ) &&
          stop.serviceOrder,
      )
      .map((stop) => stop.serviceOrder!)
      .filter((order) => order.latitude != null && order.longitude != null);

    if (dto.urgentOrderId) {
      const urgent = await this.prisma.serviceOrder.findFirst({
        where: {
          id: dto.urgentOrderId,
          organizationId: user.organizationId,
          status: { in: ['PLANNED', 'READY'] },
        },
        include: { customer: true },
      });
      if (!urgent) throw new BadRequestException('A ordem urgente informada não está disponível.');
      if (urgent.latitude == null || urgent.longitude == null) {
        throw new BadRequestException('A ordem urgente ainda não possui coordenadas.');
      }
      if (!remainingOrders.some((order) => order.id === urgent.id)) {
        remainingOrders.push(urgent);
      }
    }

    if (remainingOrders.length === 0) {
      throw new BadRequestException('Não existem paradas pendentes para recalcular.');
    }

    const lastCompleted = [...route.stops]
      .reverse()
      .find((stop) => FINISHED_STOP_STATUSES.includes(
        stop.status as (typeof FINISHED_STOP_STATUSES)[number],
      ));
    const startLocation =
      hasLatitude && hasLongitude
        ? {
            label: 'Posição atual do veículo',
            address: 'Posição informada no recálculo',
            latitude: dto.currentLatitude!,
            longitude: dto.currentLongitude!,
          }
        : lastCompleted
          ? {
              label: lastCompleted.label,
              address: lastCompleted.address,
              latitude: Number(lastCompleted.latitude),
              longitude: Number(lastCompleted.longitude),
            }
          : {
              label: route.depot.name,
              address: route.depot.addressLine,
              latitude: Number(route.depot.latitude),
              longitude: Number(route.depot.longitude),
            };

    const context: OptimizationContext = {
      routeDate: route.routeDate,
      startLocation,
      endLocation: {
        label: route.depot.name,
        address: route.depot.addressLine,
        latitude: Number(route.depot.latitude),
        longitude: Number(route.depot.longitude),
      },
      orders: remainingOrders.map((order) => this.mapOrder(order)),
      vehicles: [this.mapVehicle(route.vehicle)],
    };

    const run = await this.prisma.optimizationRun.create({
      data: {
        organizationId: user.organizationId,
        routePlanId: route.id,
        requestedById: user.sub,
        provider: recalculationProvider === 'google' ? 'GOOGLE' : 'LOCAL',
        status: 'PENDING',
        requestPayload: this.toJson({
          routeId,
          urgentOrderId: dto.urgentOrderId,
          remainingOrderIds: remainingOrders.map((order) => order.id),
          currentLocation: startLocation,
        }),
      },
    });

    try {
      const result = await this.optimizer.optimize(context, recalculationProvider);
      const optimized = result.routes[0];
      if (!optimized) {
        throw new BadRequestException('O otimizador não gerou uma rota válida.');
      }

      await this.prisma.$transaction(async (transaction) => {
        await transaction.routeStop.deleteMany({
          where: {
            routePlanId: route.id,
            type: { not: 'DEPOT_START' },
            status: { notIn: [...FINISHED_STOP_STATUSES] },
          },
        });
        const lastSequence = await transaction.routeStop.aggregate({
          where: { routePlanId: route.id },
          _max: { sequence: true },
        });
        const startSequence = (lastSequence._max.sequence ?? -1) + 1;
        await transaction.routeStop.createMany({
          data: this.buildRecalculatedStops(
            route.id,
            startSequence,
            route.depot,
            remainingOrders,
            optimized,
          ),
        });
        const maxRevision = await transaction.routePlan.aggregate({
          where: {
            organizationId: user.organizationId,
            routeDate: route.routeDate,
            vehicleId: route.vehicleId,
          },
          _max: { revision: true },
        });
        await transaction.routePlan.update({
          where: { id: route.id },
          data: {
            revision: (maxRevision._max.revision ?? route.revision) + 1,
            provider: result.provider,
            totalDistanceMeters: optimized.totalDistanceMeters,
            totalDurationSeconds: optimized.totalDurationSeconds,
            encodedPolyline: optimized.encodedPolyline,
          },
        });
        await transaction.serviceOrder.updateMany({
          where: {
            id: { in: optimized.visits.map((visit) => visit.orderId) },
            organizationId: user.organizationId,
          },
          data: { status: 'ROUTED' },
        });
        if (result.skippedOrderIds.length > 0) {
          await transaction.serviceOrder.updateMany({
            where: {
              id: { in: result.skippedOrderIds },
              organizationId: user.organizationId,
              status: { in: ['PLANNED', 'READY', 'ROUTED'] },
            },
            data: { status: 'READY' },
          });
        }
        await transaction.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.sub,
            action: 'ROUTE_RECALCULATED',
            entityType: 'RoutePlan',
            entityId: route.id,
            metadata: {
              urgentOrderId: dto.urgentOrderId,
              provider: result.provider,
              pendingStops: optimized.visits.length,
            },
          },
        });
      });

      await this.prisma.optimizationRun.update({
        where: { id: run.id },
        data: {
          provider: result.provider,
          status: 'SUCCESS',
          completedAt: new Date(),
          responsePayload: this.toJson({
            provider: result.provider,
            warnings: result.warnings,
            skippedOrderIds: result.skippedOrderIds,
          }),
        },
      });

      return {
        route: await this.findOne(user, route.id),
        provider: result.provider,
        warnings: result.warnings,
        skippedOrderIds: result.skippedOrderIds,
      };
    } catch (error) {
      await this.prisma.optimizationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Falha desconhecida.',
        },
      });
      throw error;
    }
  }

  async updateStopStatus(
    user: AuthUser,
    routeId: string,
    stopId: string,
    dto: UpdateStopStatusDto,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: {
        id: stopId,
        routePlanId: routeId,
        routePlan: { organizationId: user.organizationId },
      },
      include: { routePlan: true, serviceOrder: true },
    });
    if (!stop) throw new NotFoundException('Parada não encontrada.');
    if (FINISHED_STOP_STATUSES.includes(stop.status as (typeof FINISHED_STOP_STATUSES)[number])) {
      throw new BadRequestException('Esta parada já foi finalizada.');
    }

    const now = new Date();
    const actualArrivalAt = ['ARRIVED', 'COMPLETED', 'FAILED'].includes(dto.status)
      ? stop.actualArrivalAt ?? now
      : stop.actualArrivalAt;
    const actualDepartureAt = FINISHED_STOP_STATUSES.includes(
      dto.status as (typeof FINISHED_STOP_STATUSES)[number],
    )
      ? now
      : stop.actualDepartureAt;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.routeStop.update({
        where: { id: stop.id },
        data: {
          status: dto.status,
          actualArrivalAt,
          actualDepartureAt,
          notes: dto.notes ?? stop.notes,
        },
      });

      if (stop.serviceOrderId) {
        const orderStatus =
          dto.status === 'COMPLETED'
            ? 'COMPLETED'
            : dto.status === 'FAILED'
              ? 'FAILED'
              : dto.status === 'SKIPPED'
                ? 'ROUTED'
                : 'IN_PROGRESS';
        await transaction.serviceOrder.update({
          where: { id: stop.serviceOrderId },
          data: { status: orderStatus },
        });
      }

      if (dto.status === 'EN_ROUTE' || dto.status === 'ARRIVED') {
        await transaction.routePlan.update({
          where: { id: routeId },
          data: { status: 'IN_PROGRESS', startedAt: stop.routePlan.startedAt ?? now },
        });
        await transaction.vehicle.update({
          where: { id: stop.routePlan.vehicleId },
          data: { status: 'IN_ROUTE' },
        });
      }

      const unfinishedServices = await transaction.routeStop.count({
        where: {
          routePlanId: routeId,
          type: 'SERVICE',
          status: { notIn: [...FINISHED_STOP_STATUSES] },
        },
      });
      const depotEndFinished =
        stop.type === 'DEPOT_END' && dto.status === 'COMPLETED';
      if (unfinishedServices === 0 && depotEndFinished) {
        await transaction.routePlan.update({
          where: { id: routeId },
          data: { status: 'COMPLETED', finishedAt: now },
        });
        await transaction.vehicle.update({
          where: { id: stop.routePlan.vehicleId },
          data: { status: 'AVAILABLE' },
        });
      }

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'ROUTE_STOP_STATUS_UPDATED',
          entityType: 'RouteStop',
          entityId: stop.id,
          metadata: { routeId, from: stop.status, to: dto.status },
        },
      });
    });

    return this.findOne(user, routeId);
  }

  private async findDepot(organizationId: string, depotId?: string) {
    const depot = await this.prisma.depot.findFirst({
      where: {
        organizationId,
        active: true,
        ...(depotId ? { id: depotId } : { isDefault: true }),
      },
    });
    if (!depot) throw new BadRequestException('Base operacional não encontrada.');
    return depot;
  }

  private buildContext(
    routeDate: Date,
    depot: {
      name: string;
      addressLine: string;
      latitude: unknown;
      longitude: unknown;
    },
    orders: Parameters<RoutesService['mapOrder']>[0][],
    vehicles: Parameters<RoutesService['mapVehicle']>[0][],
  ): OptimizationContext {
    const depotPoint = {
      label: depot.name,
      address: depot.addressLine,
      latitude: Number(depot.latitude),
      longitude: Number(depot.longitude),
    };
    return {
      routeDate,
      startLocation: depotPoint,
      endLocation: depotPoint,
      orders: orders.map((order) => this.mapOrder(order)),
      vehicles: vehicles.map((vehicle) => this.mapVehicle(vehicle)),
    };
  }

  private mapOrder(order: {
    id: string;
    code: string;
    recipientName: string;
    formattedAddress: string | null;
    addressLine: string;
    city: string;
    state: string;
    type: 'DELIVERY' | 'PICKUP';
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    serviceDurationMin: number;
    weightKg: unknown;
    volumeM3: unknown;
    timeWindowStart: Date | null;
    timeWindowEnd: Date | null;
    latitude: unknown;
    longitude: unknown;
  }): OptimizableOrder {
    return {
      id: order.id,
      code: order.code,
      label: `${order.code} · ${order.recipientName}`,
      address: order.formattedAddress ?? `${order.addressLine}, ${order.city} - ${order.state}`,
      type: order.type,
      priority: order.priority,
      serviceDurationMin: order.serviceDurationMin,
      weightKg: order.weightKg == null ? undefined : Number(order.weightKg),
      volumeM3: order.volumeM3 == null ? undefined : Number(order.volumeM3),
      timeWindowStart: order.timeWindowStart ?? undefined,
      timeWindowEnd: order.timeWindowEnd ?? undefined,
      latitude: Number(order.latitude),
      longitude: Number(order.longitude),
    };
  }

  private mapVehicle(vehicle: {
    id: string;
    plate: string;
    name: string;
    capacityWeightKg: unknown;
    capacityVolumeM3: unknown;
    startHour: string | null;
    endHour: string | null;
  }): OptimizableVehicle {
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      name: vehicle.name,
      capacityWeightKg:
        vehicle.capacityWeightKg == null ? undefined : Number(vehicle.capacityWeightKg),
      capacityVolumeM3:
        vehicle.capacityVolumeM3 == null ? undefined : Number(vehicle.capacityVolumeM3),
      startHour: vehicle.startHour ?? undefined,
      endHour: vehicle.endHour ?? undefined,
    };
  }

  private async persistOptimizedRoutes(
    user: AuthUser,
    depotId: string,
    routeDate: Date,
    orders: Parameters<RoutesService['mapOrder']>[0][],
    vehicles: Parameters<RoutesService['mapVehicle']>[0][],
    optimizedRoutes: OptimizedVehicleRoute[],
    provider: 'LOCAL' | 'GOOGLE',
    unroutedOrderIds: string[],
  ) {
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const depot = await this.prisma.depot.findUniqueOrThrow({ where: { id: depotId } });

    return this.prisma.$transaction(async (transaction) => {
      const vehicleIds = vehicles.map((vehicle) => vehicle.id);
      if (vehicleIds.length > 0) {
        await transaction.routePlan.updateMany({
          where: {
            organizationId: user.organizationId,
            routeDate,
            vehicleId: { in: vehicleIds },
            status: { in: ['DRAFT', 'OPTIMIZED'] },
          },
          data: { status: 'SUPERSEDED' },
        });
      }

      const created = [];
      for (const optimized of optimizedRoutes) {
        const vehicle = vehicleMap.get(optimized.vehicleId);
        if (!vehicle) continue;
        const maxRevision = await transaction.routePlan.aggregate({
          where: {
            organizationId: user.organizationId,
            routeDate,
            vehicleId: vehicle.id,
          },
          _max: { revision: true },
        });
        const route = await transaction.routePlan.create({
          data: {
            organizationId: user.organizationId,
            depotId,
            vehicleId: vehicle.id,
            routeDate,
            status: 'OPTIMIZED',
            provider,
            revision: (maxRevision._max.revision ?? 0) + 1,
            totalDistanceMeters: optimized.totalDistanceMeters,
            totalDurationSeconds: optimized.totalDurationSeconds,
            encodedPolyline: optimized.encodedPolyline,
            stops: {
              create: this.buildInitialStops(depot, orderMap, optimized),
            },
          },
          include: {
            depot: true,
            vehicle: true,
            stops: {
              orderBy: { sequence: 'asc' },
              include: { serviceOrder: true },
            },
          },
        });
        created.push(route);
      }

      const routedOrderIds = optimizedRoutes.flatMap((route) =>
        route.visits.map((visit) => visit.orderId),
      );
      if (routedOrderIds.length > 0) {
        await transaction.serviceOrder.updateMany({
          where: { id: { in: routedOrderIds }, organizationId: user.organizationId },
          data: { status: 'ROUTED' },
        });
      }
      if (unroutedOrderIds.length > 0) {
        await transaction.serviceOrder.updateMany({
          where: {
            id: { in: unroutedOrderIds },
            organizationId: user.organizationId,
            status: { in: ['PLANNED', 'READY', 'ROUTED'] },
          },
          data: { status: 'READY' },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'ROUTES_OPTIMIZED',
          entityType: 'RoutePlan',
          metadata: {
            date: formatDateOnly(routeDate),
            routeIds: created.map((route) => route.id),
            provider,
          },
        },
      });
      return created;
    });
  }

  private buildInitialStops(
    depot: {
      name: string;
      addressLine: string;
      latitude: unknown;
      longitude: unknown;
    },
    orderMap: Map<string, Parameters<RoutesService['mapOrder']>[0]>,
    optimized: OptimizedVehicleRoute,
  ): Prisma.RouteStopCreateWithoutRoutePlanInput[] {
    const serviceStops = optimized.visits.flatMap((visit, index) => {
      const order = orderMap.get(visit.orderId);
      if (!order) return [];
      return [
        {
          type: 'SERVICE' as const,
          sequence: index + 1,
          label: `${order.code} · ${order.recipientName}`,
          address: order.formattedAddress ?? `${order.addressLine}, ${order.city} - ${order.state}`,
          latitude: Number(order.latitude),
          longitude: Number(order.longitude),
          plannedArrivalAt: visit.plannedArrivalAt,
          plannedDepartureAt: visit.plannedDepartureAt,
          distanceFromPreviousM: visit.distanceFromPreviousM,
          durationFromPreviousSec: visit.durationFromPreviousSec,
          serviceOrder: { connect: { id: order.id } },
        },
      ];
    });

    return [
      {
        type: 'DEPOT_START',
        sequence: 0,
        label: `Saída · ${depot.name}`,
        address: depot.addressLine,
        latitude: Number(depot.latitude),
        longitude: Number(depot.longitude),
      },
      ...serviceStops,
      {
        type: 'DEPOT_END',
        sequence: serviceStops.length + 1,
        label: `Retorno · ${depot.name}`,
        address: depot.addressLine,
        latitude: Number(depot.latitude),
        longitude: Number(depot.longitude),
        distanceFromPreviousM: optimized.distanceToDepotMeters,
        durationFromPreviousSec: optimized.durationToDepotSeconds,
      },
    ];
  }

  private buildRecalculatedStops(
    routePlanId: string,
    startSequence: number,
    depot: {
      name: string;
      addressLine: string;
      latitude: unknown;
      longitude: unknown;
    },
    orders: Parameters<RoutesService['mapOrder']>[0][],
    optimized: OptimizedVehicleRoute,
  ): Prisma.RouteStopCreateManyInput[] {
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const stops: Prisma.RouteStopCreateManyInput[] = [];
    optimized.visits.forEach((visit, index) => {
      const order = orderMap.get(visit.orderId);
      if (!order) return;
      stops.push({
        routePlanId,
        serviceOrderId: order.id,
        type: 'SERVICE',
        sequence: startSequence + index,
        label: `${order.code} · ${order.recipientName}`,
        address: order.formattedAddress ?? `${order.addressLine}, ${order.city} - ${order.state}`,
        latitude: Number(order.latitude),
        longitude: Number(order.longitude),
        plannedArrivalAt: visit.plannedArrivalAt,
        plannedDepartureAt: visit.plannedDepartureAt,
        distanceFromPreviousM: visit.distanceFromPreviousM,
        durationFromPreviousSec: visit.durationFromPreviousSec,
      });
    });
    stops.push({
      routePlanId,
      type: 'DEPOT_END',
      sequence: startSequence + optimized.visits.length,
      label: `Retorno · ${depot.name}`,
      address: depot.addressLine,
      latitude: Number(depot.latitude),
      longitude: Number(depot.longitude),
      distanceFromPreviousM: optimized.distanceToDepotMeters,
      durationFromPreviousSec: optimized.durationToDepotSeconds,
    });
    return stops;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
