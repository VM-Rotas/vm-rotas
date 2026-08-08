-- Vincula uma conta de motorista a no máximo um veículo da frota.
ALTER TABLE "User" ADD COLUMN "assignedVehicleId" UUID;

CREATE UNIQUE INDEX "User_assignedVehicleId_key"
ON "User"("assignedVehicleId");

ALTER TABLE "User"
ADD CONSTRAINT "User_assignedVehicleId_fkey"
FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
