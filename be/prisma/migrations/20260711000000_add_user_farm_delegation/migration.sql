-- AlterTable: add delegated-farming fields to User (additive, nullable)
ALTER TABLE "User" ADD COLUMN "farmDelegationWalletId" TEXT;
ALTER TABLE "User" ADD COLUMN "farmDelegationEnabledAt" TIMESTAMP(3);
