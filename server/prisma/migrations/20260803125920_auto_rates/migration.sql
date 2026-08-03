/*
  D12 — rates are fetched automatically.

  The three `rateAsOf` columns are added NOT NULL with no default. That is safe here
  because these tables are empty: the money-bearing features land in Phase 3 onwards, and
  a row without a rateAsOf could not be created afterwards anyway. Every writer sets it
  from the rate it actually used, so a default would only ever be a lie.
*/

-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN     "rateAsOf" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "SavingsContribution" ADD COLUMN     "rateAsOf" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Setting" ALTER COLUMN "rateSource" SET DEFAULT 'API',
ALTER COLUMN "ratesApiEnabled" SET DEFAULT true;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "rateAsOf" TIMESTAMP(3) NOT NULL;

-- A changed column default applies only to new rows, and Setting is a single existing
-- row. Bring it along, or the setting would read "on" in the schema and be off in fact.
UPDATE "Setting" SET "ratesApiEnabled" = true, "rateSource" = 'API' WHERE "id" = 1;
