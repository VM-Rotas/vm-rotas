export const serviceOrderTypes = ['DELIVERY', 'PICKUP'] as const;
export type ServiceOrderType = (typeof serviceOrderTypes)[number];

export const orderPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type OrderPriority = (typeof orderPriorities)[number];

export const serviceOrderStatuses = [
  'PLANNED',
  'READY',
  'ROUTED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ServiceOrderStatus = (typeof serviceOrderStatuses)[number];

export const routeStatuses = [
  'DRAFT',
  'OPTIMIZED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'SUPERSEDED',
] as const;
export type RouteStatus = (typeof routeStatuses)[number];

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp?: string;
  path?: string;
}
