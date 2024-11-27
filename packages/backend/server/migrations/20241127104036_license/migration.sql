-- CreateTable
CREATE TABLE "licenses" (
    "key" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "stripe_subscription_id" VARCHAR,
    "recurring" VARCHAR(20) NOT NULL,
    "plan" VARCHAR(20) NOT NULL,
    "variant" VARCHAR(20),
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "installed" BOOLEAN NOT NULL DEFAULT false,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3),
    "next_bill_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "trial_start" TIMESTAMPTZ(3),
    "trial_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "installed_licenses" (
    "key" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "installed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revalidated_at" TIMESTAMPTZ(3),

    CONSTRAINT "installed_licenses_pkey" PRIMARY KEY ("key")
);
