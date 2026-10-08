-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "defaultResaleMarkupPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "resaleMarkupPct" DECIMAL(5,2),
ADD COLUMN     "sellPrice" DECIMAL(14,2);
