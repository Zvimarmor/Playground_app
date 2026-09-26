-- =========================================================
--  PLAYGROUND - ticketing & door management - Supabase schema
--  Run this whole file in the Supabase SQL editor.
--  It is idempotent: safe to re-run on an existing project.
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

-- Group orders pay into their own PayBox group so a 4-person signup is not
-- paid as a single; null falls back to paybox_url.
alter table public.events_config add column if not exists paybox_group_url text;

-- price_quad is nullable on purpose: a null means "no group ticket in this
-- tier" (the last round sells singles only).
create table if not exists public.tiers (
  id           uuid primary key default gen_random_uuid(),
  name         text    not null,
  capacity     int     not null check (capacity > 0),
  price_single numeric not null check (price_single >= 0),
  price_quad   numeric          check (price_quad   >= 0),
  sort_order   int     not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists tiers_sort_order_key on public.tiers (sort_order);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  buyer_name     text    not null,
  buyer_phone    text    not null,
  ticket_type    text    not null check (ticket_type in ('single','quad')),
  tickets_count  int     not null check (tickets_count in (1,4)),
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

-- ---------- migration: drop the retired "pair" ticket ----------------
-- Older installs had a price_pair column and allowed ticket_type = 'pair'.
-- A 2-ticket order cannot be represented any more, so each pair order is
-- folded down to a single: the surplus attendee row goes first, then the
-- order itself. The order keeps its original total_amount, so if a real pair
-- order ever existed, check it by hand after running this - see the README.

delete from public.tickets t
 using public.orders o
 where t.order_id = o.id
   and o.ticket_type = 'pair'
   and t.id <> (
     select t2.id from public.tickets t2
      where t2.order_id = o.id
      order by t2.created_at, t2.id
      limit 1
   );

update public.orders
   set ticket_type = 'single', tickets_count = 1
 where ticket_type = 'pair';

alter table public.orders  drop constraint if exists orders_ticket_type_check;
alter table public.orders  drop constraint if exists orders_tickets_count_check;
alter table public.orders  add  constraint orders_ticket_type_check
  check (ticket_type in ('single','quad'));
alter table public.orders  add  constraint orders_tickets_count_check
  check (tickets_count in (1,4));

alter table public.tiers   drop column if exists price_pair;
alter table public.tiers   alter column price_quad drop not null;

-- ---------- public config view (never exposes the PINs) -------------

drop view if exists public.events_config_public;
create view public.events_config_public as
  select id, event_name, sales_start_at, sales_end_at, is_active, paybox_url, paybox_group_url, created_at
  from public.events_config;

-- ---------- access model ---------------------------------------------
-- Browsers only ever hold the anon key, so anon gets no direct access to
-- orders or tickets: no reads (names and phone numbers stay private) and no
-- writes (nobody can flip their own order to 'paid'). Everything goes
-- through the SECURITY DEFINER functions below, which check the shared PIN
-- wherever one is required. tiers stays readable - it is just the price list.

alter table public.events_config enable row level security;
alter table public.tiers          enable row level security;
alter table public.orders         enable row level security;
alter table public.tickets        enable row level security;

drop policy if exists "tiers read"        on public.tiers;
drop policy if exists "orders read"       on public.orders;
drop policy if exists "orders insert"     on public.orders;
drop policy if exists "orders update"     on public.orders;
drop policy if exists "tickets read"      on public.tickets;
drop policy if exists "tickets insert"    on public.tickets;
drop policy if exists "tickets update"    on public.tickets;

create policy "tiers read" on public.tiers for select to anon, authenticated using (true);

revoke all on public.events_config, public.orders, public.tickets from anon, authenticated;
revoke all on public.tiers from anon, authenticated;
grant select on public.tiers                to anon, authenticated;
grant select on public.events_config_public to anon, authenticated;

-- ---------- PIN checks (PINs stay server side) -----------------------

create or replace function public.verify_pin(p_pin text)
returns text
language sql
stable
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

-- Raises unless p_pin grants p_role. An admin PIN also passes as helper.
-- errcode 28000 lets the client tell "wrong PIN" apart from other errors
-- and drop back to the PIN screen when the PIN is changed mid-event.
create or replace function public._require_pin(p_pin text, p_role text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  granted text := public.verify_pin(p_pin);
begin
  if granted is null or (p_role = 'admin' and granted <> 'admin') then
    raise exception 'קוד שגוי' using errcode = '28000';
  end if;
end;
$$;

-- ---------- storefront -------------------------------------------------

-- Tickets already committed - everything except cancelled orders.
create or replace function public.sold_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(tickets_count), 0)::int
  from public.orders
  where payment_status <> 'cancelled';
$$;

-- The one place an order is created, for both the storefront and the admin's
-- manual entry. It takes a row lock on the events_config row first, so
-- concurrent calls run one at a time: each one counts the seats sold, picks
-- the tier and inserts while nobody else can, which is what makes the
-- capacity cap and the tier price hold under concurrent purchases.
--
-- Pricing rule: a group ticket is priced entirely at the active tier even if
-- that tier has fewer seats left than the group size (the count overflows
-- into the next tier). The event-wide capacity is a hard cap, though.
create or replace function public._create_order(
  p_buyer_name  text,
  p_buyer_phone text,
  p_ticket_type text,
  p_guest_names text[],
  p_status      text,
  p_source      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text   := btrim(coalesce(p_buyer_name, ''));
  v_phone  text   := btrim(coalesce(p_buyer_phone, ''));
  v_guests text[] := coalesce(p_guest_names, '{}');
  v_count  int;
  v_guest  text;
  v_cfg    public.events_config;
  v_sold   int;
  v_cum    int := 0;
  v_row    public.tiers;
  v_tier   public.tiers;
  v_price  numeric;
  v_order  public.orders;
begin
  v_count := case p_ticket_type when 'single' then 1 when 'quad' then 4 end;
  if v_count is null then
    raise exception 'סוג כרטיס לא תקין';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'נא למלא שם מלא';
  end if;
  if char_length(v_phone) > 30
     or char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 9 and 15 then
    raise exception 'נא למלא מספר טלפון תקין';
  end if;
  if coalesce(array_length(v_guests, 1), 0) <> v_count - 1 then
    raise exception 'נא למלא את שמות כל המשתתפים';
  end if;
  foreach v_guest in array v_guests loop
    if char_length(btrim(coalesce(v_guest, ''))) not between 2 and 80 then
      raise exception 'נא למלא את שמות כל המשתתפים';
    end if;
  end loop;

  select * into v_cfg
  from public.events_config
  order by created_at
  limit 1
  for update;
  if not found then
    raise exception 'האירוע לא הוגדר';
  end if;

  -- The admin can still add people once public sales have closed.
  if p_source = 'public'
     and (not v_cfg.is_active or now() < v_cfg.sales_start_at or now() > v_cfg.sales_end_at) then
    raise exception 'המכירה אינה פתוחה כרגע';
  end if;

  -- A fresh statement, so it sees every order committed before we got the lock.
  select coalesce(sum(tickets_count), 0)::int into v_sold
  from public.orders
  where payment_status <> 'cancelled';

  for v_row in select * from public.tiers order by sort_order loop
    v_cum := v_cum + v_row.capacity;
    if v_tier.id is null and v_sold < v_cum then
      v_tier := v_row;
    end if;
  end loop;

  if v_tier.id is null then
    raise exception 'הכרטיסים אזלו';
  end if;
  if v_sold + v_count > v_cum then
    raise exception 'נותרו רק % כרטיסים - בחרו כרטיס יחיד', v_cum - v_sold;
  end if;

  v_price := case p_ticket_type when 'single' then v_tier.price_single else v_tier.price_quad end;
  if v_price is null then
    raise exception 'כרטיסים קבוצתיים אזלו לסבב זה';
  end if;

  insert into public.orders
    (buyer_name, buyer_phone, ticket_type, tickets_count, total_amount, payment_status, tier_name, source)
  values
    (v_name, v_phone, p_ticket_type, v_count, v_price, p_status, v_tier.name, p_source)
  returning * into v_order;

  -- Buyer first. clock_timestamp() keeps that order when sorting by created_at.
  insert into public.tickets (order_id, attendee_name, phone, created_at)
  select v_order.id, btrim(u.name), v_phone, clock_timestamp()
  from unnest(array[v_name] || v_guests) with ordinality as u(name, pos)
  order by u.pos;

  return jsonb_build_object('order', to_jsonb(v_order), 'tier_name', v_tier.name);
end;
$$;

create or replace function public.create_order(
  p_buyer_name  text,
  p_buyer_phone text,
  p_ticket_type text,
  p_guest_names text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._create_order(p_buyer_name, p_buyer_phone, p_ticket_type, p_guest_names, 'pending', 'public');
end;
$$;

-- ---------- admin ------------------------------------------------------

create or replace function public.admin_create_order(
  p_pin         text,
  p_buyer_name  text,
  p_buyer_phone text,
  p_ticket_type text,
  p_guest_names text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'admin');
  return public._create_order(p_buyer_name, p_buyer_phone, p_ticket_type, p_guest_names, 'paid', 'manual');
end;
$$;

-- Every order, newest first, each with its tickets (buyer first).
create or replace function public.admin_orders(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'admin');
  return (
    select coalesce(jsonb_agg(
             to_jsonb(o) || jsonb_build_object('tickets', coalesce((
               select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
               from public.tickets t
               where t.order_id = o.id
             ), '[]'::jsonb))
             order by o.created_at desc
           ), '[]'::jsonb)
    from public.orders o
  );
end;
$$;

-- A cancelled order has given its seats back, so it cannot be revived here -
-- that would bypass the capacity check in _create_order.
create or replace function public.set_order_status(p_pin text, p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  perform public._require_pin(p_pin, 'admin');
  if p_status not in ('paid', 'cancelled') then
    raise exception 'סטטוס לא תקין';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ההזמנה לא נמצאה';
  end if;
  if v_order.payment_status = 'cancelled' then
    raise exception 'לא ניתן לשנות הזמנה שבוטלה';
  end if;

  update public.orders set payment_status = p_status where id = p_order_id
  returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

-- ---------- door ---------------------------------------------------------

-- Tickets of paid orders only, with just enough of the order to display.
create or replace function public.door_tickets(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'helper');
  return (
    select coalesce(jsonb_agg(
             to_jsonb(t) || jsonb_build_object('order', jsonb_build_object(
               'id', o.id,
               'buyer_name', o.buyer_name,
               'ticket_type', o.ticket_type,
               'payment_status', o.payment_status
             ))
             order by t.attendee_name
           ), '[]'::jsonb)
    from public.tickets t
    join public.orders o on o.id = t.order_id
    where o.payment_status = 'paid'
  );
end;
$$;

create or replace function public.set_check_in(p_pin text, p_ticket_id uuid, p_checked_in boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
begin
  perform public._require_pin(p_pin, 'helper');

  update public.tickets t
     set is_checked_in = p_checked_in,
         checked_in_at = case when p_checked_in then now() else null end
    from public.orders o
   where t.id = p_ticket_id
     and o.id = t.order_id
     and o.payment_status = 'paid'
  returning t.* into v_ticket;

  if not found then
    raise exception 'הכרטיס לא נמצא או שההזמנה לא שולמה';
  end if;
  return to_jsonb(v_ticket);
end;
$$;

-- ---------- function privileges ------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase adds
-- anon/authenticated on top, so the internal helpers are revoked explicitly.

revoke all on function public._require_pin(text, text)                           from public, anon, authenticated;
revoke all on function public._create_order(text, text, text, text[], text, text) from public, anon, authenticated;

grant execute on function public.verify_pin(text)                                 to anon, authenticated;
grant execute on function public.sold_count()                                     to anon, authenticated;
grant execute on function public.create_order(text, text, text, text[])           to anon, authenticated;
grant execute on function public.admin_create_order(text, text, text, text, text[]) to anon, authenticated;
grant execute on function public.admin_orders(text)                               to anon, authenticated;
grant execute on function public.set_order_status(text, uuid, text)               to anon, authenticated;
grant execute on function public.door_tickets(text)                               to anon, authenticated;
grant execute on function public.set_check_in(text, uuid, boolean)                to anon, authenticated;

-- ---------- seed data ------------------------------------------------

insert into public.events_config (event_name, sales_start_at, sales_end_at, is_active, paybox_url, helper_pin, admin_pin)
select 'PLAYGROUND', now() - interval '1 day', timestamptz '2026-10-23 11:00+03', true,
       'https://payboxapp.page.link/example', '1234', '9999'
where not exists (select 1 from public.events_config);

--  tier            capacity  single  quad (4 people)
--  מוקדמות             40      80      280   (70 ₪ לאדם)
--  כרטיס רגיל          80      90      320   (80 ₪ לאדם)
--  רגע אחרון           40     100      ----  (אין כרטיס קבוצתי)
insert into public.tiers (name, capacity, price_single, price_quad, sort_order)
select * from (values
  ('מוקדמות',    40,  80::numeric, 280::numeric, 1),
  ('כרטיס רגיל', 80,  90::numeric, 320::numeric, 2),
  ('רגע אחרון',  40, 100::numeric, null::numeric, 3)
) as t(name, capacity, price_single, price_quad, sort_order)
where not exists (select 1 from public.tiers);

-- Re-running on an install that still carries the old seed prices brings
-- the three tiers up to date in place.
update public.tiers t set
  name         = v.name,
  capacity     = v.capacity,
  price_single = v.price_single,
  price_quad   = v.price_quad
from (values
  (1, 'מוקדמות',    40,  80::numeric, 280::numeric),
  (2, 'כרטיס רגיל', 80,  90::numeric, 320::numeric),
  (3, 'רגע אחרון',  40, 100::numeric, null::numeric)
) as v(sort_order, name, capacity, price_single, price_quad)
where t.sort_order = v.sort_order;

-- ---------- live updates -----------------------------------------------
-- anon can no longer read orders/tickets, so postgres_changes would deliver
-- nothing to it. Instead every write sends a content-free "changed" ping on
-- the public broadcast topic 'event-updates', and /door and /admin refetch
-- through their PIN-checked functions. The ping carries no names or phones.
-- If Realtime is unavailable the write still succeeds and the clients fall
-- back to polling.

create or replace function public._notify_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'event-updates', false);
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public._notify_change() from public, anon, authenticated;

drop trigger if exists orders_notify_change  on public.orders;
drop trigger if exists tickets_notify_change on public.tickets;
create trigger orders_notify_change  after insert or update or delete on public.orders
  for each statement execute function public._notify_change();
create trigger tickets_notify_change after insert or update or delete on public.tickets
  for each statement execute function public._notify_change();

-- Earlier versions published the tables themselves; take them back out.
do $$
begin
  alter publication supabase_realtime drop table public.orders;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime drop table public.tickets;
exception when others then null;
end $$;
