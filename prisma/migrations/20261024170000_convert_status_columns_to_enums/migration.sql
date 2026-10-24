-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CAPTURE', 'SETTLEMENT', 'DENY', 'CANCEL', 'EXPIRE', 'FAILURE', 'REFUND', 'CHARGEBACK', 'PARTIAL_REFUND', 'PARTIAL_CHARGEBACK', 'AUTHORIZE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "payment_transactions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payment_transactions" ALTER COLUMN "status" TYPE "PaymentStatus" USING ("status"::text::"PaymentStatus");
ALTER TABLE "payment_transactions" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "outbox_events" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "outbox_events" ALTER COLUMN "status" TYPE "OutboxStatus" USING ("status"::text::"OutboxStatus");
ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DEFAULT 'PENDING';
