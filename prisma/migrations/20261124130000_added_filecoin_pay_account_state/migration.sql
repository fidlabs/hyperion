-- CreateTable
CREATE TABLE "filecoin_pay_account_state" (
    "owner" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funds" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "lockupCurrent" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "lockupRate" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "lockupLastSettledAt" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "filecoin_pay_account_state_pkey" PRIMARY KEY ("owner","token")
);
