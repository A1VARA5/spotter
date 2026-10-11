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
create table if not exists households (
  id text primary key,
  name text not null,
  spotter_name text not null,
  paypal_user_id text unique,
  email text,
  telegram_chat_id text,
  pin_hash text,
  pin_failures int not null default 0,
  pin_locked_until timestamptz,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists households_demo_created_idx on households (created_at) where demo;

create table if not exists spenders (
  id text primary key,
  household_id text not null references households(id) on delete cascade,
  email text,
  telegram_chat_id text,
  name text not null,
  kind text not null check (kind in ('agent', 'person', 'kid')),
  spotter_name text not null,
  allowance jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists spenders_household_idx on spenders (household_id);
create unique index if not exists spenders_email_idx on spenders (lower(email)) where email is not null;
create unique index if not exists spenders_telegram_idx on spenders (telegram_chat_id) where telegram_chat_id is not null;

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

alter table payments add column if not exists market jsonb;

create table if not exists market_cache (
  key text primary key,
  offers jsonb not null,
  fetched_at timestamptz not null default now()
);

create table if not exists events (
  id bigint generated always as identity primary key,
  payment_id text not null references payments(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists events_payment_idx on events (payment_id, at);

create table if not exists pairing_codes (
  code text primary key,
  household_id text not null references households(id) on delete cascade,
  spender_id text references spenders(id) on delete cascade,
  channel text not null check (channel in ('email', 'telegram')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists pairing_failures (
  identity text not null,
  at timestamptz not null default now()
);
create index if not exists pairing_failures_identity_idx on pairing_failures (identity, at);

create table if not exists agent_tokens (
  hash text primary key,
  spender_id text not null references spenders(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists agent_tokens_spender_idx on agent_tokens (spender_id);

alter table households add column if not exists alert_email text;

create table if not exists inbound (
  provider text not null,
  message_id text not null,
  sender text,
  outcome text,
  received_at timestamptz not null default now(),
  primary key (provider, message_id)
);
create index if not exists inbound_sender_idx on inbound (sender, received_at);

alter table payments add column if not exists case_file jsonb;
alter table spenders add column if not exists discord_user_id text;
alter table households add column if not exists discord_user_id text;
create unique index if not exists spenders_discord_idx on spenders (discord_user_id) where discord_user_id is not null;
alter table pairing_codes drop constraint if exists pairing_codes_channel_check;
alter table pairing_codes add constraint pairing_codes_channel_check check (channel in ('email', 'telegram', 'discord'));

create table if not exists reports (
  key text not null,
  household_id text not null references households(id) on delete cascade,
  kind text not null,
  at timestamptz not null default now(),
  primary key (key, household_id)
);
create index if not exists reports_key_idx on reports (key, at);

create table if not exists llm_turns (
  household_id text not null references households(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists llm_turns_at_idx on llm_turns (at);
create index if not exists llm_turns_household_idx on llm_turns (household_id, at);

alter table payments add column if not exists paypal_auth_expires_at timestamptz;
create table if not exists paypal_events (
  id text primary key,
  event_type text not null,
  resource_id text,
  payment_id text references payments(id) on delete cascade,
  summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists paypal_events_payment_idx on paypal_events (payment_id, received_at);
create index if not exists payments_paypal_capture_idx on payments (paypal_capture_id) where paypal_capture_id is not null;
create index if not exists payments_paypal_auth_idx on payments (paypal_authorization_id) where paypal_authorization_id is not null;
create index if not exists payments_paypal_order_idx on payments (paypal_order_id) where paypal_order_id is not null;
-- Watchtower block (board + chat persistence), two tables: each family's saved AG Studio board with
-- the incident pages it has already been given, and its AI chat threads. Ends after watchtower_threads.
create table if not exists watchtower_boards (
  household_id text primary key references households(id) on delete cascade,
  state jsonb not null,
  seen_incidents jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists watchtower_threads (
  id text not null,
  household_id text not null references households(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, id)
);
-- Business mode block, one column: a household is a family (the default, so every existing one stays
-- a family) or a small business. It only changes words and starter rules, never how a payment is checked.
alter table households add column if not exists kind text not null default 'family';
-- Watchtower price checks block, one table: each live Channel3 search the Spotter agent makes, so a
-- family's daily cap can be counted like llm_turns.
create table if not exists price_checks (
  household_id text not null references households(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists price_checks_household_idx on price_checks (household_id, at);
create index if not exists price_checks_at_idx on price_checks (at);
-- Safer options block, one table: the genuine Channel3 offer Spotter suggested to an AI agent after stopping or
-- holding its payment. An agent can only pay one of these (its own, under an hour old, once) as the replacement.
create table if not exists safer_options (
  id text primary key,
  payment_id text not null references payments(id) on delete cascade,
  spender_id text not null references spenders(id) on delete cascade,
  offer jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by text
);
create index if not exists safer_options_payment_idx on safer_options (payment_id, created_at desc);
-- Peek safely block, one table: each time a spotter looks at a case file's page live in a throwaway KERNEL browser.
-- The partial unique index allows one open peek per household, and rows from the last day count towards the caps.
-- session_sealed is KERNEL's session id, sealed (src/core/seal.ts). No KERNEL link is ever stored.
create table if not exists peeks (
  id text primary key,
  household_id text not null references households(id) on delete cascade,
  payment_id text not null references payments(id) on delete cascade,
  view text not null,
  session_sealed text,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  last_frame_at timestamptz,
  closed_at timestamptz,
  close_reason text
);
create unique index if not exists peeks_one_open_idx on peeks (household_id) where closed_at is null;
create index if not exists peeks_started_idx on peeks (started_at);
create index if not exists peeks_household_started_idx on peeks (household_id, started_at);
-- Price watch block, one table: a product Spotter watches at Channel3 (price tracking, 1 credit per product per day)
-- after a payment for it was too dear, held or denied. Money amounts in minor units. household_id is set to null
-- (not deleted) when a demo family goes, so the daily job can still stop the Channel3 subscription, then deletes it.
create table if not exists price_watches (
  id text primary key,
  household_id text references households(id) on delete set null,
  payment_id text references payments(id) on delete set null,
  spender_id text references spenders(id) on delete set null,
  product_id text not null,
  item text not null,
  title text not null,
  currency text not null check (currency in ('GBP', 'USD')),
  nearly_paid bigint not null check (nearly_paid > 0),
  target bigint not null check (target > 0),
  best_price bigint,
  best_shop text,
  best_url text,
  history jsonb,
  status text not null default 'watching' check (status in ('watching', 'dropped', 'stopped', 'expired')),
  tracking boolean not null default false,
  example boolean not null default false,
  created_by text not null default 'spotter',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_checked_at timestamptz,
  notified_at timestamptz
);
create index if not exists price_watches_household_idx on price_watches (household_id, created_at desc);
create index if not exists price_watches_product_idx on price_watches (product_id) where status = 'watching';
create index if not exists price_watches_created_idx on price_watches (created_at);
create unique index if not exists price_watches_one_active_idx on price_watches (household_id, product_id) where status = 'watching' and household_id is not null;
-- Was it you? block, one column: when a held payment's message claims to come from someone in the family,
-- Spotter asks that real person. The ask, who it went to and their answer (never a secret: tokens are HMACs).
alter table payments add column if not exists was_it_you jsonb;
create index if not exists payments_was_it_you_idx on payments ((was_it_you->>'id')) where was_it_you is not null;

-- Spot the difference block, two tables: each Channel3 image search made for a case (counted per family per day,
-- like price_checks), and its products cached by a hash of the picture, so the same screenshot costs one credit.
create table if not exists image_checks (
  household_id text not null references households(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists image_checks_household_idx on image_checks (household_id, at);
create index if not exists image_checks_at_idx on image_checks (at);
create table if not exists image_search_cache (
  key text primary key,
  products jsonb not null,
  fetched_at timestamptz not null default now()
);
`;
