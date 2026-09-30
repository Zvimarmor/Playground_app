-- =========================================================
--  Migration: staff / helper tickets (is_manual)
--  Safe to run in the Supabase SQL editor on the LIVE database.
--
--  * Adds one column with a default - every existing order gets
--    is_manual = false, so current orders keep counting exactly as before.
--  * Replaces four functions in place (same signatures, so the existing
--    EXECUTE grants are kept). No table is dropped, truncated or rewritten,
--    and no existing row is updated or deleted.
--  * Idempotent: running it twice is harmless.
--  * Runs in one transaction - if any statement fails, nothing changes.
-- =========================================================

begin;

alter table public.orders add column if not exists is_manual boolean not null default false;

-- Public tickets only: cancelled orders and staff/helper tickets are excluded.
create or replace function public.sold_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(tickets_count), 0)::int
  from public.orders
  where payment_status <> 'cancelled'
    and not is_manual;
$$;

-- Manual entries (p_source = 'manual') are free, is_manual = true, have no
-- tier and skip the capacity cap. Public orders now count only public seats.
create or replace function public._create_order(
  p_buyer_name   text,
  p_buyer_phone  text,
  p_ticket_type  text,
  p_guest_names  text[],
  p_guest_phones text[],
  p_status       text,
  p_source       text
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
  v_phones text[] := coalesce(p_guest_phones, '{}');
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
  if coalesce(array_length(v_phones, 1), 0) > v_count - 1 then
    raise exception 'מספר טלפון של משתתף אינו תקין';
  end if;
  foreach v_guest in array v_phones loop
    if btrim(coalesce(v_guest, '')) <> ''
       and (char_length(btrim(v_guest)) > 30
            or char_length(regexp_replace(v_guest, '\D', '', 'g')) not between 9 and 15) then
      raise exception 'מספר טלפון של משתתף אינו תקין';
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

  if p_source = 'manual' then
    v_price := 0;
  else
    -- A fresh statement, so it sees every order committed before we got the lock.
    select coalesce(sum(tickets_count), 0)::int into v_sold
    from public.orders
    where payment_status <> 'cancelled'
      and not is_manual;

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
  end if;

  insert into public.orders
    (buyer_name, buyer_phone, ticket_type, tickets_count, total_amount, payment_status, tier_name, source, is_manual)
  values
    (v_name, v_phone, p_ticket_type, v_count, v_price, p_status, v_tier.name, p_source, p_source = 'manual')
  returning * into v_order;

  -- Buyer first. clock_timestamp() keeps that order when sorting by created_at.
  -- v_phones[0] is null, so the buyer's own row always takes v_phone.
  insert into public.tickets (order_id, attendee_name, phone, created_at)
  select v_order.id, btrim(u.name), coalesce(nullif(btrim(v_phones[u.pos - 1]), ''), v_phone), clock_timestamp()
  from unnest(array[v_name] || v_guests) with ordinality as u(name, pos)
  order by u.pos;

  return jsonb_build_object('order', to_jsonb(v_order), 'tier_name', v_tier.name);
end;
$$;

-- Staff / helper tickets: created paid, free, and outside the public cap.
create or replace function public.admin_create_order(
  p_pin          text,
  p_buyer_name   text,
  p_buyer_phone  text,
  p_ticket_type  text,
  p_guest_names  text[] default '{}',
  p_guest_phones text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'admin');
  return public._create_order(p_buyer_name, p_buyer_phone, p_ticket_type, p_guest_names, p_guest_phones, 'paid', 'manual');
end;
$$;

-- /door gets is_manual so helpers can be badged. Only paid orders are listed,
-- so a cancelled order's tickets drop off the list.
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
               'payment_status', o.payment_status,
               'is_manual', o.is_manual
             ))
             order by t.attendee_name
           ), '[]'::jsonb)
    from public.tickets t
    join public.orders o on o.id = t.order_id
    where o.payment_status = 'paid'
  );
end;
$$;

commit;
