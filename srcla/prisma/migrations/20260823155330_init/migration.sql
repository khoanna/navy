-- CreateTable
CREATE TABLE "WithdrawalEvent" (
    "id" TEXT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "sender" TEXT NOT NULL,
    "assets" TEXT NOT NULL,
    "shares" TEXT NOT NULL,
    "regimeId" TEXT,

    CONSTRAINT "WithdrawalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainBlock" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "totalAssetsBase" TEXT NOT NULL,
    "idleBase" TEXT NOT NULL,
    "supplyRateE18" TEXT NOT NULL,
    "utilizationE18" TEXT NOT NULL,
    "cashBase" TEXT NOT NULL,
    "borrowsBase" TEXT NOT NULL,
    "reservesBase" TEXT NOT NULL,
    "capBps" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL,
    "configDigest" TEXT NOT NULL,
    "regimeId" TEXT,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractRegime" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractRegime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastLabel" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "originTimestamp" TIMESTAMP(3) NOT NULL,
    "horizonSeconds" INTEGER NOT NULL,
    "realizedReturnE18" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastCalibration" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "lossMetrics" JSONB NOT NULL,
    "artifactHash" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "admissions" JSONB NOT NULL,
    "forecasts" JSONB NOT NULL,
    "reserveBase" TEXT NOT NULL,
    "allocation" JSONB NOT NULL,
    "actionDecision" JSONB NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanAction" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "amountBase" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "error" TEXT,

    CONSTRAINT "PlanAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardObservation" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "adapter" TEXT NOT NULL,
    "rewardToken" TEXT NOT NULL,
    "claimable" TEXT NOT NULL,
    "priceUsd" TEXT NOT NULL,
    "valueBase" TEXT NOT NULL,

    CONSTRAINT "RewardObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestRecord" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "adapter" TEXT NOT NULL,
    "rewardToken" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountOutBase" TEXT NOT NULL,
    "decisionHash" TEXT NOT NULL,

    CONSTRAINT "HarvestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "results" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WithdrawalEvent_sender_timestamp_idx" ON "WithdrawalEvent"("sender", "timestamp");

-- CreateIndex
CREATE INDEX "WithdrawalEvent_timestamp_idx" ON "WithdrawalEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ChainBlock_blockHash_key" ON "ChainBlock"("blockHash");

-- CreateIndex
CREATE INDEX "ChainBlock_chainId_blockNumber_idx" ON "ChainBlock"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "ChainBlock_timestamp_idx" ON "ChainBlock"("timestamp");

-- CreateIndex
CREATE INDEX "MarketSnapshot_marketId_timestamp_idx" ON "MarketSnapshot"("marketId", "timestamp");

-- CreateIndex
CREATE INDEX "MarketSnapshot_timestamp_idx" ON "MarketSnapshot"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_marketId_blockHash_key" ON "MarketSnapshot"("marketId", "blockHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRegime_digest_key" ON "ContractRegime"("digest");

-- CreateIndex
CREATE INDEX "ContractRegime_marketId_idx" ON "ContractRegime"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_version_key" ON "PolicyVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_artifactHash_key" ON "PolicyVersion"("artifactHash");

-- CreateIndex
CREATE INDEX "PolicyVersion_activatedAt_idx" ON "PolicyVersion"("activatedAt");

-- CreateIndex
CREATE INDEX "ForecastLabel_marketId_availableAt_idx" ON "ForecastLabel"("marketId", "availableAt");

-- CreateIndex
CREATE INDEX "ForecastLabel_availableAt_idx" ON "ForecastLabel"("availableAt");

-- CreateIndex
CREATE INDEX "ForecastCalibration_method_selected_idx" ON "ForecastCalibration"("method", "selected");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_decisionHash_key" ON "Decision"("decisionHash");

-- CreateIndex
CREATE INDEX "Decision_timestamp_idx" ON "Decision"("timestamp");

-- CreateIndex
CREATE INDEX "Decision_snapshotHash_idx" ON "Decision"("snapshotHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPlan_planId_key" ON "ExecutionPlan"("planId");

-- CreateIndex
CREATE INDEX "ExecutionPlan_status_idx" ON "ExecutionPlan"("status");

-- CreateIndex
CREATE INDEX "ExecutionPlan_decisionHash_idx" ON "ExecutionPlan"("decisionHash");

-- CreateIndex
CREATE INDEX "PlanAction_status_idx" ON "PlanAction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanAction_planId_actionIndex_key" ON "PlanAction"("planId", "actionIndex");

-- CreateIndex
CREATE INDEX "RewardObservation_adapter_timestamp_idx" ON "RewardObservation"("adapter", "timestamp");

-- CreateIndex
CREATE INDEX "RewardObservation_rewardToken_timestamp_idx" ON "RewardObservation"("rewardToken", "timestamp");

-- CreateIndex
CREATE INDEX "HarvestRecord_timestamp_idx" ON "HarvestRecord"("timestamp");

-- CreateIndex
CREATE INDEX "HarvestRecord_adapter_timestamp_idx" ON "HarvestRecord"("adapter", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRun_manifestHash_key" ON "EvaluationRun"("manifestHash");

-- CreateIndex
CREATE INDEX "EvaluationRun_status_idx" ON "EvaluationRun"("status");

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "ContractRegime"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_decisionHash_fkey" FOREIGN KEY ("decisionHash") REFERENCES "Decision"("decisionHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAction" ADD CONSTRAINT "PlanAction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ExecutionPlan"("planId") ON DELETE RESTRICT ON UPDATE CASCADE;
