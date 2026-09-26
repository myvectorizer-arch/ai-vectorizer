import { PricingClient, type PlanDto } from "@/components/PricingClient";
import { ensureSeed, getPlans } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  await ensureSeed();
  const plans = await getPlans(true);
  const dto: PlanDto[] = plans.map((plan) => ({
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    price: plan.price,
    priceBdt: plan.priceBdt,
    currency: plan.currency,
    period: plan.period,
    credits: plan.credits,
    unlimited: plan.unlimited,
    folderAccess: plan.folderAccess,
    features: plan.features ?? [],
    highlight: plan.highlight,
  }));
  return <PricingClient plans={dto} />;
}
