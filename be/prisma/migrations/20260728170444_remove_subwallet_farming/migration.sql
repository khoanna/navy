/*
  Warnings:

  - You are about to drop the column `farmDelegationEnabledAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `farmDelegationWalletId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `FarmingEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FarmingSubwallet` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FarmingEvent" DROP CONSTRAINT "FarmingEvent_subwalletId_fkey";

-- DropForeignKey
ALTER TABLE "FarmingSubwallet" DROP CONSTRAINT "FarmingSubwallet_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "farmDelegationEnabledAt",
DROP COLUMN "farmDelegationWalletId";

-- DropTable
DROP TABLE "FarmingEvent";

-- DropTable
DROP TABLE "FarmingSubwallet";
