import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GeoPoint,
  OptimizableOrder,
  OptimizableVehicle,
  OptimizationContext,
  OptimizationResult,
  OptimizedVehicleRoute,
  RouteOptimizer,
} from './route-optimizer.types';

interface VehicleBucket {
  vehicle: OptimizableVehicle;
  orders: OptimizableOrder[];
  weightKg: number;
  volumeM3: number;
  plan?: PlannedRoute;
}

interface MissionJob {
  id: string;
  orders: OptimizableOrder[];
  assignedVehicleId?: string;
  entryPoint: OptimizableOrder;
  priorityScore: number;
  earliestWindowMs: number;
  weightKg: number;
  volumeM3: number;
}

interface TravelMetric {
  distanceMeters: number;
  durationSeconds: number;
}

interface TravelMatrix {
  points: GeoPoint[];
  indexByKey: Map<string, number>;
  metrics: TravelMetric[][];
  source: 'GEOAPIFY' | 'FALLBACK';
}

interface PlannedRoute extends OptimizedVehicleRoute {
  score: number;
  exceededEndBySeconds: number;
}

interface GeoapifyMatrixCell {
  distance?: number;
  time?: number;
  source_index?: number;
  target_index?: number;
}

interface GeoapifyMatrixResponse {
  sources_to_targets?: GeoapifyMatrixCell[][];
}

const PRIORITY_SCORE: Record<OptimizableOrder['priority'], number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

const PRIORITY_PENALTY_SECONDS: Record<OptimizableOrder['priority'], number> = {
  URGENT: 0,
  HIGH: 1_800,
  NORMAL: 3_600,
  LOW: 5_400,
};

@Injectable()
export class LocalRouteOptimizerService implements RouteOptimizer {
  private readonly logger = new Logger(LocalRouteOptimizerService.name);
  private readonly averageSpeedKmh: number;
  private readonly geoapifyApiKey?: string;

  constructor(config: ConfigService) {
    this.averageSpeedKmh = config.get<number>('LOCAL_AVG_SPEED_KMH', 35);
    this.geoapifyApiKey = config.get<string>('GEOAPIFY_API_KEY')?.trim() || undefined;
  }

  async optimize(context: OptimizationContext): Promise<OptimizationResult> {
    const warnings: string[] = [];
    const matrix = await this.createTravelMatrix(context);

    if (matrix.source === 'FALLBACK') {
      warnings.push(
        'A malha viária não respondeu. A rota foi calculada por aproximação e deve ser conferida antes da saída.',
      );
    }

    const buckets: VehicleBucket[] = context.vehicles.map((vehicle) => ({
      vehicle,
      orders: [],
      weightKg: 0,
      volumeM3: 0,
    }));

    const skippedOrderIds: string[] = [];
    let assignmentSkippedJobs = 0;
    const jobs = this.groupMissionJobs(context.orders).sort((a, b) => {
      const priority = a.priorityScore - b.priorityScore;
      if (priority !== 0) return priority;

      const time = a.earliestWindowMs - b.earliestWindowMs;
      if (time !== 0) return time;

      return (
        this.travelMetric(matrix, context.startLocation, a.entryPoint).durationSeconds -
        this.travelMetric(matrix, context.startLocation, b.entryPoint).durationSeconds
      );
    });

    for (const job of jobs) {
      const matchingBuckets = job.assignedVehicleId
        ? buckets.filter((bucket) => bucket.vehicle.id === job.assignedVehicleId)
        : buckets;
      const feasible = matchingBuckets
        .filter((bucket) => this.hasJobCapacity(bucket, job))
        .map((bucket) => {
          const candidateOrders = [...bucket.orders, ...job.orders];
          const plan = this.planRoute(context, bucket.vehicle, candidateOrders, matrix);
          const currentScore = bucket.plan?.score ?? 0;
          const incrementalScore = Math.max(0, plan.score - currentScore);

          return {
            bucket,
            plan,
            score:
              incrementalScore +
              bucket.orders.length * 180 +
              this.jobCapacityPenalty(bucket, job),
          };
        })
        .sort((a, b) => a.score - b.score);

      const selected = feasible[0];
      if (!selected) {
        skippedOrderIds.push(...job.orders.map((order) => order.id));
        if (job.assignedVehicleId) assignmentSkippedJobs += 1;
        continue;
      }

      selected.bucket.orders.push(...job.orders);
      selected.bucket.weightKg += job.weightKg;
      selected.bucket.volumeM3 += job.volumeM3;
      selected.bucket.plan = selected.plan;
    }

    if (skippedOrderIds.length > 0) {
      warnings.push(
        `${skippedOrderIds.length} parada(s) não couberam na capacidade ou no período informado da frota.`,
      );
    }
    if (assignmentSkippedJobs > 0) {
      warnings.push(
        `${assignmentSkippedJobs} missão(ões) designada(s) não puderam ser alocadas no veículo escolhido.`,
      );
    }

    const plannedRoutes = buckets
      .filter((bucket) => bucket.orders.length > 0)
      .map((bucket) => bucket.plan ?? this.planRoute(context, bucket.vehicle, bucket.orders, matrix));

    for (const route of plannedRoutes) {
      if (route.exceededEndBySeconds > 0) {
        warnings.push(
          `Uma rota ultrapassa o horário final do veículo em aproximadamente ${Math.ceil(route.exceededEndBySeconds / 60)} minuto(s).`,
        );
      }
    }

    const routes: OptimizedVehicleRoute[] = plannedRoutes.map(
      ({ score: _score, exceededEndBySeconds: _exceeded, ...route }) => route,
    );

    return {
      provider: 'LOCAL',
      routes,
      skippedOrderIds,
      warnings: [...new Set(warnings)],
    };
  }

  private groupMissionJobs(orders: OptimizableOrder[]): MissionJob[] {
    const groups = new Map<string, OptimizableOrder[]>();

    for (const order of orders) {
      const key = order.missionId || order.id;
      const current = groups.get(key) ?? [];
      current.push(order);
      groups.set(key, current);
    }

    return [...groups.entries()].map(([id, groupedOrders]) => {
      const ordered = [...groupedOrders].sort((a, b) => {
        if (a.type === b.type) return 0;
        return a.type === 'PICKUP' ? -1 : 1;
      });
      const first = ordered[0];
      if (!first) throw new Error('Uma missão sem paradas não pode ser otimizada.');
      const pickup = ordered.find((order) => order.type === 'PICKUP');
      const timeWindows = ordered
        .map((order) => order.timeWindowStart?.getTime())
        .filter((value): value is number => value != null && Number.isFinite(value));

      const assignedVehicleIds = [
        ...new Set(
          ordered
            .map((order) => order.assignedVehicleId)
            .filter((value): value is string => Boolean(value)),
        ),
      ];

      return {
        id,
        orders: ordered,
        assignedVehicleId: assignedVehicleIds[0],
        entryPoint: pickup ?? first,
        priorityScore: Math.min(...ordered.map((order) => PRIORITY_SCORE[order.priority])),
        earliestWindowMs:
          timeWindows.length > 0 ? Math.min(...timeWindows) : Number.MAX_SAFE_INTEGER,
        weightKg: ordered.reduce((total, order) => total + (order.weightKg ?? 0), 0),
        volumeM3: ordered.reduce((total, order) => total + (order.volumeM3 ?? 0), 0),
      };
    });
  }

  private planRoute(
    context: OptimizationContext,
    vehicle: OptimizableVehicle,
    orders: OptimizableOrder[],
    matrix: TravelMatrix,
  ): PlannedRoute {
    const remaining = [...orders];
    const missionsWithPickup = new Set(
      orders
        .filter((order) => order.type === 'PICKUP' && order.missionId)
        .map((order) => order.missionId as string),
    );
    const completedPickups = new Set<string>();
    let current: GeoPoint = context.startLocation;
    let clock = context.startAt
      ? new Date(context.startAt)
      : this.vehicleStartAt(context.routeDate, vehicle.startHour);
    clock = this.nextAvailableInstant(clock, vehicle);
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    let accumulatedPenalty = 0;
    const points: GeoPoint[] = [context.startLocation];
    const visits: OptimizedVehicleRoute['visits'] = [];

    while (remaining.length > 0) {
      const eligible = remaining.filter(
        (order) =>
          order.type !== 'DELIVERY' ||
          !order.missionId ||
          !missionsWithPickup.has(order.missionId) ||
          completedPickups.has(order.missionId),
      );
      const candidates = eligible.length > 0 ? eligible : remaining;

      const ranked = candidates
        .map((order) => {
          const metric = this.travelMetric(matrix, current, order);
          const travel = this.travelTiming(clock, metric.durationSeconds, vehicle);
          const windowStartMs = order.timeWindowStart?.getTime();
          const windowEndMs = order.timeWindowEnd?.getTime();
          const afterTimeWindow = windowStartMs
            ? new Date(Math.max(travel.arrivalAt.getTime(), windowStartMs))
            : new Date(travel.arrivalAt);
          const serviceStartAt = this.nextServiceStart(
            afterTimeWindow,
            order.serviceDurationMin * 60,
            vehicle,
          );
          const serviceEndAt = new Date(
            serviceStartAt.getTime() + order.serviceDurationMin * 60 * 1_000,
          );
          const waitingSeconds = Math.max(
            0,
            Math.round(
              (serviceStartAt.getTime() - travel.arrivalAt.getTime()) / 1_000,
            ) + travel.waitingSeconds,
          );
          const lateSeconds = windowEndMs
            ? Math.max(0, Math.round((serviceStartAt.getTime() - windowEndMs) / 1_000))
            : 0;
          const deadlineSeconds = windowEndMs
            ? Math.max(0, Math.round((windowEndMs - clock.getTime()) / 1_000))
            : 21_600;
          const deadlinePenalty = Math.min(deadlineSeconds, 21_600) * 0.08;
          const score =
            metric.durationSeconds +
            waitingSeconds * 0.05 +
            lateSeconds * 30 +
            PRIORITY_PENALTY_SECONDS[order.priority] +
            deadlinePenalty;

          return {
            order,
            metric,
            waitingSeconds,
            lateSeconds,
            serviceStartAt,
            serviceEndAt,
            score,
          };
        })
        .sort((a, b) => a.score - b.score);

      const selected = ranked[0];
      if (!selected) break;
      const next = selected.order;
      remaining.splice(remaining.findIndex((order) => order.id === next.id), 1);

      const plannedArrivalAt = selected.serviceStartAt;
      const plannedDepartureAt = selected.serviceEndAt;

      totalDistanceMeters += selected.metric.distanceMeters;
      totalDurationSeconds +=
        selected.metric.durationSeconds + selected.waitingSeconds + next.serviceDurationMin * 60;
      accumulatedPenalty +=
        selected.lateSeconds * 30 + PRIORITY_SCORE[next.priority] * 60;
      clock = plannedDepartureAt;
      current = next;
      points.push(next);

      visits.push({
        orderId: next.id,
        plannedArrivalAt,
        plannedDepartureAt,
        distanceFromPreviousM: selected.metric.distanceMeters,
        durationFromPreviousSec: selected.metric.durationSeconds,
      });

      if (next.type === 'PICKUP' && next.missionId) {
        completedPickups.add(next.missionId);
      }
    }

    const returnMetric = this.travelMetric(matrix, current, context.endLocation);
    const returnTravel = this.travelTiming(clock, returnMetric.durationSeconds, vehicle);
    totalDistanceMeters += returnMetric.distanceMeters;
    totalDurationSeconds += returnMetric.durationSeconds + returnTravel.waitingSeconds;
    points.push(context.endLocation);

    const routeEndAt = returnTravel.arrivalAt;
    const vehicleEndAt = this.vehicleEndAt(context.routeDate, vehicle.endHour);
    const exceededEndBySeconds = vehicleEndAt
      ? Math.max(0, Math.round((routeEndAt.getTime() - vehicleEndAt.getTime()) / 1_000))
      : 0;

    return {
      vehicleId: vehicle.id,
      visits,
      totalDistanceMeters,
      totalDurationSeconds,
      encodedPolyline: this.encodePolyline(points),
      distanceToDepotMeters: returnMetric.distanceMeters,
      durationToDepotSeconds: returnMetric.durationSeconds,
      score: totalDurationSeconds + accumulatedPenalty + exceededEndBySeconds * 20,
      exceededEndBySeconds,
    };
  }

  private hasJobCapacity(bucket: VehicleBucket, job: MissionJob): boolean {
    const weightCapacity = bucket.vehicle.capacityWeightKg;
    const volumeCapacity = bucket.vehicle.capacityVolumeM3;
    const weightOk = weightCapacity == null || bucket.weightKg + job.weightKg <= weightCapacity;
    const volumeOk = volumeCapacity == null || bucket.volumeM3 + job.volumeM3 <= volumeCapacity;
    return weightOk && volumeOk;
  }

  private jobCapacityPenalty(bucket: VehicleBucket, job: MissionJob): number {
    const weightRatio = bucket.vehicle.capacityWeightKg
      ? (bucket.weightKg + job.weightKg) / bucket.vehicle.capacityWeightKg
      : 0;
    const volumeRatio = bucket.vehicle.capacityVolumeM3
      ? (bucket.volumeM3 + job.volumeM3) / bucket.vehicle.capacityVolumeM3
      : 0;
    return Math.max(weightRatio, volumeRatio) * 600;
  }

  private async createTravelMatrix(context: OptimizationContext): Promise<TravelMatrix> {
    const points = this.uniquePoints([
      context.startLocation,
      ...context.orders,
      context.endLocation,
    ]);
    const fallback = this.fallbackMatrix(points);

    if (!this.geoapifyApiKey || points.length < 2) return fallback;

    try {
      const response = await fetch(
        `https://api.geoapify.com/v1/routematrix?apiKey=${encodeURIComponent(this.geoapifyApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'drive',
            traffic: 'approximated',
            type: 'balanced',
            units: 'metric',
            sources: points.map((point) => ({
              location: [point.longitude, point.latitude],
            })),
            targets: points.map((point) => ({
              location: [point.longitude, point.latitude],
            })),
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as GeoapifyMatrixResponse;
      const rows = payload.sources_to_targets;
      if (!rows || rows.length !== points.length) {
        throw new Error('Matriz incompleta');
      }

      const metrics = rows.map((row, sourceIndex) =>
        points.map((_target, targetIndex) => {
          const cell = row[targetIndex];
          const backup = fallback.metrics[sourceIndex]?.[targetIndex] ?? {
            distanceMeters: 0,
            durationSeconds: 60,
          };
          const distanceMeters = Number(cell?.distance);
          const durationSeconds = Number(cell?.time);
          return {
            distanceMeters: Number.isFinite(distanceMeters)
              ? Math.max(0, Math.round(distanceMeters))
              : backup.distanceMeters,
            durationSeconds: Number.isFinite(durationSeconds)
              ? Math.max(0, Math.round(durationSeconds))
              : backup.durationSeconds,
          };
        }),
      );

      return {
        points,
        indexByKey: fallback.indexByKey,
        metrics,
        source: 'GEOAPIFY',
      };
    } catch (error) {
      this.logger.warn(
        `Route Matrix indisponível; usando cálculo local: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      return fallback;
    }
  }

  private fallbackMatrix(points: GeoPoint[]): TravelMatrix {
    const indexByKey = new Map<string, number>();
    points.forEach((point, index) => indexByKey.set(this.pointKey(point), index));

    const metrics = points.map((source) =>
      points.map((target) => {
        const distanceMeters = Math.round(this.distanceMeters(source, target));
        return {
          distanceMeters,
          durationSeconds: distanceMeters === 0 ? 0 : this.travelDurationSeconds(distanceMeters),
        };
      }),
    );

    return { points, indexByKey, metrics, source: 'FALLBACK' };
  }

  private uniquePoints(points: GeoPoint[]): GeoPoint[] {
    const unique = new Map<string, GeoPoint>();
    for (const point of points) unique.set(this.pointKey(point), point);
    return [...unique.values()];
  }

  private travelMetric(matrix: TravelMatrix, from: GeoPoint, to: GeoPoint): TravelMetric {
    const sourceIndex = matrix.indexByKey.get(this.pointKey(from));
    const targetIndex = matrix.indexByKey.get(this.pointKey(to));
    const metric = sourceIndex == null || targetIndex == null
      ? undefined
      : matrix.metrics[sourceIndex]?.[targetIndex];

    if (metric) return metric;

    const distanceMeters = Math.round(this.distanceMeters(from, to));
    return {
      distanceMeters,
      durationSeconds: distanceMeters === 0 ? 0 : this.travelDurationSeconds(distanceMeters),
    };
  }

  private pointKey(point: GeoPoint): string {
    return `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)}`;
  }

  private travelDurationSeconds(distanceMeters: number): number {
    const metersPerSecond = (this.averageSpeedKmh * 1_000) / 3_600;
    return Math.max(60, Math.round(distanceMeters / metersPerSecond));
  }

  private vehicleStartAt(routeDate: Date, startHour?: string): Date {
    const [hour, minute] = (startHour ?? '08:00').split(':').map(Number);
    return new Date(
      Date.UTC(
        routeDate.getUTCFullYear(),
        routeDate.getUTCMonth(),
        routeDate.getUTCDate(),
        (hour ?? 8) + 3,
        minute ?? 0,
      ),
    );
  }

  private vehicleEndAt(routeDate: Date, endHour?: string): Date | null {
    if (!endHour) return null;
    const [hour, minute] = endHour.split(':').map(Number);
    return new Date(
      Date.UTC(
        routeDate.getUTCFullYear(),
        routeDate.getUTCMonth(),
        routeDate.getUTCDate(),
        (hour ?? 18) + 3,
        minute ?? 0,
      ),
    );
  }

  private unavailablePeriods(vehicle: OptimizableVehicle) {
    return [...(vehicle.unavailablePeriods ?? [])]
      .filter((period) => period.endsAt > period.startsAt)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  }

  private nextAvailableInstant(value: Date, vehicle: OptimizableVehicle): Date {
    let result = new Date(value);
    for (const period of this.unavailablePeriods(vehicle)) {
      if (result >= period.startsAt && result < period.endsAt) {
        result = new Date(period.endsAt);
      }
    }
    return result;
  }

  private travelTiming(
    startsAt: Date,
    durationSeconds: number,
    vehicle: OptimizableVehicle,
  ): { arrivalAt: Date; waitingSeconds: number } {
    let departureAt = this.nextAvailableInstant(startsAt, vehicle);
    const periods = this.unavailablePeriods(vehicle);

    for (let guard = 0; guard < periods.length + 2; guard += 1) {
      const arrivalAt = new Date(departureAt.getTime() + durationSeconds * 1_000);
      const conflict = periods.find(
        (period) => period.startsAt < arrivalAt && period.endsAt > departureAt,
      );
      if (!conflict) {
        return {
          arrivalAt,
          waitingSeconds: Math.max(
            0,
            Math.round((departureAt.getTime() - startsAt.getTime()) / 1_000),
          ),
        };
      }
      departureAt = new Date(conflict.endsAt);
    }

    return {
      arrivalAt: new Date(departureAt.getTime() + durationSeconds * 1_000),
      waitingSeconds: Math.max(
        0,
        Math.round((departureAt.getTime() - startsAt.getTime()) / 1_000),
      ),
    };
  }

  private nextServiceStart(
    requestedStart: Date,
    serviceDurationSeconds: number,
    vehicle: OptimizableVehicle,
  ): Date {
    let start = this.nextAvailableInstant(requestedStart, vehicle);
    const periods = this.unavailablePeriods(vehicle);

    for (let guard = 0; guard < periods.length + 2; guard += 1) {
      const end = new Date(start.getTime() + serviceDurationSeconds * 1_000);
      const conflict = periods.find(
        (period) => period.startsAt < end && period.endsAt > start,
      );
      if (!conflict) return start;
      start = new Date(conflict.endsAt);
    }
    return start;
  }

  private distanceMeters(a: GeoPoint, b: GeoPoint): number {
    const earthRadiusM = 6_371_000;
    const latitudeA = this.toRadians(a.latitude);
    const latitudeB = this.toRadians(b.latitude);
    const latitudeDelta = this.toRadians(b.latitude - a.latitude);
    const longitudeDelta = this.toRadians(b.longitude - a.longitude);

    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * earthRadiusM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private encodePolyline(points: GeoPoint[]): string {
    let previousLatitude = 0;
    let previousLongitude = 0;
    let result = '';

    for (const point of points) {
      const latitude = Math.round(point.latitude * 1e5);
      const longitude = Math.round(point.longitude * 1e5);
      result += this.encodeSignedNumber(latitude - previousLatitude);
      result += this.encodeSignedNumber(longitude - previousLongitude);
      previousLatitude = latitude;
      previousLongitude = longitude;
    }
    return result;
  }

  private encodeSignedNumber(value: number): string {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    let output = '';
    while (shifted >= 0x20) {
      output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    output += String.fromCharCode(shifted + 63);
    return output;
  }
}
