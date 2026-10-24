ALTER TABLE "payment_transactions"
  ADD COLUMN "va_bank" TEXT,
  ADD COLUMN "va_number" TEXT,
  ADD COLUMN "va_expiry_time" TIMESTAMP(3);
