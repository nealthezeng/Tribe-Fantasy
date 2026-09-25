-- Foundation tables. Later milestones add their own tables in later migrations.
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'stat_keeper', 'treasurer')),
  primary key (user_id, role)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status text not null default 'setup' check (status in ('setup', 'live', 'finished')),
  donations_open_at timestamptz,
  bid_close_at timestamptz,
  leftover_bid_close_at timestamptz,
  trade_deadline timestamptz,
  season_end_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (season_id, name)
);

create table public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{6,20}$'),
  league_id uuid not null references public.leagues (id) on delete cascade,
  max_uses int not null default 50 check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_name text not null check (length(team_name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (league_id, user_id),
  unique (league_id, team_name)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  user_id uuid references auth.users (id) on delete set null,
  opted_in boolean not null default true,
  created_at timestamptz not null default now(),
  unique (season_id, name)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
