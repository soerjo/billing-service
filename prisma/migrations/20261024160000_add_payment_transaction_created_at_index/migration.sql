-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_transactions_created_at_idx"
  ON "payment_transactions"("created_at");
