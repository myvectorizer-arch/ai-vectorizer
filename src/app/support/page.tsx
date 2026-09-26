import { SupportClient } from "@/components/SupportClient";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  await ensureSeed();
  return <SupportClient />;
}
