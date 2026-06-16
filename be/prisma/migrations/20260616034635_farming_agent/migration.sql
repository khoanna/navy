-- AlterTable
ALTER TABLE "FarmingSubwallet" ADD COLUMN     "currentValueLamports" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "lastRefreshedAt" TIMESTAMP(3),
ADD COLUMN     "ownerMainWallet" TEXT,
ADD COLUMN     "principalLamports" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FarmingEvent" (
    "id" TEXT NOT NULL,
    "subwalletId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "txSignature" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmingEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FarmingEvent" ADD CONSTRAINT "FarmingEvent_subwalletId_fkey" FOREIGN KEY ("subwalletId") REFERENCES "FarmingSubwallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
