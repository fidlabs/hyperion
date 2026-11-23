-- CreateTable
CREATE TABLE "filecoin_pay_account_state" (
    "token" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "funds" DECIMAL(78,0) NOT NULL,
    "lockupCurrent" DECIMAL(78,0) NOT NULL,
    "lockupRate" DECIMAL(78,0) NOT NULL,
    "lockupLastSettledAt" BIGINT NOT NULL,
    "createdAtBlock" BIGINT NOT NULL,

    CONSTRAINT "filecoin_pay_account_state_pkey" PRIMARY KEY ("token","owner","createdAtBlock")
);

-- CreateIndex
CREATE INDEX "filecoin_pay_account_state_owner_createdAtBlock_idx" ON "filecoin_pay_account_state"("owner", "createdAtBlock" DESC);
