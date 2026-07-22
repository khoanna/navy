-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "toUsername" TEXT,
    "amount" BIGINT NOT NULL,
    "nonce" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "validBefore" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_signature',
    "txHash" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_nonce_key" ON "Transfer"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_digest_key" ON "Transfer"("digest");

-- CreateIndex
CREATE INDEX "Transfer_fromUserId_createdAt_idx" ON "Transfer"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_status_idx" ON "Transfer"("status");
