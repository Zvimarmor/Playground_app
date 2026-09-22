-- =========================================================
--  Event ticketing & door management - Supabase schema
--  Run this whole file in the Supabase SQL editor.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- tables -------------------------------------------------

create table if not exists public.events_config (
  id            uuid primary key default gen_random_uuid(),
  event_name    text        not null default 'האירוע',
  sales_start_at timestamptz not null default now(),
  sales_end_at   timestamptz not null default (now() + interval '30 days'),
  is_active     boolean     not null default true,
  paybox_url    text        not null default 'https://payboxapp.page.link/example',
  helper_pin    text        not null default '1234',
  admin_pin     text        not null default '9999',
  created_at    timestamptz not null default now()
);

create table if not exists public.tiers (
  id           uuid primary key default gen_random_uuid(),
  name         text    not null,
  capacity     int     not null check (capacity > 0),
  price_single numeric not null check (price_single >= 0),
  price_pair   numeric not null check (price_pair   >= 0),
  price_quad   numeric not null check (price_quad   >= 0),
  sort_order   int     not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists tiers_sort_order_key on public.tiers (sort_order);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  buyer_name     text    not null,
  buyer_phone    text    not null,
  ticket_type    text    not null check (ticket_type in ('single','pair','quad')),
  tickets_count  int     not null check (tickets_count in (1,2,4)),
  total_amount   numeric not null check (total_amount >= 0),
  payment_status text    not null default 'pending'
                 check (payment_status in ('pending','paid','cancelled')),
  tier_name      text,
  source         text    not null default 'public' check (source in ('public','manual'))
);
create index if not exists orders_status_idx     on public.orders (payment_status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  attendee_name text not null,
  phone         text,
  is_checked_in boolean not null default false,
  checked_in_at timestamptz
);
create index if not exists tickets_order_id_idx on public.tickets (order_id);

-- ---------- public config view (never exposes the PINs) -------------

drop view if exists public.events_config_public;
create view public.events_config_public as
  select id, event_name, sales_start_at, sales_end_at, is_active, paybox_url, created_at
  from public.events_config;

-- ---------- PIN verification (PINs stay server side) ----------------

create or replace function public.verify_pin(p_pin text)
returns text
language sql
security definer
set search_path = public
as $$
  select case
           when c.admin_pin  = p_pin then 'admin'
           when c.helper_pin = p_pin then 'helper'
           else null
         end
  from public.events_config c
  order by c.created_at
  limit 1;
$$;

-- ---------- row level security --------------------------------------
-- NOTE: this app authenticates people with shared PINs, not Supabase
-- Auth, so the anon role needs write access to orders/tickets.
-- The PIN columns are the only thing kept out of reach.

alter table public.events_config enable row level security;
alter table public.tiers          enable row level security;
alter table public.orders         enable row level security;
alter table public.tickets        enable row level security;

-- events_config: no direct anon access at all (use the view / rpc).
drop policy if exists "tiers read"        on public.tiers;
drop policy if exists "orders read"       on public.orders;
drop policy if exists "orders insert"     on public.orders;
drop policy if exists "orders update"     on public.orders;
drop policy if exists "tickets read"      on public.tickets;
drop policy if exists "tickets insert"    on public.tickets;
drop policy if exists "tickets update"    on public.tickets;

create policy "tiers read"     on public.tiers   for select to anon, authenticated using (true);
create policy "orders read"    on public.orders  for select to anon, authenticated using (true);
create policy "orders insert"  on public.orders  for insert to anon, authenticated with check (true);
create policy "orders update"  on public.orders  for update to anon, authenticated using (true) with check (true);
create policy "tickets read"   on public.tickets for select to anon, authenticated using (true);
create policy "tickets insert" on public.tickets for insert to anon, authenticated with check (true);
create policy "tickets update" on public.tickets for update to anon, authenticated using (true) with check (true);

grant select on public.events_config_public to anon, authenticated;
grant execute on function public.verify_pin(text) to anon, authenticated;

-- ---------- seed data ------------------------------------------------

insert into public.events_config (event_name, sales_start_at, sales_end_at, is_active, paybox_url, helper_pin, admin_pin)
select 'מסיבת הסיום', now() - interval '1 day', now() + interval '30 days', true,
       'https://payboxapp.page.link/example', '1234', '9999'
where not exists (select 1 from public.events_config);

insert into public.tiers (name, capacity, price_single, price_pair, price_quad, sort_order)
select * from (values
  ('סבב ראשון',  50, 60::numeric, 110::numeric, 200::numeric, 1),
  ('סבב שני',    70, 70::numeric, 130::numeric, 240::numeric, 2),
  ('סבב אחרון', 100, 80::numeric, 150::numeric, 280::numeric, 3)
) as t(name, capacity, price_single, price_pair, price_quad, sort_order)
where not exists (select 1 from public.tiers);

-- ---------- realtime --------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tickets;
exception when duplicate_object then null;
end $$;
