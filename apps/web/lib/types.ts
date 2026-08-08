export type UserRole = 'OWNER' | 'ADMIN' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';

export interface AuthUser {
  sub: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
}

export type OrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type OrderStatus =
  | 'PLANNED'
  | 'READY'
  | 'ROUTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ServiceOrder {
  id: string;
  code: string;
  externalReference?: string | null;
  assignedVehicleId?: string | null;
  assignedVehicle?: {
    id: string;
    name: string;
    plate: string;
    status: 'AVAILABLE' | 'IN_ROUTE' | 'MAINTENANCE' | 'INACTIVE';
    active: boolean;
  } | null;
  type: 'DELIVERY' | 'PICKUP';
  status: OrderStatus;
  priority: OrderPriority;
  plannedDate: string;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  serviceDurationMin: number;
  weightKg?: string | number | null;
  volumeM3?: string | number | null;
  recipientName: string;
  recipientPhone?: string | null;
  addressLine: string;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  formattedAddress?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Horário real registrado quando a coleta ou entrega foi concluída. */
  completedAt?: string | null;
}

export interface AddressSuggestion {
  id: string;
  label: string;
  addressLine: string;
  addressNumber?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  state?: string | null;
  postalCode?: string | null;
  latitude: number;
  longitude: number;
  source?: string | null;
}

export type LocationAccuracy = 'BUILDING' | 'STREET' | 'AREA' | 'UNKNOWN';

export interface GeocodedAddress {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
  city?: string | null;
  neighborhood?: string | null;
  state?: string | null;
  postalCode?: string | null;
  accuracy?: LocationAccuracy;
  confidence?: number | null;
  buildingConfidence?: number | null;
  matchType?: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  name: string;
  status: 'AVAILABLE' | 'IN_ROUTE' | 'MAINTENANCE' | 'INACTIVE';
  capacityWeightKg?: string | number | null;
  capacityVolumeM3?: string | number | null;
  startHour?: string | null;
  endHour?: string | null;
  active: boolean;
  _count?: { routePlans: number };
}

export interface RouteStop {
  id: string;
  type: 'DEPOT_START' | 'SERVICE' | 'DEPOT_END';
  sequence: number;
  status: 'PENDING' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  label: string;
  address: string;
  latitude: string | number;
  longitude: string | number;
  plannedArrivalAt?: string | null;
  actualArrivalAt?: string | null;
  actualDepartureAt?: string | null;
  distanceFromPreviousM: number;
  durationFromPreviousSec: number;
  notes?: string | null;
  serviceOrder?: Pick<
    ServiceOrder,
    | 'id'
    | 'code'
    | 'externalReference'
    | 'priority'
    | 'type'
    | 'status'
    | 'recipientName'
    | 'recipientPhone'
    | 'addressLine'
    | 'addressNumber'
    | 'addressComplement'
    | 'neighborhood'
    | 'city'
    | 'state'
    | 'postalCode'
    | 'formattedAddress'
    | 'latitude'
    | 'longitude'
    | 'timeWindowStart'
    | 'timeWindowEnd'
  > | null;
}

export interface RoutePlan {
  id: string;
  routeDate: string;
  status: 'DRAFT' | 'OPTIMIZED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'SUPERSEDED';
  provider: 'LOCAL' | 'GOOGLE';
  revision: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  encodedPolyline?: string | null;
  vehicle: Vehicle;
  driver?: { id: string; name: string; email: string } | null;
  depot: {
    id: string;
    name: string;
    addressLine: string;
    latitude: string | number;
    longitude: string | number;
  };
  stops: RouteStop[];
}

export interface DashboardSummary {
  date: string;
  metrics: {
    totalOrders: number;
    pendingOrders: number;
    urgentOrders: number;
    completedOrders: number;
    completionRate: number;
    activeRoutes: number;
    completedRoutes: number;
    availableVehicles: number;
  };
  routes: RoutePlan[];
}

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  assignedVehicleId?: string | null;
  assignedVehicle?: Pick<Vehicle, 'id' | 'name' | 'plate' | 'status' | 'active'> | null;
  active: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingPosition {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  heading?: number | null;
  batteryPercent?: number | null;
  recordedAt?: string | null;
  ageSeconds?: number | null;
  stale?: boolean;
}

export interface TrackingSessionSummary {
  id: string;
  active: boolean;
  startedAt: string;
  endedAt?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
  driver: {
    id: string;
    name: string;
    email: string;
  };
  vehicle?: Pick<Vehicle, 'id' | 'name' | 'plate'>;
  position?: TrackingPosition | null;
}

export interface LiveTrackingVehicle {
  vehicle: Pick<Vehicle, 'id' | 'name' | 'plate' | 'status'>;
  session?: Omit<TrackingSessionSummary, 'vehicle' | 'position'> | null;
  position?: TrackingPosition | null;
}

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  heading?: number | null;
  batteryPercent?: number | null;
  recordedAt: string;
}

export interface VehicleUnavailability {
  id: string;
  organizationId: string;
  vehicleId: string;
  createdById?: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  reason: string;
  destinationCity?: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: Pick<Vehicle, 'id' | 'name' | 'plate' | 'active' | 'status'>;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
}
