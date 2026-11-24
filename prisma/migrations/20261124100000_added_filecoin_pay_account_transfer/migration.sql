-- CreateTable
CREATE TABLE "filecoin_pay_account_transfer" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "createdAtBlock" BIGINT NOT NULL,

    CONSTRAINT "filecoin_pay_account_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filecoin_pay_account_transfer_owner_createdAtBlock_idx" ON "filecoin_pay_account_transfer"("owner", "createdAtBlock" DESC);
