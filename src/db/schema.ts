import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    provider: text("provider").notNull().default("password"), // password | google
    role: text("role").notNull().default("user"), // user | admin
    credits: integer("credits").notNull().default(5),
    plan: text("plan").notNull().default("free"),
    planPeriod: text("plan_period").notNull().default("none"),
    planStartedAt: timestamp("plan_started_at", { withTimezone: true }),
    planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
    unlimited: boolean("unlimited").notNull().default(false),
    folderAccess: boolean("folder_access").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    apiKey: text("api_key"),
    totalSpent: real("total_spent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const images = pgTable("images", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  batchId: text("batch_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull().default("image/png"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  status: text("status").notNull().default("uploaded"), // uploaded | queued | processing | done | failed
  error: text("error"),
  favorite: boolean("favorite").notNull().default(false),
  sourcePath: text("source_path"),
  tracePath: text("trace_path"),
  svgText: text("svg_text"),
  coreSettings: jsonb("core_settings"),
  renderSettings: jsonb("render_settings"),
  stats: jsonb("stats"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const downloads = pgTable("downloads", {
  id: serial("id").primaryKey(),
  imageId: integer("image_id"),
  userId: integer("user_id"),
  format: text("format").notNull(),
  version: text("version"),
  bytes: integer("bytes").notNull().default(0),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  planSlug: text("plan_slug").notNull(),
  planName: text("plan_name").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("BDT"),
  method: text("method").notNull().default("bkash"), // bkash | nogod | paypal | manual
  senderNumber: text("sender_number"),
  transactionId: text("transaction_id"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable(
  "plans",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    price: real("price").notNull().default(0),
    priceBdt: real("price_bdt").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    period: text("period").notNull().default("none"), // none | monthly | semiannual
    credits: integer("credits").notNull().default(5),
    unlimited: boolean("unlimited").notNull().default(false),
    folderAccess: boolean("folder_access").notNull().default(false),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    highlight: boolean("highlight").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("plans_slug_unique").on(table.slug)],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("app_settings_key_unique").on(table.key)],
);

/**
 * Uploaded source images and cached traces, stored as base64 rows instead of
 * local disk files. Free hosts (Render free tier, most serverless platforms)
 * don't give a persistent disk, so anything saved to the filesystem quietly
 * disappears on the next restart/redeploy. Storing the bytes in Postgres
 * instead means the free Postgres database is the only persistence needed.
 */
export const fileBlobs = pgTable(
  "file_blobs",
  {
    id: serial("id").primaryKey(),
    path: text("path").notNull(),
    data: text("data").notNull(), // base64-encoded bytes
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("file_blobs_path_unique").on(table.path)],
);

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  kind: text("kind").notNull().default("log"), // log | api | error | auth | payment
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  endpoint: text("endpoint"),
  meta: jsonb("meta"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  label: text("label").notNull().default("default"),
  key: text("key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  requestCount: integer("request_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  amount: real("amount").notNull().default(0),
  method: text("method").notNull().default("bkash"),
  accountNumber: text("account_number").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | rejected
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type ImageRow = typeof images.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Payment = typeof payments.$inferSelect;

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  category: text("category").notNull().default("general"), // general | payment | bug | feature
  message: text("message").notNull(),
  imageId: integer("image_id"),
  status: text("status").notNull().default("open"), // open | in_progress | closed
  priority: text("priority").notNull().default("normal"), // low | normal | high
  adminReply: text("admin_reply"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportTicket = typeof supportTickets.$inferSelect;
