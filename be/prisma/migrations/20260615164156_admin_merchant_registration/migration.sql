-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "onchainRegisterTx" TEXT,
ADD COLUMN     "onchainRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;
