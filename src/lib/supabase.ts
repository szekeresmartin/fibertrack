import { createClient } from '@supabase/supabase-js';

/*
  SQL SCHEMA FOR SUPABASE:
  
  -- Create the meals table
  create table meals (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade,
    name text not null,
    time text not null,
    items jsonb not null default '[]'::jsonb,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
  );

  -- Enable Row Level Security (RLS)
  alter table meals enable row level security;

  -- Create policies
  create policy "Users can view their own meals."
    on meals for select
    using ( auth.uid() = user_id );

  create policy "Users can insert their own meals."
    on meals for insert
    with check ( auth.uid() = user_id );

  create policy "Users can update their own meals."
    on meals for update
    using ( auth.uid() = user_id );

  create policy "Users can delete their own meals."
    on meals for delete
    using ( auth.uid() = user_id );
*/

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || 'https://adcfsrsyhzntkdzqijgb.supabase.co';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkY2ZzcnN5aHpudGtkenFpamdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDExMzgsImV4cCI6MjA5MTc3NzEzOH0.c7knPcTvKbrMDaOVxMxYwZxkXPGJUpho8SPzVIS3pDE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
