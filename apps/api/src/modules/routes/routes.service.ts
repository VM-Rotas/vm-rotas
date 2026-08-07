import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { formatDateOnly, parseDateOnly } from '../../common/utils/date.utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleUnavailabilityService } from '../vehicles/vehicle-unavailability.service';
import type { AutoRecalculateUrgencyDto } from './dto/auto-recalculate-urgency.dto';
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
    private readonly vehicleUnavailability: VehicleUnavailabilityService,
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
              select: {
                id: true,
                code: true,
                externalReference: true,
                priority: true,
                type: true,
                status: true,
                recipientName: true,
                recipientPhone: true,
                timeWindowStart: true,
                timeWindowEnd: true,
              },
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
    const availableVehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        status: 'AVAILABLE',
        ...(dto.vehicleIds?.length ? { id: { in: dto.vehicleIds } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    const unavailableByVehicle = await this.vehicleUnavailability.periodsByVehicle(
      user.organizationId,
      availableVehicles.map((vehicle) => vehicle.id),
      routeDate,
    );
    const vehicles = availableVehicles.filter(
      (vehicle) => !(unavailableByVehicle.get(vehicle.id) ?? []).some((period) => period.allDay),
    );
    if (vehicles.length === 0) {
      throw new BadRequestException(
        'Nenhum veículo disponível foi encontrado. Confira também a agenda programada da frota.',
      );
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
    const assignmentUnavailableOrders = candidateOrders.filter(
      (order) =>
        order.assignedVehicleId != null &&
        !selectedVehicleIds.includes(order.assignedVehicleId),
    );
    const assignmentUnavailableIds = new Set(
      assignmentUnavailableOrders.map((order) => order.id),
    );
    const missingCoordinates = candidateOrders.filter(
      (order) =>
        !assignmentUnavailableIds.has(order.id) &&
        (order.latitude == null || order.longitude == null),
    );
    const eligibleOrders = candidateOrders.filter(
      (order) =>
        !assignmentUnavailableIds.has(order.id) &&
        order.latitude != null &&
        order.longitude != null,
    );
    if (eligibleOrders.length === 0) {
      if (assignmentUnavailableOrders.length > 0) {
        throw new BadRequestException(
          'As missões estão designadas a veículos que não estão disponíveis para esta roteirização.',
        );
      }
      throw new BadRequestException(
        'Nenhuma ordem pronta e georreferenciada foi encontrada para esta data.',
      );
    }

    const context = this.buildContext(
      routeDate,
      depot,
      eligibleOrders,
      vehicles,
      unavailableByVehicle,
    );
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
          assignments: eligibleOrders
            .filter((order) => order.assignedVehicleId)
            .map((order) => ({
              orderId: order.id,
              assignedVehicleId: order.assignedVehicleId,
            })),
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
          ...assignmentUnavailableOrders.map((order) => order.id),
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
      if (assignmentUnavailableOrders.length > 0) {
        warnings.push(
          `${assignmentUnavailableOrders.length} parada(s) ficaram pendentes porque o veículo designado não estava disponível.`,
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

    // Se o motorista já está a caminho ou chegou a uma parada, essa parada fica
    // travada. Sem GPS em tempo real, reorganizá-la no meio do deslocamento seria
    // confuso; o recálculo começa a partir dela e altera somente o que vem depois.
    const lockedActiveStop = !hasLatitude
      ? route.stops.find(
          (stop) =>
            stop.type === 'SERVICE' &&
            ['EN_ROUTE', 'ARRIVED'].includes(stop.status) &&
            stop.serviceOrder,
        )
      : undefined;
    const remainingOrders = route.stops
      .filter(
        (stop) =>
          stop.type === 'SERVICE' &&
          stop.id !== lockedActiveStop?.id &&
          !FINISHED_STOP_STATUSES.includes(
            stop.status as (typeof FINISHED_STOP_STATUSES)[number],
          ) &&
          stop.serviceOrder,
      )
      .map((stop) => stop.serviceOrder!)
      .filter((order) => order.latitude != null && order.longitude != null);

    if (dto.urgentOrderId) {
      const selectedUrgent = await this.prisma.serviceOrder.findFirst({
        where: {
          id: dto.urgentOrderId,
          organizationId: user.organizationId,
          status: { in: ['PLANNED', 'READY'] },
        },
        include: { customer: true },
      });
      if (!selectedUrgent) {
        throw new BadRequestException('A missão urgente informada não está disponível.');
      }

      const urgentOrders = selectedUrgent.externalReference?.startsWith('MIS-')
        ? await this.prisma.serviceOrder.findMany({
            where: {
              organizationId: user.organizationId,
              externalReference: selectedUrgent.externalReference,
              status: { in: ['PLANNED', 'READY'] },
            },
            include: { customer: true },
            orderBy: { type: 'desc' },
          })
        : [selectedUrgent];

      if (urgentOrders.some((order) => order.latitude == null || order.longitude == null)) {
        throw new BadRequestException('A missão urgente ainda possui local sem coordenadas.');
      }
      const designatedVehicleIds = [
        ...new Set(
          urgentOrders
            .map((order) => order.assignedVehicleId)
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (designatedVehicleIds.length > 1) {
        throw new BadRequestException('A missão possui designações de veículo inconsistentes.');
      }
      if (designatedVehicleIds[0] && designatedVehicleIds[0] !== route.vehicleId) {
        throw new BadRequestException(
          'Esta urgência foi designada a outro veículo e não pode entrar nesta rota.',
        );
      }
      for (const urgent of urgentOrders) {
        if (!remainingOrders.some((order) => order.id === urgent.id)) {
          remainingOrders.push(urgent);
        }
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
        : lockedActiveStop
          ? {
              label: lockedActiveStop.label,
              address: lockedActiveStop.address,
              latitude: Number(lockedActiveStop.latitude),
              longitude: Number(lockedActiveStop.longitude),
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

    const routeUnavailablePeriods = (
      await this.vehicleUnavailability.periodsByVehicle(
        user.organizationId,
        [route.vehicle.id],
        route.routeDate,
      )
    ).get(route.vehicle.id) ?? [];

    const context: OptimizationContext = {
      routeDate: route.routeDate,
      startAt: hasLatitude
        ? new Date()
        : this.recalculationStartAt(lockedActiveStop, route.status),
      startLocation,
      endLocation: {
        label: route.depot.name,
        address: route.depot.addressLine,
        latitude: Number(route.depot.latitude),
        longitude: Number(route.depot.longitude),
      },
      orders: remainingOrders.map((order) => this.mapOrder(order)),
      vehicles: [this.mapVehicle(route.vehicle, routeUnavailablePeriods)],
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
            ...(lockedActiveStop ? { id: { not: lockedActiveStop.id } } : {}),
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

  async recalculateUrgency(user: AuthUser, dto: AutoRecalculateUrgencyDto) {
    const selectedUrgent = await this.prisma.serviceOrder.findFirst({
      where: {
        id: dto.urgentOrderId,
        organizationId: user.organizationId,
        status: { in: ['PLANNED', 'READY'] },
      },
      include: { customer: true },
    });

    if (!selectedUrgent) {
      throw new BadRequestException('A missão urgente informada não está disponível.');
    }
    if (selectedUrgent.priority !== 'URGENT') {
      throw new BadRequestException('Selecione uma missão marcada como urgente.');
    }

    const urgentOrders = selectedUrgent.externalReference?.startsWith('MIS-')
      ? await this.prisma.serviceOrder.findMany({
          where: {
            organizationId: user.organizationId,
            externalReference: selectedUrgent.externalReference,
            status: { in: ['PLANNED', 'READY'] },
          },
          include: { customer: true },
        })
      : [selectedUrgent];

    if (urgentOrders.some((order) => order.latitude == null || order.longitude == null)) {
      throw new BadRequestException('A missão urgente ainda possui local sem coordenadas.');
    }

    const designatedVehicleIds = [
      ...new Set(
        urgentOrders
          .map((order) => order.assignedVehicleId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (designatedVehicleIds.length > 1) {
      throw new BadRequestException('A missão possui designações de veículo inconsistentes.');
    }
    const designatedVehicleId = designatedVehicleIds[0];

    const activeRoutes = await this.prisma.routePlan.findMany({
      where: {
        organizationId: user.organizationId,
        routeDate: selectedUrgent.plannedDate,
        status: { in: ['OPTIMIZED', 'IN_PROGRESS'] },
      },
      include: {
        depot: true,
        vehicle: true,
        stops: {
          orderBy: { sequence: 'asc' },
          include: { serviceOrder: { include: { customer: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (activeRoutes.length === 0) {
      throw new BadRequestException(
        'Ainda não existem rotas ativas para este dia. Gere as rotas antes de inserir a urgência.',
      );
    }

    const routesToEvaluate = designatedVehicleId
      ? activeRoutes.filter((route) => route.vehicleId === designatedVehicleId)
      : activeRoutes;

    if (routesToEvaluate.length === 0) {
      throw new BadRequestException(
        'O veículo designado para a urgência não possui uma rota ativa neste dia.',
      );
    }

    let best:
      | {
          routeId: string;
          vehicleId: string;
          vehicleName: string;
          vehiclePlate: string;
          addedDurationSeconds: number;
          score: number;
        }
      | undefined;

    for (const route of routesToEvaluate) {
      const lockedActiveStop = route.stops.find(
        (stop) =>
          stop.type === 'SERVICE' &&
          ['EN_ROUTE', 'ARRIVED'].includes(stop.status) &&
          stop.serviceOrder,
      );
      const pendingStops = route.stops.filter(
        (stop) =>
          stop.type === 'SERVICE' &&
          stop.id !== lockedActiveStop?.id &&
          !FINISHED_STOP_STATUSES.includes(
            stop.status as (typeof FINISHED_STOP_STATUSES)[number],
          ) &&
          stop.serviceOrder,
      );
      const remainingOrders = pendingStops.map((stop) => stop.serviceOrder!);

      for (const urgent of urgentOrders) {
        if (!remainingOrders.some((order) => order.id === urgent.id)) {
          remainingOrders.push(urgent);
        }
      }

      const lastFinished = [...route.stops]
        .reverse()
        .find((stop) =>
          FINISHED_STOP_STATUSES.includes(
            stop.status as (typeof FINISHED_STOP_STATUSES)[number],
          ),
        );
      const startAnchor = lockedActiveStop ?? lastFinished;
      const startLocation = startAnchor
        ? {
            label: startAnchor.label,
            address: startAnchor.address,
            latitude: Number(startAnchor.latitude),
            longitude: Number(startAnchor.longitude),
          }
        : {
            label: route.depot.name,
            address: route.depot.addressLine,
            latitude: Number(route.depot.latitude),
            longitude: Number(route.depot.longitude),
          };
      const routeUnavailablePeriods = (
        await this.vehicleUnavailability.periodsByVehicle(
          user.organizationId,
          [route.vehicle.id],
          route.routeDate,
        )
      ).get(route.vehicle.id) ?? [];
      const context: OptimizationContext = {
        routeDate: route.routeDate,
        startAt: this.recalculationStartAt(lockedActiveStop, route.status),
        startLocation,
        endLocation: {
          label: route.depot.name,
          address: route.depot.addressLine,
          latitude: Number(route.depot.latitude),
          longitude: Number(route.depot.longitude),
        },
        orders: remainingOrders.map((order) => this.mapOrder(order)),
        vehicles: [this.mapVehicle(route.vehicle, routeUnavailablePeriods)],
      };

      const candidateResult = await this.optimizer.optimize(context, 'local');
      const candidate = candidateResult.routes[0];
      if (!candidate) continue;

      const currentRemainingSeconds =
        pendingStops.reduce(
          (total, stop) =>
            total +
            stop.durationFromPreviousSec +
            (stop.serviceOrder?.serviceDurationMin ?? 0) * 60,
          0,
        ) +
        (route.stops.find(
          (stop) =>
            stop.type === 'DEPOT_END' &&
            !FINISHED_STOP_STATUSES.includes(
              stop.status as (typeof FINISHED_STOP_STATUSES)[number],
            ),
        )?.durationFromPreviousSec ?? 0);
      const addedDurationSeconds = Math.max(
        0,
        candidate.totalDurationSeconds - currentRemainingSeconds,
      );
      const score = addedDurationSeconds + candidate.totalDurationSeconds * 0.02;

      if (!best || score < best.score) {
        best = {
          routeId: route.id,
          vehicleId: route.vehicle.id,
          vehicleName: route.vehicle.name,
          vehiclePlate: route.vehicle.plate,
          addedDurationSeconds,
          score,
        };
      }
    }

    if (!best) {
      throw new BadRequestException(
        'Não foi possível encontrar um veículo disponível para a urgência.',
      );
    }

    const recalculated = await this.recalculate(user, best.routeId, {
      urgentOrderId: dto.urgentOrderId,
      provider: 'local',
    });

    return {
      ...recalculated,
      selectedVehicle: {
        id: best.vehicleId,
        name: best.vehicleName,
        plate: best.vehiclePlate,
      },
      estimatedAddedDurationSeconds: best.addedDurationSeconds,
    };
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

        if (dto.status === 'COMPLETED' && stop.serviceOrder) {
          await transaction.auditLog.create({
            data: {
              organizationId: user.organizationId,
              userId: user.sub,
              action:
                stop.serviceOrder.type === 'PICKUP'
                  ? 'MISSION_PICKUP_COMPLETED'
                  : 'MISSION_DELIVERY_COMPLETED',
              entityType: 'ServiceOrder',
              entityId: stop.serviceOrder.id,
              metadata: {
                code: stop.serviceOrder.code,
                reference: stop.serviceOrder.externalReference,
                type: stop.serviceOrder.type,
                routeStopId: stop.id,
                routeId,
              },
            },
          });
        }
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

  private recalculationStartAt(
    lockedStop: { plannedDepartureAt: Date | null } | undefined,
    routeStatus: string,
  ): Date | undefined {
    const now = Date.now();
    if (lockedStop?.plannedDepartureAt) {
      return new Date(Math.max(now, lockedStop.plannedDepartureAt.getTime()));
    }
    return lockedStop || routeStatus === 'IN_PROGRESS' ? new Date(now) : undefined;
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
    unavailableByVehicle: Map<
      string,
      Array<{ startsAt: Date; endsAt: Date; allDay: boolean; reason: string }>
    > = new Map(),
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
      vehicles: vehicles.map((vehicle) =>
        this.mapVehicle(vehicle, unavailableByVehicle.get(vehicle.id) ?? []),
      ),
    };
  }

  private mapOrder(order: {
    id: string;
    code: string;
    externalReference: string | null;
    assignedVehicleId: string | null;
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
    notes: string | null;
    latitude: unknown;
    longitude: unknown;
  }): OptimizableOrder {
    return {
      id: order.id,
      code: order.code,
      missionId: order.externalReference?.startsWith('MIS-')
        ? order.externalReference
        : undefined,
      assignedVehicleId: order.assignedVehicleId ?? undefined,
      label: `${order.type === 'PICKUP' ? 'Coletar em' : 'Entregar em'} ${order.recipientName}`,
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

  private mapVehicle(
    vehicle: {
      id: string;
      plate: string;
      name: string;
      capacityWeightKg: unknown;
      capacityVolumeM3: unknown;
      startHour: string | null;
      endHour: string | null;
    },
    unavailablePeriods: Array<{
      startsAt: Date;
      endsAt: Date;
      allDay?: boolean;
      reason?: string;
    }> = [],
  ): OptimizableVehicle {
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
      unavailablePeriods,
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
          label: `${order.type === 'PICKUP' ? 'Coletar em' : 'Entregar em'} ${order.recipientName}`,
          address: order.formattedAddress ?? `${order.addressLine}, ${order.city} - ${order.state}`,
          latitude: Number(order.latitude),
          longitude: Number(order.longitude),
          plannedArrivalAt: visit.plannedArrivalAt,
          plannedDepartureAt: visit.plannedDepartureAt,
          distanceFromPreviousM: visit.distanceFromPreviousM,
          durationFromPreviousSec: visit.durationFromPreviousSec,
          notes: order.notes,
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
        label: `${order.type === 'PICKUP' ? 'Coletar em' : 'Entregar em'} ${order.recipientName}`,
        address: order.formattedAddress ?? `${order.addressLine}, ${order.city} - ${order.state}`,
        latitude: Number(order.latitude),
        longitude: Number(order.longitude),
        plannedArrivalAt: visit.plannedArrivalAt,
        plannedDepartureAt: visit.plannedDepartureAt,
        distanceFromPreviousM: visit.distanceFromPreviousM,
        durationFromPreviousSec: visit.durationFromPreviousSec,
        notes: order.notes,
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
