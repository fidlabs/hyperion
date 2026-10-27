-- AlterTable
ALTER TABLE "po_rep_deal" ADD COLUMN     "manifestHash" TEXT;

-- CreateIndex
CREATE INDEX "po_rep_deal_client_manifestHash_idx" ON "po_rep_deal"("client", "manifestHash");
