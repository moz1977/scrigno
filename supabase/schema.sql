-- Scrigno: tabelle per la sincronizzazione su Supabase.
-- Incolla tutto in Supabase → SQL Editor → New query → Run.

create table if not exists public.boards (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null,
  color       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.items (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  board_id    uuid references public.boards(id) on delete set null,
  url         text not null,
  title       text default '',
  thumbnail   text default '',
  platform    text default 'web',
  tags        text[] not null default '{}',
  note        text default '',
  created_at  timestamptz not null default now()
);

create index if not exists items_user_created_idx on public.items (user_id, created_at desc);
create index if not exists items_tags_idx on public.items using gin (tags);

-- Ognuno vede e modifica solo i propri dati.
alter table public.boards enable row level security;
alter table public.items  enable row level security;

drop policy if exists "boards_own" on public.boards;
create policy "boards_own" on public.boards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "items_own" on public.items;
create policy "items_own" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
