-- Permite designar previamente um veículo para uma missão.
ALTER TABLE "ServiceOrder" ADD COLUMN "assignedVehicleId" UUID;

CREATE INDEX "ServiceOrder_assigned_vehicle_plan_idx"
ON "ServiceOrder"("organizationId", "assignedVehicleId", "plannedDate", "status");

ALTER TABLE "ServiceOrder"
ADD CONSTRAINT "ServiceOrder_assignedVehicleId_fkey"
FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
