-- CreateEnum
CREATE TYPE "PoRepDealType" AS ENUM ('NONE', 'PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "po_rep_deal" ADD COLUMN     "dealType" "PoRepDealType" NOT NULL DEFAULT 'NONE';
