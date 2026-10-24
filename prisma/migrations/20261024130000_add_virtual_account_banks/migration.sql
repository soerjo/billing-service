CREATE TABLE "virtual_account_banks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "virtual_account_banks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "virtual_account_banks_code_key" ON "virtual_account_banks"("code");

INSERT INTO "virtual_account_banks" ("id", "code", "name", "enabled", "sort_order", "updated_at")
VALUES
  ('vab_bca', 'bca', 'BCA Virtual Account', true, 10, CURRENT_TIMESTAMP),
  ('vab_bni', 'bni', 'BNI Virtual Account', true, 20, CURRENT_TIMESTAMP),
  ('vab_bri', 'bri', 'BRI Virtual Account', true, 30, CURRENT_TIMESTAMP),
  ('vab_cimb', 'cimb', 'CIMB Niaga Virtual Account', true, 40, CURRENT_TIMESTAMP),
  ('vab_permata', 'permata', 'Permata Virtual Account', true, 50, CURRENT_TIMESTAMP);
