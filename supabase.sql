create extension if not exists pgcrypto;
create table if not exists public.players(id uuid primary key,username text unique not null check(char_length(username) between 2 and 24),coins bigint not null default 1000 check(coins>=0),created_at timestamptz not null default now());
create type public.game_key as enum('kitti','teen-patti','poker');
create table if not exists public.rooms(id uuid primary key default gen_random_uuid(),code text unique not null,game public.game_key not null,host_id uuid not null references public.players(id),status text not null default 'waiting',max_players int not null,state jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create table if not exists public.room_players(room_id uuid references public.rooms(id) on delete cascade,player_id uuid references public.players(id) on delete cascade,username text not null,coins bigint not null default 1000,seat int not null,primary key(room_id,player_id),unique(room_id,seat));
create table if not exists public.coin_ledger(id uuid primary key default gen_random_uuid(),player_id uuid references public.players(id) on delete cascade,kind text not null,amount bigint not null,note text,created_at timestamptz not null default now());
alter table public.players enable row level security;alter table public.rooms enable row level security;alter table public.room_players enable row level security;alter table public.coin_ledger enable row level security;
drop policy if exists players_public on public.players;create policy players_public on public.players for all to anon,authenticated using(true) with check(true);
drop policy if exists rooms_public on public.rooms;create policy rooms_public on public.rooms for all to anon,authenticated using(true) with check(true);
drop policy if exists room_players_public on public.room_players;create policy room_players_public on public.room_players for all to anon,authenticated using(true) with check(true);
drop policy if exists ledger_public on public.coin_ledger;create policy ledger_public on public.coin_ledger for select to anon,authenticated using(true);
alter table public.rooms replica identity full;alter table public.room_players replica identity full;
-- In Supabase Dashboard > Database > Replication, enable realtime for rooms and room_players.
