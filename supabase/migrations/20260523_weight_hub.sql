create extension if not exists pgcrypto;

-- FiberTrack weight hub migration
-- Extends the existing daily weight log table and adds per-user activity templates.

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.activity_day_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_key text,
  name text not null,
  type text not null check (type in ('rest', 'gym', 'match', 'hike', 'custom')),
  default_steps integer,
  default_training_minutes integer,
  default_intensity text check (default_intensity in ('low', 'moderate', 'high', 'very_high') or default_intensity is null),
  estimated_activity_kcal numeric not null default 0,
  learned_offset_kcal numeric,
  confidence text not null default 'insufficient_data' check (confidence in ('insufficient_data', 'low', 'medium', 'high')),
  include_in_adaptive_model boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists activity_day_templates_user_template_key_idx
  on public.activity_day_templates (user_id, template_key);

drop trigger if exists activity_day_templates_set_updated_at on public.activity_day_templates;
create trigger activity_day_templates_set_updated_at
before update on public.activity_day_templates
for each row execute function public.set_updated_at_timestamp();

alter table if exists public.weight_entries
  add column if not exists calories numeric,
  add column if not exists protein_grams numeric,
  add column if not exists carbs_grams numeric,
  add column if not exists fat_grams numeric,
  add column if not exists alcohol_grams numeric,
  add column if not exists activity_template_id uuid references public.activity_day_templates(id) on delete set null,
  add column if not exists steps integer,
  add column if not exists training_minutes integer,
  add column if not exists intensity text check (intensity in ('low', 'moderate', 'high', 'very_high') or intensity is null),
  add column if not exists notes text,
  add column if not exists trend_weight_kg numeric,
  add column if not exists is_weight_outlier boolean not null default false,
  add column if not exists is_calorie_outlier boolean not null default false,
  add column if not exists exclude_from_adaptive_tdee boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists weight_entries_user_date_idx
  on public.weight_entries (user_id, date);

alter table public.activity_day_templates enable row level security;

drop policy if exists "Users can view their own activity templates" on public.activity_day_templates;
create policy "Users can view their own activity templates"
  on public.activity_day_templates for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own activity templates" on public.activity_day_templates;
create policy "Users can insert their own activity templates"
  on public.activity_day_templates for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own activity templates" on public.activity_day_templates;
create policy "Users can update their own activity templates"
  on public.activity_day_templates for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own activity templates" on public.activity_day_templates;
create policy "Users can delete their own activity templates"
  on public.activity_day_templates for delete
  using (auth.uid() = user_id);

create or replace function public.seed_default_activity_templates_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_day_templates (
    user_id,
    template_key,
    name,
    type,
    default_steps,
    default_training_minutes,
    default_intensity,
    estimated_activity_kcal,
    learned_offset_kcal,
    confidence,
    include_in_adaptive_model,
    is_default
  ) values
    (new.id, 'rest', 'Rest day', 'rest', 5000, 0, 'low', 0, 0, 'insufficient_data', true, true),
    (new.id, 'gym', 'Gym day', 'gym', 8000, 75, 'moderate', 250, 0, 'insufficient_data', true, true),
    (new.id, 'match', 'Match day', 'match', 12000, 90, 'very_high', 600, 0, 'insufficient_data', true, true),
    (new.id, 'hike', 'Hiking day', 'hike', 18000, 180, 'moderate', 700, 0, 'insufficient_data', true, true)
  on conflict (user_id, template_key)
  do update set
    name = excluded.name,
    type = excluded.type,
    default_steps = excluded.default_steps,
    default_training_minutes = excluded.default_training_minutes,
    default_intensity = excluded.default_intensity,
    estimated_activity_kcal = excluded.estimated_activity_kcal,
    learned_offset_kcal = excluded.learned_offset_kcal,
    confidence = excluded.confidence,
    include_in_adaptive_model = excluded.include_in_adaptive_model,
    is_default = excluded.is_default,
    updated_at = now()
  where public.activity_day_templates.is_default = true;

  return new;
end;
$$;

insert into public.activity_day_templates (
  user_id,
  template_key,
  name,
  type,
  default_steps,
  default_training_minutes,
  default_intensity,
  estimated_activity_kcal,
  learned_offset_kcal,
  confidence,
  include_in_adaptive_model,
  is_default
)
select
  u.id,
  t.template_key,
  t.name,
  t.type,
  t.default_steps,
  t.default_training_minutes,
  t.default_intensity,
  t.estimated_activity_kcal,
  t.learned_offset_kcal,
  t.confidence,
  t.include_in_adaptive_model,
  t.is_default
from auth.users u
cross join (
  values
    ('rest', 'Rest day', 'rest', 5000, 0, 'low', 0, 0, 'insufficient_data', true, true),
    ('gym', 'Gym day', 'gym', 8000, 75, 'moderate', 250, 0, 'insufficient_data', true, true),
    ('match', 'Match day', 'match', 12000, 90, 'very_high', 600, 0, 'insufficient_data', true, true),
    ('hike', 'Hiking day', 'hike', 18000, 180, 'moderate', 700, 0, 'insufficient_data', true, true)
) as t(
  template_key,
  name,
  type,
  default_steps,
  default_training_minutes,
  default_intensity,
  estimated_activity_kcal,
  learned_offset_kcal,
  confidence,
  include_in_adaptive_model,
  is_default
)
on conflict (user_id, template_key)
do update set
  name = excluded.name,
  type = excluded.type,
  default_steps = excluded.default_steps,
  default_training_minutes = excluded.default_training_minutes,
  default_intensity = excluded.default_intensity,
  estimated_activity_kcal = excluded.estimated_activity_kcal,
  learned_offset_kcal = excluded.learned_offset_kcal,
  confidence = excluded.confidence,
  include_in_adaptive_model = excluded.include_in_adaptive_model,
  is_default = excluded.is_default,
  updated_at = now()
where public.activity_day_templates.is_default = true;

drop trigger if exists on_auth_user_created_seed_activity_templates on auth.users;
create trigger on_auth_user_created_seed_activity_templates
after insert on auth.users
for each row execute function public.seed_default_activity_templates_for_user();
