-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_billing_account_id_fkey";
ALTER TABLE "payment_transactions" DROP CONSTRAINT IF EXISTS "payment_transactions_invoice_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "payment_transactions_invoice_id_status_idx";

-- AlterTable
ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "invoice_id",
ADD COLUMN IF NOT EXISTS "order_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'IDR',
ADD COLUMN IF NOT EXISTS "description" TEXT,
ADD COLUMN IF NOT EXISTS "metadata" JSONB,
ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);

ALTER TABLE "payment_transactions" ALTER COLUMN "order_id" DROP DEFAULT;

-- DropTable
DROP TABLE IF EXISTS "invoices";
DROP TABLE IF EXISTS "billing_accounts";

-- DropEnum
DROP TYPE IF EXISTS "InvoiceStatus";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_transactions_order_id_idx" ON "payment_transactions"("order_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_status_idx" ON "payment_transactions"("status");
