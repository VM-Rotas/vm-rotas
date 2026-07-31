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
  neighborhood?: string | null;
  city: string;
  state: string;
  formattedAddress?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  notes?: string | null;
}


export interface AddressSuggestion {
  id: string;
  label: string;
  primaryText: string;
  secondaryText?: string;
  latitude: number;
  longitude: number;
  city?: string;
  neighborhood?: string;
  state?: string;
  postalCode?: string;
  source: 'HISTORY' | 'OPENSTREETMAP';
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
  distanceFromPreviousM: number;
  durationFromPreviousSec: number;
  notes?: string | null;
  serviceOrder?: Pick<
    ServiceOrder,
    'id' | 'code' | 'priority' | 'type' | 'recipientPhone'
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
  active: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
