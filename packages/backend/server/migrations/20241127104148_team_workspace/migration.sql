-- CreateTable
CREATE TABLE "workspace_subscriptions" (
    "id" SERIAL NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "plan" VARCHAR(20) NOT NULL,
    "recurring" VARCHAR(20) NOT NULL,
    "variant" VARCHAR(20),
    "quantity" INTEGER NOT NULL,
    "stripe_subscription_id" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3),
    "next_bill_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "trial_start" TIMESTAMPTZ(3),
    "trial_end" TIMESTAMPTZ(3),
    "stripe_schedule_id" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invoices" (
    "id" SERIAL NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR,
    "last_payment_error" TEXT,
    "link" TEXT,

    CONSTRAINT "workspace_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscriptions_stripe_subscription_id_key" ON "workspace_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscriptions_workspace_id_plan_key" ON "workspace_subscriptions"("workspace_id", "plan");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invoices_stripe_invoice_id_key" ON "workspace_invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "workspace_invoices_workspace_id_idx" ON "workspace_invoices"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invoices" ADD CONSTRAINT "workspace_invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
