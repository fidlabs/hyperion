-- AlterTable
ALTER TABLE "filecoin_pay_account_transfer" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "filecoin_pay_payment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
