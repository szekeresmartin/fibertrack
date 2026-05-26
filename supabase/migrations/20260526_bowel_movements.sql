create extension if not exists pgcrypto;

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.bowel_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.bowel_movements
  add column if not exists id uuid,
  add column if not exists user_id uuid,
  add column if not exists occurred_at timestamptz,
  add column if not exists notes text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

create index if not exists bowel_movements_user_occurred_at_idx
  on public.bowel_movements (user_id, occurred_at desc);

alter table public.bowel_movements enable row level security;

drop policy if exists "Users can view their own bowel movements" on public.bowel_movements;
create policy "Users can view their own bowel movements"
  on public.bowel_movements for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own bowel movements" on public.bowel_movements;
create policy "Users can insert their own bowel movements"
  on public.bowel_movements for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own bowel movements" on public.bowel_movements;
create policy "Users can update their own bowel movements"
  on public.bowel_movements for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own bowel movements" on public.bowel_movements;
create policy "Users can delete their own bowel movements"
  on public.bowel_movements for delete
  using (auth.uid() = user_id);

drop trigger if exists bowel_movements_set_updated_at on public.bowel_movements;
create trigger bowel_movements_set_updated_at
before update on public.bowel_movements
for each row execute function public.set_updated_at_timestamp();
