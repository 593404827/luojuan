create extension if not exists "pgcrypto";

create table if not exists public.books (
  id text primary key,
  title text not null,
  current_chapter_id text not null,
  selected_filters text[] default '{}',
  draft_title text,
  draft_content text,
  draft_tags text[] default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id text primary key,
  book_id text not null references public.books(id) on delete cascade,
  title text not null,
  status text not null,
  summary text not null,
  content text[] default '{}',
  tags text[] default '{}',
  note text default '',
  cover text default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_chapters_book_id on public.chapters(book_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  mode text not null check (mode in ('random', 'direct', 'continue')),
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(book_id, mode)
);

create index if not exists idx_conversations_book_id on public.conversations(book_id);
