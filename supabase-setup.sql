create table if not exists public.reports (
  id bigint primary key,
  type text not null,
  title text not null,
  location text not null,
  status text not null default 'Needs attention',
  status_class text not null default 'open',
  coords jsonb,
  amount text,
  severity text,
  notes text,
  date date,
  risk boolean not null default false,
  image text,
  picked_up boolean not null default false,
  picked_up_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "Anyone can read reports"
  on public.reports for select
  to anon
  using (true);

create policy "Anyone can submit reports"
  on public.reports for insert
  to anon
  with check (true);

create policy "Anyone can update pickup status"
  on public.reports for update
  to anon
  using (true)
  with check (true);

create policy "Anyone can delete pickup history"
  on public.reports for delete
  to anon
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table public.reports;
  end if;
end $$;

create table if not exists public.impact_entries (
  id bigint primary key,
  cleanup_date date not null,
  location text not null,
  bags integer not null default 0,
  volunteers integer not null default 0,
  hours numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.impact_entries enable row level security;

drop policy if exists "Anyone can read impact entries" on public.impact_entries;
drop policy if exists "Anyone can add impact entries" on public.impact_entries;
drop policy if exists "Anyone can edit impact entries" on public.impact_entries;
drop policy if exists "Anyone can delete impact entries" on public.impact_entries;

create policy "Anyone can read impact entries"
  on public.impact_entries for select to anon using (true);
create policy "Anyone can add impact entries"
  on public.impact_entries for insert to anon with check (true);
create policy "Anyone can edit impact entries"
  on public.impact_entries for update to anon using (true) with check (true);
create policy "Anyone can delete impact entries"
  on public.impact_entries for delete to anon using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'impact_entries'
  ) then
    alter publication supabase_realtime add table public.impact_entries;
  end if;
end $$;
