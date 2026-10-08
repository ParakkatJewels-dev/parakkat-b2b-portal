-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "isIndependent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AgencyApplication" ADD COLUMN     "isIndependent" BOOLEAN NOT NULL DEFAULT false;
