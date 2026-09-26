import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, plans, users, type Plan } from "@/db/schema";
import { hashPassword, apiKey } from "@/lib/auth";
import { BASE_DEFAULTS } from "@/lib/vector/types";

export const DEFAULT_PLANS = [
  {
    slug: "free",
    name: "Free",
    price: 0,
    period: "none",
    credits: 5,
    unlimited: false,
    folderAccess: false,
    highlight: false,
    sortOrder: 1,
    features: ["5 credits on signup", "SVG, PDF, DXF, EPS export", "Full manual settings", "Personal use"],
  },
  {
    slug: "credit-pack",
    priceBdt: 1200,
    name: "Credit Pack",
    price: 10,
    period: "none",
    credits: 500,
    unlimited: false,
    folderAccess: false,
    highlight: false,
    sortOrder: 2,
    features: ["500 credits, never expire", "All export formats & versions", "Batch upload (multiple files)", "Email support"],
  },
  {
    slug: "starter-unlimited",
    priceBdt: 2400,
    name: "Starter Unlimited",
    price: 20,
    period: "monthly",
    credits: 0,
    unlimited: true,
    folderAccess: false,
    highlight: false,
    sortOrder: 3,
    features: [
      "Unlimited vectorizations for 1 month",
      "All formats: SVG · PDF · DXF · EPS · PNG",
      "Advanced editor + presets",
      "No folder / batch-folder option",
    ],
  },
  {
    slug: "standard-unlimited",
    priceBdt: 3000,
    name: "Standard Unlimited",
    price: 25,
    period: "monthly",
    credits: 0,
    unlimited: true,
    folderAccess: true,
    highlight: true,
    sortOrder: 4,
    features: [
      "Unlimited vectorizations for 1 month",
      "Folder upload + batch download (.zip) 🔥",
      "All formats & versions",
      "Priority processing queue",
    ],
  },
  {
    slug: "pro-unlimited",
    priceBdt: 6000,
    name: "Pro Unlimited",
    price: 50,
    period: "monthly",
    credits: 0,
    unlimited: true,
    folderAccess: true,
    highlight: false,
    sortOrder: 5,
    features: [
      "Everything in Standard",
      "API access with API key",
      "GPU-priority processing",
      "Commercial license",
    ],
  },
  {
    slug: "semi-annual",
    priceBdt: 12000,
    name: "Semi-Annual Unlimited",
    price: 100,
    period: "semiannual",
    credits: 0,
    unlimited: true,
    folderAccess: true,
    highlight: false,
    sortOrder: 6,
    features: ["6 months unlimited", "Folder + batch download", "API access", "Save 33% vs monthly"],
  },
  {
    slug: "semi-annual-pro",
    priceBdt: 24000,
    name: "Semi-Annual Pro",
    price: 200,
    period: "semiannual",
    credits: 0,
    unlimited: true,
    folderAccess: true,
    highlight: false,
    sortOrder: 7,
    features: ["6 months unlimited Pro", "API + GPU priority queue", "Admin-configurable limits", "Priority human support"],
  },
];

export const DEFAULT_APP_SETTINGS: Record<string, unknown> = {
  payment: {
    bkash: "01616362908",
    nogod: "01616362908",
    paypal: "paypal@vectorizer.ai",
    paypalEnabled: false,
    currency: "USD",
    bdtRate: 120,
    instructions:
      "Send the exact amount to the bKash/Nagad number above (Personal > Send Money), then submit your number + Transaction ID. Admin verifies manually and unlocks premium instantly.",
  },
  vectorizer: {
    ...BASE_DEFAULTS,
    maxUploadMB: 25,
    maxBatch: 60,
    guestFreeImages: 12,
    freeCredits: 5,
    creditsPerImage: 1,
    cpuCores: 4,
    gpuEnabled: true,
    multiThread: true,
    asyncQueue: true,
    redisCache: true,
    cdnEnabled: true,
  },
  site: {
    supportEmail: "support@vectorizer.ai",
    languages: ["English", "বাংলা", "हिन्दी", "Español", "Deutsch", "Français", "العربية", "中文"],
    heroTitle: "Convert Images to Vectors Online",
    heroLine1: "Vectorize PNG, JPG, GIF, and WebP images to clean SVG, PDF, EPS, and DXF vectors online.",
    heroLine2: "AI-powered tracing for logos, illustrations, print, web, CAD, CNC, and design workflows.",
  },
};

let seeded = false;

export async function ensureSeed(): Promise<void> {
  if (seeded) return;
  const existing = await db.select().from(plans).limit(1);
  if (existing.length === 0) {
    await db
      .insert(plans)
      .values(DEFAULT_PLANS.map((p) => ({ ...p, features: p.features as string[] })))
      .onConflictDoNothing({ target: plans.slug });
  }
  // backfill the BDT price (bKash / Nagad checkout) for plans that predate the column
  const allPlans = await db.select().from(plans);
  for (const plan of allPlans) {
    if (plan.priceBdt <= 0 && plan.price > 0) {
      await db.update(plans).set({ priceBdt: Math.round(plan.price * 120) }).where(eq(plans.id, plan.id));
    }
  }
  const existingSettings = await db.select().from(appSettings).limit(1);
  if (existingSettings.length === 0) {
    for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
      await db.insert(appSettings).values({ key, value: value as never }).onConflictDoNothing({ target: appSettings.key });
    }
  } else {
    // migration: the very first build shipped a 3-image guest limit
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, "vectorizer")).limit(1);
    const current = (rows[0]?.value ?? null) as Record<string, unknown> | null;
    if (current && Number(current.guestFreeImages ?? 0) < 12) {
      await db
        .update(appSettings)
        .set({ value: { ...current, guestFreeImages: 12 } as never, updatedAt: new Date() })
        .where(eq(appSettings.key, "vectorizer"));
    }
  }
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@vectorizer.ai";
  const admins = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  if (admins.length === 0) {
    await db.insert(users).values({
      name: "Administrator",
      email: adminEmail,
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD ?? "admin12345"),
      role: "admin",
      credits: 999_999,
      plan: "semi-annual-pro",
      planPeriod: "semiannual",
      unlimited: true,
      folderAccess: true,
      apiKey: apiKey(),
    }).onConflictDoNothing({ target: users.email });
  }
  seeded = true;
}

export async function getAppSetting<T>(key: string): Promise<T | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (rows[0]?.value as T) ?? null;
}

export async function getAppSettings(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(appSettings);
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (rows.length === 0) {
    await db.insert(appSettings).values({ key, value: value as never });
  } else {
    await db
      .update(appSettings)
      .set({ value: value as never, updatedAt: new Date() })
      .where(eq(appSettings.key, key));
  }
}

export async function getPlans(activeOnly = true): Promise<Plan[]> {
  const rows = await db.select().from(plans);
  const filtered = activeOnly ? rows.filter((p) => p.isActive) : rows;
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const rows = await db.select().from(plans).where(eq(plans.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export function planDurationDays(period: string): number {
  if (period === "monthly") return 30;
  if (period === "semiannual") return 182;
  return 0;
}
