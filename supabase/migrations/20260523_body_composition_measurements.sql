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

create table if not exists public.body_composition_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at date not null,
  source text not null default 'InBody',
  weight_kg numeric,
  body_fat_percent numeric,
  body_fat_mass_kg numeric,
  skeletal_muscle_mass_kg numeric,
  basal_metabolic_rate_kcal numeric,
  visceral_fat_level numeric,
  ecw_ratio numeric,
  body_cell_mass_kg numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists body_composition_measurements_user_measured_at_idx
  on public.body_composition_measurements (user_id, measured_at desc);

drop trigger if exists body_composition_measurements_set_updated_at on public.body_composition_measurements;
create trigger body_composition_measurements_set_updated_at
before update on public.body_composition_measurements
for each row execute function public.set_updated_at_timestamp();

alter table public.body_composition_measurements enable row level security;

drop policy if exists "Users can view their own body composition measurements" on public.body_composition_measurements;
create policy "Users can view their own body composition measurements"
  on public.body_composition_measurements for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own body composition measurements" on public.body_composition_measurements;
create policy "Users can insert their own body composition measurements"
  on public.body_composition_measurements for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own body composition measurements" on public.body_composition_measurements;
create policy "Users can update their own body composition measurements"
  on public.body_composition_measurements for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own body composition measurements" on public.body_composition_measurements;
create policy "Users can delete their own body composition measurements"
  on public.body_composition_measurements for delete
  using (auth.uid() = user_id);
