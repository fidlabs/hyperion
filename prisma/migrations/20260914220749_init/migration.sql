-- CreateEnum
CREATE TYPE "PoRepDealState" AS ENUM ('PROPOSED', 'ACCEPTED', 'ACTIVE', 'FINALIZED', 'REJECTED', 'EXPIRED', 'EARLY_TERMINATED');

-- CreateTable
CREATE TABLE "provider" (
    "id" TEXT NOT NULL,
    "num_of_deals" INTEGER NOT NULL,
    "total_deal_size" BIGINT NOT NULL,
    "num_of_clients" INTEGER NOT NULL,
    "last_deal_height" INTEGER NOT NULL,
    "first_deal_height" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_provider_distribution" (
    "client" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "total_deal_size" BIGINT NOT NULL,
    "unique_data_size" BIGINT NOT NULL,
    "claims_count" BIGINT,

    CONSTRAINT "client_provider_distribution_pkey" PRIMARY KEY ("client","provider")
);

-- CreateTable
CREATE TABLE "ipni_publisher_advertisement" (
    "id" TEXT NOT NULL,
    "previous_id" TEXT,
    "publisher_id" TEXT NOT NULL,
    "context_id" TEXT NOT NULL,
    "entries_number" BIGINT NOT NULL,
    "is_rm" BOOLEAN NOT NULL,

    CONSTRAINT "ipni_publisher_advertisement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipni_reporting_daily" (
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" INTEGER NOT NULL,
    "not_reporting" INTEGER NOT NULL,
    "misreporting" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "ipni_reporting_daily_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "po_rep_indexer_run" (
    "date" TIMESTAMP(3) NOT NULL,
    "chainId" BIGINT NOT NULL,
    "runner" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "blockStart" BIGINT NOT NULL,
    "blockEnd" BIGINT NOT NULL,
    "eventsCount" INTEGER NOT NULL,

    CONSTRAINT "po_rep_indexer_run_pkey" PRIMARY KEY ("date","chainId","runner","version")
);

-- CreateTable
CREATE TABLE "po_rep_storage_provider" (
    "providerId" BIGINT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
    "payee" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "availableBytes" BIGINT NOT NULL DEFAULT 0,
    "committedBytes" BIGINT NOT NULL DEFAULT 0,
    "pendingBytes" BIGINT NOT NULL DEFAULT 0,
    "pricePerSectorPerMonth" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "minDealDurationDays" INTEGER NOT NULL DEFAULT 0,
    "maxDealDurationDays" INTEGER NOT NULL DEFAULT 0,
    "registeredAtBlock" BIGINT NOT NULL,

    CONSTRAINT "po_rep_storage_provider_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "po_rep_offer" (
    "offerId" BIGINT NOT NULL,
    "providerId" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minSizeBytes" BIGINT NOT NULL,
    "maxSizeBytes" BIGINT NOT NULL,
    "minDurationEpochs" BIGINT NOT NULL,
    "maxDurationEpochs" BIGINT NOT NULL,
    "retrievabilityBps" INTEGER NOT NULL DEFAULT 0,
    "bandwidthBytesPerSecond" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "indexingPct" INTEGER NOT NULL DEFAULT 0,
    "createdAtBlock" BIGINT NOT NULL,

    CONSTRAINT "po_rep_offer_pkey" PRIMARY KEY ("offerId")
);

-- CreateTable
CREATE TABLE "po_rep_offer_payment" (
    "offerId" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pricePer32GiBPerMonth" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "po_rep_offer_payment_pkey" PRIMARY KEY ("offerId","token")
);

-- CreateTable
CREATE TABLE "po_rep_deal" (
    "dealId" BIGINT NOT NULL,
    "providerId" BIGINT NOT NULL,
    "offerId" BIGINT NOT NULL,
    "client" TEXT NOT NULL,
    "state" "PoRepDealState" NOT NULL,
    "manifestLocation" TEXT NOT NULL,
    "totalDealSize" BIGINT NOT NULL,
    "proposedAtBlock" BIGINT NOT NULL,
    "railId" BIGINT,

    CONSTRAINT "po_rep_deal_pkey" PRIMARY KEY ("dealId")
);

-- CreateTable
CREATE TABLE "po_rep_deal_requirements" (
    "dealId" BIGINT NOT NULL,
    "retrievabilityBps" INTEGER NOT NULL,
    "bandwidthBytesPerSecond" BIGINT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "indexingPct" INTEGER NOT NULL,

    CONSTRAINT "po_rep_deal_requirements_pkey" PRIMARY KEY ("dealId")
);

-- CreateTable
CREATE TABLE "po_rep_deal_terms" (
    "deal_id" BIGINT NOT NULL,
    "deal_size_bytes" BIGINT NOT NULL,
    "price_per_sector_per_month" DECIMAL(78,0) NOT NULL,
    "duration_days" BIGINT NOT NULL,

    CONSTRAINT "po_rep_deal_terms_pkey" PRIMARY KEY ("deal_id")
);

-- CreateTable
CREATE TABLE "po_rep_deal_state_change" (
    "deal_id" BIGINT NOT NULL,
    "state" "PoRepDealState" NOT NULL,
    "changed_at_block" BIGINT NOT NULL,

    CONSTRAINT "po_rep_deal_state_change_pkey" PRIMARY KEY ("deal_id","state")
);

-- CreateTable
CREATE TABLE "filecoin_pay_rail" (
    "railId" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "paymentRate" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "lockupPeriod" BIGINT NOT NULL DEFAULT 0,
    "lockupFixed" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "settledUpTo" BIGINT NOT NULL,
    "endEpoch" BIGINT NOT NULL DEFAULT 0,
    "commissionRateBps" INTEGER NOT NULL,
    "serviceFeeRecipient" TEXT NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAtBlock" BIGINT NOT NULL,
    "activatedAtBlock" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "filecoin_pay_rail_pkey" PRIMARY KEY ("railId")
);

-- CreateTable
CREATE TABLE "filecoin_pay_payment" (
    "id" UUID NOT NULL,
    "railId" BIGINT NOT NULL,
    "totalAmount" DECIMAL(78,0) NOT NULL,
    "netPayeeAmount" DECIMAL(78,0) NOT NULL,
    "operatorCommission" DECIMAL(78,0) NOT NULL,
    "networkFee" DECIMAL(78,0) NOT NULL,
    "createdAtBlock" BIGINT NOT NULL,
    "oneTime" BOOLEAN NOT NULL,

    CONSTRAINT "filecoin_pay_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_provider_distribution_provider_idx" ON "client_provider_distribution"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ipni_publisher_advertisement_previous_id_key" ON "ipni_publisher_advertisement"("previous_id");

-- CreateIndex
CREATE INDEX "ipni_publisher_advertisement_publisher_id_idx" ON "ipni_publisher_advertisement"("publisher_id");

-- CreateIndex
CREATE INDEX "po_rep_deal_state_change_deal_id_state_changed_at_block_idx" ON "po_rep_deal_state_change"("deal_id", "state", "changed_at_block" DESC);

-- CreateIndex
CREATE INDEX "filecoin_pay_rail_createdAtBlock_idx" ON "filecoin_pay_rail"("createdAtBlock" DESC);

-- CreateIndex
CREATE INDEX "filecoin_pay_payment_railId_createdAtBlock_idx" ON "filecoin_pay_payment"("railId", "createdAtBlock" DESC);

-- AddForeignKey
ALTER TABLE "po_rep_offer" ADD CONSTRAINT "po_rep_offer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "po_rep_storage_provider"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_offer_payment" ADD CONSTRAINT "po_rep_offer_payment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "po_rep_offer"("offerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_deal" ADD CONSTRAINT "po_rep_deal_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "po_rep_storage_provider"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_deal" ADD CONSTRAINT "po_rep_deal_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "po_rep_offer"("offerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_deal_requirements" ADD CONSTRAINT "po_rep_deal_requirements_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "po_rep_deal"("dealId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_deal_terms" ADD CONSTRAINT "po_rep_deal_terms_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "po_rep_deal"("dealId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_rep_deal_state_change" ADD CONSTRAINT "po_rep_deal_state_change_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "po_rep_deal"("dealId") ON DELETE RESTRICT ON UPDATE CASCADE;
