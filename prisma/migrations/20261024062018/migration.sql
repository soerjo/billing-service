/*
  Warnings:

  - You are about to drop the `organizations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "request_payload" JSONB;

-- DropTable
DROP TABLE "organizations";

-- DropTable
DROP TABLE "users";

-- DropEnum
DROP TYPE "RoleName";
