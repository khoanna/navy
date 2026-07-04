-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "onchainMerchantId" TEXT;

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "failedPasswordCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastTotpStep" INTEGER,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "issuedTxConsumedAt" TIMESTAMP(3),
ADD COLUMN     "issuedTxExpiresAt" TIMESTAMP(3),
ADD COLUMN     "issuedTxHash" TEXT;

-- CreateTable
CREATE TABLE "PayoutChallenge" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutChallenge_nonce_key" ON "PayoutChallenge"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_onchainMerchantId_key" ON "Merchant"("onchainMerchantId");

