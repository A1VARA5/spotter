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
