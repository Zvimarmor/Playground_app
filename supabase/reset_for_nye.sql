-- =========================================================
--  Reset for the next event: PLAYGROUND סילבסטר, 31.12.2026
--  Run once in the Supabase SQL editor on the LIVE database.
--
--  BACK UP FIRST. This deletes every order and ticket of 23.10:
--    node --env-file=.env scripts/export-orders.mjs backups/customers_23_10.csv
--
--  What it does, in one transaction (an error anywhere changes nothing):
--    1. Album privacy: guests can no longer read public.photos directly. The
--       full album is admin-only, through admin_photo_page() (admin PIN).
--       find_my_photos() is SECURITY DEFINER, so selfie search keeps working.
--    2. Deletes the 23.10 orders. Their tickets go with them (on delete cascade).
--    3. Reopens sales in events_config.
--
--  What it does NOT touch:
--    * photos, photo_faces and Storage - every album photo stays.
--    * The PayBox links (paybox_url, paybox_group_url), the PINs and the tiers.
--      There is no sold counter: the sold count is summed from orders, so with
--      the old orders gone it is 0 and the first tier (מוקדמות) is active.
--
--  Safe to re-run: the delete only matches orders from before 24.10.2026, so
--  orders placed for New Year's Eve are never touched.
-- =========================================================

begin;

-- ---------- 1. album privacy ------------------------------------------
-- Same statements as migration_photos.sql, which now matches this.

drop policy if exists "photos public read" on public.photos;
revoke all on public.photos, public.photo_faces from anon, authenticated;

-- One page of the whole album for the admin gallery, newest first. id breaks
-- created_at ties so pages never reshuffle. At most 100 rows per call.
create or replace function public.admin_photo_page(p_pin text, p_from int default 0, p_limit int default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'admin');
  return jsonb_build_object(
    'total',  (select count(*) from public.photos),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'path', p.path, 'thumb_path', p.thumb_path, 'width', p.width, 'height', p.height
             ) order by p.created_at desc, p.id)
      from (
        select * from public.photos
        order by created_at desc, id
        offset greatest(coalesce(p_from, 0), 0)
        limit least(greatest(coalesce(p_limit, 24), 1), 100)
      ) p
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.admin_photo_page(text, int, int) to anon, authenticated;

-- ---------- 2. clear the 23.10 orders and tickets ------------------------

delete from public.orders
where created_at < timestamptz '2026-10-24 00:00+03';

-- ---------- 3. reopen sales ---------------------------------------------
-- Sales close when the party starts. 22:00 is a placeholder until the
-- time is set - change it here (or later with a one-line update).

update public.events_config set
  event_name     = 'PLAYGROUND סילבסטר',
  sales_start_at = now(),
  sales_end_at   = timestamptz '2026-12-31 22:00+02',
  is_active      = true
where id = (select id from public.events_config order by created_at limit 1);

commit;

-- ---------- check ---------------------------------------------------------
-- Expect: orders 0, tickets 0, sold 0, active tier מוקדמות, the PayBox links
-- as before, and anon_can_read_photos false.

select
  (select count(*) from public.orders)                                      as orders,
  (select count(*) from public.tickets)                                     as tickets,
  public.sold_count()                                                       as sold,
  (select name from public.tiers order by sort_order limit 1)               as active_tier,
  c.event_name,
  c.sales_start_at,
  c.sales_end_at,
  c.is_active,
  c.paybox_url,
  c.paybox_group_url,
  (select count(*) from public.photos)                                      as album_photos,
  has_table_privilege('anon', 'public.photos', 'select')
    or has_any_column_privilege('anon', 'public.photos', 'select')          as anon_can_read_photos
from public.events_config c
order by c.created_at
limit 1;
