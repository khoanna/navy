-- CreateTable
CREATE TABLE "VaultDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "assetsBase" BIGINT NOT NULL,
    "nonce" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "validBefore" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'awaiting_signature',
    "txHash" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultRedeem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "sharesBase" BIGINT NOT NULL,
    "digest" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'awaiting_signature',
    "txHash" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultRedeem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebalanceEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromAdapter" TEXT,
    "toAdapter" TEXT,
    "amountBase" BIGINT NOT NULL DEFAULT 0,
    "aprFromE18" BIGINT NOT NULL DEFAULT 0,
    "aprToE18" BIGINT NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirming',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RebalanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultDeposit_nonce_key" ON "VaultDeposit"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDeposit_digest_key" ON "VaultDeposit"("digest");

-- CreateIndex
CREATE INDEX "VaultDeposit_userId_createdAt_idx" ON "VaultDeposit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VaultDeposit_status_idx" ON "VaultDeposit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VaultRedeem_digest_key" ON "VaultRedeem"("digest");

-- CreateIndex
CREATE INDEX "VaultRedeem_userId_createdAt_idx" ON "VaultRedeem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VaultRedeem_status_idx" ON "VaultRedeem"("status");

-- CreateIndex
CREATE INDEX "RebalanceEvent_createdAt_idx" ON "RebalanceEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RebalanceEvent_status_idx" ON "RebalanceEvent"("status");
