// Postgres schema (Neon in production, PGlite in tests and local dev).
// Text ids with a prefix: they appear in URLs, Telegram buttons and PayPal idempotency keys.

export const STATUSES = [
  "checking",
  "needs_approval",
  "authorised",
  "capturing",
  "captured",
  "voiding",
  "voided",
  "blocked",
  "protected",
  "failed",
] as const;
export type PaymentStatus = (typeof STATUSES)[number];

export const DDL = `
create table if not exists spenders (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('agent', 'person', 'kid')),
  spotter_name text not null,
  allowance jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  spender_id text not null references spenders(id) on delete cascade,
  request jsonb not null,
  decision jsonb,
  ai jsonb,
  status text not null check (status in (${STATUSES.map((s) => `'${s}'`).join(", ")})),
  amount bigint not null check (amount > 0),
  currency text not null check (currency in ('GBP', 'USD')),
  paypal_order_id text,
  paypal_authorization_id text,
  paypal_capture_id text,
  approve_url text,
  error text,
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_spender_created_idx on payments (spender_id, created_at desc);
create index if not exists payments_needs_approval_idx on payments (created_at) where status = 'needs_approval';

create table if not exists events (
  id bigint generated always as identity primary key,
  payment_id text not null references payments(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists events_payment_idx on events (payment_id, at);
`;
