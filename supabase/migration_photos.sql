-- =========================================================
--  Migration: "Find My Photos" - event album + face search
--  Safe to run in the Supabase SQL editor on the LIVE database.
--
--  * Adds pgvector, two new tables (photos, photo_faces), the public
--    Storage bucket 'event-photos' and four functions.
--  * Touches nothing that exists today: no ticketing table, function or
--    row is changed.
--  * Idempotent: running it twice is harmless.
--  * Runs in one transaction - if any statement fails, nothing changes.
--
--  Face embeddings are biometric data, so neither table is readable with
--  the anon key. The album is filled through admin_add_photo() (admin PIN)
--  and searched only through find_my_photos(), which returns photos, never
--  embeddings.
-- =========================================================

begin;

create extension if not exists vector with schema extensions;

-- ---------- tables -------------------------------------------------

-- One row per album photo. source_key is "<file name>|<size in bytes>" of
-- the original, so re-running the indexer over the same folder skips what
-- is already in. path / thumb_path point into the 'event-photos' bucket.
create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  source_key  text not null unique,
  path        text not null,
  thumb_path  text not null,
  width       int  not null,
  height      int  not null,
  face_count  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- One row per face found in a photo. embedding is the L2-normalised
-- 512-d ArcFace (w600k_mbf) vector; box is x1,y1,x2,y2 in display-copy pixels.
create table if not exists public.photo_faces (
  id         bigint generated always as identity primary key,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  embedding  extensions.vector(512) not null,
  box        real[] not null,
  score      real   not null
);
create index if not exists photo_faces_photo_id_idx on public.photo_faces (photo_id);

-- A ~1,300 photo album holds a few thousand faces, so find_my_photos() does
-- an exact scan in a few milliseconds. No ANN index on purpose: HNSW would
-- be approximate and could silently drop photos that pass the threshold.

alter table public.photos      enable row level security;
alter table public.photo_faces enable row level security;
revoke all on public.photos, public.photo_faces from anon, authenticated;

-- ---------- storage --------------------------------------------------

-- 30 MB per file leaves room for the full-resolution originals that
-- upload_and_rotate.py --upload puts under originals/.
-- Public bucket: a photo is fetched by its URL, which is a random UUID that
-- only find_my_photos() hands out. There is no SELECT policy, so the anon
-- key cannot list the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', true, 31457280, array['image/jpeg'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploads need the admin PIN. The indexer sends it in an x-admin-pin header,
-- which Storage exposes to policies through request.headers.
drop policy if exists "event-photos admin upload" on storage.objects;
create policy "event-photos admin upload" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'event-photos'
    and public.verify_pin(nullif(current_setting('request.headers', true), '')::json ->> 'x-admin-pin') = 'admin'
  );

-- ---------- search -------------------------------------------------

-- Every photo that has at least one face with cosine similarity >=
-- p_threshold to p_embedding, best match first. 0.42 is the default; the
-- page offers 0.38 ("expanded search") and 0.46 ("not me"). The threshold is
-- clamped to that range here, so no client can lower it far enough to list
-- the whole album. p_embedding must be unit length - a zero vector would make
-- every similarity NaN, and NaN sorts above any number in Postgres.
--
-- The first version took no threshold. Dropped explicitly: CREATE OR REPLACE
-- with a new parameter would add a second overload, and PostgREST cannot pick
-- between find_my_photos(vector) and find_my_photos(vector, float).
drop function if exists public.find_my_photos(extensions.vector);

create or replace function public.find_my_photos(
  p_embedding extensions.vector(512),
  p_threshold float default 0.42
)
returns table (id uuid, path text, thumb_path text, width int, height int, similarity real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_threshold float := greatest(0.38, least(0.46, coalesce(p_threshold, 0.42)));
begin
  if p_embedding is null or abs(extensions.vector_norm(p_embedding) - 1) > 0.01 then
    raise exception 'invalid embedding' using errcode = '22023';
  end if;

  return query
  select p.id, p.path, p.thumb_path, p.width, p.height, m.similarity::real
  from (
    select f.photo_id, max(1 - (f.embedding <=> p_embedding)) as similarity
    from public.photo_faces f
    where 1 - (f.embedding <=> p_embedding) >= v_threshold
    group by f.photo_id
  ) m
  join public.photos p on p.id = m.photo_id
  order by m.similarity desc, p.created_at;
end;
$$;

-- ---------- admin: indexing ------------------------------------------

-- What is already in the album, so the indexer can resume after a stop.
create or replace function public.admin_photos(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_pin(p_pin, 'admin');
  return jsonb_build_object(
    'source_keys', coalesce((select jsonb_agg(source_key) from public.photos), '[]'::jsonb),
    'faces',       (select count(*) from public.photo_faces)
  );
end;
$$;

-- Records one uploaded photo and its faces. p_faces is
-- [{"embedding": [512 numbers], "box": [x1,y1,x2,y2], "score": 0.87}, ...].
-- Re-indexing the same source_key replaces its row and all its faces.
create or replace function public.admin_add_photo(
  p_pin        text,
  p_source_key text,
  p_path       text,
  p_thumb_path text,
  p_width      int,
  p_height     int,
  p_faces      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  perform public._require_pin(p_pin, 'admin');

  insert into public.photos (source_key, path, thumb_path, width, height, face_count)
  values (p_source_key, p_path, p_thumb_path, p_width, p_height, jsonb_array_length(p_faces))
  on conflict (source_key) do update set
    path       = excluded.path,
    thumb_path = excluded.thumb_path,
    width      = excluded.width,
    height     = excluded.height,
    face_count = excluded.face_count
  returning id into v_id;

  delete from public.photo_faces where photo_id = v_id;

  insert into public.photo_faces (photo_id, embedding, box, score)
  select v_id,
         (f ->> 'embedding')::extensions.vector(512),
         array(select jsonb_array_elements_text(f -> 'box')::real),
         (f ->> 'score')::real
  from jsonb_array_elements(p_faces) f;

  return v_id;
end;
$$;

-- ---------- function privileges ------------------------------------------

grant execute on function public.find_my_photos(extensions.vector, float)                to anon, authenticated;
grant execute on function public.admin_photos(text)                                       to anon, authenticated;
grant execute on function public.admin_add_photo(text, text, text, text, int, int, jsonb) to anon, authenticated;

commit;
