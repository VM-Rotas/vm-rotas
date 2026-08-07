export type OptimizationProviderName = 'LOCAL' | 'GOOGLE';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface OptimizableOrder extends GeoPoint {
  id: string;
  code: string;
  missionId?: string;
  assignedVehicleId?: string;
  label: string;
  address: string;
  type: 'DELIVERY' | 'PICKUP';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  serviceDurationMin: number;
  weightKg?: number;
  volumeM3?: number;
  timeWindowStart?: Date;
  timeWindowEnd?: Date;
}

export interface OptimizableVehicle {
  id: string;
  plate: string;
  name: string;
  capacityWeightKg?: number;
  capacityVolumeM3?: number;
  startHour?: string;
  endHour?: string;
}

export interface OptimizationContext {
  routeDate: Date;
  /** Momento real a partir do qual o trecho deve ser planejado (usado em recálculos). */
  startAt?: Date;
  startLocation: GeoPoint & { label: string; address: string };
  endLocation: GeoPoint & { label: string; address: string };
  orders: OptimizableOrder[];
  vehicles: OptimizableVehicle[];
}

export interface OptimizedVisit {
  orderId: string;
  plannedArrivalAt: Date;
  plannedDepartureAt: Date;
  distanceFromPreviousM: number;
  durationFromPreviousSec: number;
}

export interface OptimizedVehicleRoute {
  vehicleId: string;
  visits: OptimizedVisit[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  encodedPolyline?: string;
  distanceToDepotMeters: number;
  durationToDepotSeconds: number;
}

export interface OptimizationResult {
  provider: OptimizationProviderName;
  routes: OptimizedVehicleRoute[];
  skippedOrderIds: string[];
  warnings: string[];
  rawRequest?: unknown;
  rawResponse?: unknown;
}

export interface RouteOptimizer {
  optimize(context: OptimizationContext): Promise<OptimizationResult>;
}
