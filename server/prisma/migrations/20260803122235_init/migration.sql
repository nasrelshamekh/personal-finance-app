-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EGP', 'USD', 'EUR', 'GBP');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'WALLET', 'SAVINGS', 'CREDIT_CARD');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "DebtDirection" AS ENUM ('I_OWE', 'OWED_TO_ME');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('ACTIVE', 'SETTLED');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('MANUAL', 'API');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "openingRateToEgp" DECIMAL(18,8) NOT NULL,
    "openingBalanceEgp" DECIMAL(18,4) NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "parentId" UUID,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "type" "TxType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "rateToEgp" DECIMAL(18,8) NOT NULL,
    "amountEgp" DECIMAL(18,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "accountId" UUID NOT NULL,
    "categoryId" UUID,
    "transferGroupId" UUID,
    "debtPaymentId" UUID,
    "savingsContributionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" UUID NOT NULL,
    "counterparty" TEXT NOT NULL,
    "direction" "DebtDirection" NOT NULL,
    "principal" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "DebtStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" UUID NOT NULL,
    "debtId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "rateToDebtCurrency" DECIMAL(18,8) NOT NULL,
    "amountInDebtCurrency" DECIMAL(18,4) NOT NULL,
    "rateToEgp" DECIMAL(18,8) NOT NULL,
    "amountEgp" DECIMAL(18,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "deadline" TIMESTAMP(3),
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsContribution" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "rateToGoalCurrency" DECIMAL(18,8) NOT NULL,
    "amountInGoalCurrency" DECIMAL(18,4) NOT NULL,
    "rateToEgp" DECIMAL(18,8) NOT NULL,
    "amountEgp" DECIMAL(18,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "limitEgp" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" UUID NOT NULL,
    "base" "Currency" NOT NULL,
    "quote" "Currency" NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "nextUpdateAt" TIMESTAMP(3),
    "source" "RateSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "baseCurrency" "Currency" NOT NULL DEFAULT 'EGP',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "rateSource" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "ratesApiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ratesApiEolAt" TIMESTAMP(3),
    "themePreset" TEXT NOT NULL DEFAULT 'graphite',
    "themeMode" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_isArchived_idx" ON "Account"("isArchived");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Category_kind_isArchived_idx" ON "Category"("kind", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_debtPaymentId_key" ON "Transaction"("debtPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_savingsContributionId_key" ON "Transaction"("savingsContributionId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_date_idx" ON "Transaction"("categoryId", "date");

-- CreateIndex
CREATE INDEX "Transaction_transferGroupId_idx" ON "Transaction"("transferGroupId");

-- CreateIndex
CREATE INDEX "Debt_status_dueDate_idx" ON "Debt"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Debt_direction_status_idx" ON "Debt"("direction", "status");

-- CreateIndex
CREATE INDEX "DebtPayment_debtId_date_idx" ON "DebtPayment"("debtId", "date");

-- CreateIndex
CREATE INDEX "SavingsGoal_isArchived_idx" ON "SavingsGoal"("isArchived");

-- CreateIndex
CREATE INDEX "SavingsContribution_goalId_date_idx" ON "SavingsContribution"("goalId", "date");

-- CreateIndex
CREATE INDEX "Budget_month_idx" ON "Budget"("month");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_categoryId_month_key" ON "Budget"("categoryId", "month");

-- CreateIndex
CREATE INDEX "ExchangeRate_base_quote_asOf_idx" ON "ExchangeRate"("base", "quote", "asOf" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_base_quote_source_asOf_key" ON "ExchangeRate"("base", "quote", "source", "asOf");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_debtPaymentId_fkey" FOREIGN KEY ("debtPaymentId") REFERENCES "DebtPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_savingsContributionId_fkey" FOREIGN KEY ("savingsContributionId") REFERENCES "SavingsContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
