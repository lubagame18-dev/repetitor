-- Платформа «Учу по ФРП · репетиторство»: ученики, тесты, домашки, сочинения, общая доска.
-- Выполнить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Файл можно запускать повторно (например, после обновления) – данные не удаляются.

create extension if not exists pgcrypto;

-- Ученики. Каждый учитель видит только своих.
create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  course      text not null default 'oge-rus',
  code        text not null unique,
  note        text,
  created_at  timestamptz not null default now()
);

-- Попытки тестов: kind = 'lesson' (тест на занятии) или 'hw' (тест по домашнему заданию).
create table if not exists public.results (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  kind        text not null default 'lesson',
  score       int  not null check (score >= 0),
  total       int  not null check (total > 0 and total <= 100),
  wrong       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.results add column if not exists kind text not null default 'lesson';
create index if not exists results_student_idx on public.results(student_id);

-- Домашние задания: отметка ученика + проверка учителя.
create table if not exists public.homework (
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  note        text,
  sent_at     timestamptz,
  status      text not null default 'sent' check (status in ('sent','accepted','redo')),
  grade       text,
  comment     text,
  reviewed_at timestamptz,
  primary key (student_id, lesson_id)
);

-- Сочинения и изложения: текст ученика + оценка учителя по критериям.
create table if not exists public.writings (
  student_id   uuid not null references public.students(id) on delete cascade,
  lesson_id    text not null,
  kind         text not null,              -- '13.1' | '13.2' | '13.3' | 'izl' | 'thesis' | 'example'
  text_id      text,
  body         text,
  words        int,
  submitted_at timestamptz,
  status       text not null default 'sent' check (status in ('sent','reviewed','redo')),
  scores       jsonb not null default '{}'::jsonb,   -- {"СК1":1,"СК2":3,...}
  errors       jsonb not null default '{}'::jsonb,   -- {"orf":2,"punct":1,...}
  total        int,
  max          int,
  comment      text,
  reviewed_at  timestamptz,
  primary key (student_id, lesson_id)
);

-- Ссылки на рабочие листы к занятиям (у каждого учителя свои).
create table if not exists public.sheets (
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course      text not null,
  lesson_id   text not null,
  name        text,
  url         text,
  note        text,
  primary key (teacher_id, course, lesson_id)
);

-- Общая доска: штрихи и надписи. lesson_id = 'l01:practice' и т. п.
create table if not exists public.board_items (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  item        jsonb not null,
  author      text not null default 'student',
  created_at  timestamptz not null default now()
);
create index if not exists board_items_idx on public.board_items(student_id, lesson_id);

-- ---------- Права учителя ----------
alter table public.students    enable row level security;
alter table public.results     enable row level security;
alter table public.homework    enable row level security;
alter table public.writings    enable row level security;
alter table public.sheets      enable row level security;
alter table public.board_items enable row level security;

drop policy if exists "teacher_students" on public.students;
create policy "teacher_students" on public.students for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists "teacher_results" on public.results;
create policy "teacher_results" on public.results for all to authenticated
  using (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists "teacher_homework" on public.homework;
create policy "teacher_homework" on public.homework for all to authenticated
  using (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists "teacher_writings" on public.writings;
create policy "teacher_writings" on public.writings for all to authenticated
  using (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists "teacher_board" on public.board_items;
create policy "teacher_board" on public.board_items for all to authenticated
  using (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()));

drop policy if exists "teacher_sheets" on public.sheets;
create policy "teacher_sheets" on public.sheets for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- ---------- Ученик входит по коду: только эти функции, без доступа к таблицам ----------
create or replace function public.student_id_by_code(p_code text)
returns uuid language sql security definer set search_path = public stable as $$
  select id from students where code = upper(trim(p_code));
$$;
revoke all on function public.student_id_by_code(text) from public, anon, authenticated;

create or replace function public.student_login(p_code text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('id', id, 'name', name, 'course', course)
  from students where code = upper(trim(p_code));
$$;

create or replace function public.student_state(p_code text)
returns json language sql security definer set search_path = public stable as $$
  with s as (select * from students where code = upper(trim(p_code)))
  select json_build_object(
    'results',  coalesce((select json_agg(json_build_object('lesson_id', r.lesson_id, 'kind', r.kind, 'score', r.score, 'total', r.total, 'wrong', r.wrong, 'created_at', r.created_at) order by r.created_at)
                          from results r join s on r.student_id = s.id), '[]'::json),
    'homework', coalesce((select json_agg(json_build_object('lesson_id', h.lesson_id, 'note', h.note, 'status', h.status, 'grade', h.grade, 'comment', h.comment, 'sent_at', h.sent_at))
                          from homework h join s on h.student_id = s.id), '[]'::json),
    'writings', coalesce((select json_agg(json_build_object('lesson_id', w.lesson_id, 'kind', w.kind, 'text_id', w.text_id, 'body', w.body, 'words', w.words, 'status', w.status, 'scores', w.scores, 'errors', w.errors, 'total', w.total, 'max', w.max, 'comment', w.comment, 'submitted_at', w.submitted_at))
                          from writings w join s on w.student_id = s.id), '[]'::json),
    'sheets',   coalesce((select json_agg(json_build_object('lesson_id', x.lesson_id, 'name', x.name, 'url', x.url, 'note', x.note))
                          from sheets x join s on x.teacher_id = s.teacher_id and x.course = s.course), '[]'::json)
  ) from s;
$$;

drop function if exists public.student_submit_result(text, text, int, int, jsonb);
create or replace function public.student_submit_result(p_code text, p_lesson text, p_score int, p_total int, p_wrong jsonb, p_kind text default 'lesson')
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  if p_score < 0 or p_total <= 0 or p_score > p_total or p_total > 100 then raise exception 'bad score'; end if;
  insert into results(student_id, lesson_id, kind, score, total, wrong)
  values (sid, left(p_lesson, 40), case when p_kind = 'hw' then 'hw' else 'lesson' end, p_score, p_total, coalesce(p_wrong, '[]'::jsonb));
end $$;

create or replace function public.student_submit_homework(p_code text, p_lesson text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  insert into homework(student_id, lesson_id, note, sent_at, status)
  values (sid, left(p_lesson, 40), left(p_note, 2000), now(), 'sent')
  on conflict (student_id, lesson_id) do update
    set note = excluded.note, sent_at = now(),
        status = case when homework.status = 'accepted' then 'accepted' else 'sent' end;
end $$;

create or replace function public.student_submit_writing(p_code text, p_lesson text, p_kind text, p_text text, p_body text, p_words int)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  insert into writings(student_id, lesson_id, kind, text_id, body, words, submitted_at, status)
  values (sid, left(p_lesson, 40), left(p_kind, 10), left(p_text, 10), left(p_body, 20000), p_words, now(), 'sent')
  on conflict (student_id, lesson_id) do update
    set kind = excluded.kind, text_id = excluded.text_id, body = excluded.body, words = excluded.words,
        submitted_at = now(), status = 'sent';
end $$;

create or replace function public.board_load(p_code text, p_lesson text)
returns json language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(json_build_object('id', b.id, 'item', b.item) order by b.id), '[]'::json)
  from board_items b where b.student_id = student_id_by_code(p_code) and b.lesson_id = p_lesson;
$$;

create or replace function public.board_add(p_code text, p_lesson text, p_item jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code); nid bigint;
begin
  if sid is null then raise exception 'unknown code'; end if;
  if length(p_item::text) > 60000 then raise exception 'too big'; end if;
  insert into board_items(student_id, lesson_id, item, author) values (sid, left(p_lesson, 60), p_item, 'student') returning id into nid;
  return nid;
end $$;

create or replace function public.board_remove(p_code text, p_lesson text, p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  delete from board_items where student_id = student_id_by_code(p_code) and lesson_id = p_lesson and id = any(p_ids);
$$;

revoke all on function public.student_login(text) from public;
revoke all on function public.student_state(text) from public;
revoke all on function public.student_submit_result(text, text, int, int, jsonb, text) from public;
revoke all on function public.student_submit_homework(text, text, text) from public;
revoke all on function public.student_submit_writing(text, text, text, text, text, int) from public;
revoke all on function public.board_load(text, text) from public;
revoke all on function public.board_add(text, text, jsonb) from public;
revoke all on function public.board_remove(text, text, bigint[]) from public;
grant execute on function public.student_login(text) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
grant execute on function public.student_submit_result(text, text, int, int, jsonb, text) to anon, authenticated;
grant execute on function public.student_submit_homework(text, text, text) to anon, authenticated;
grant execute on function public.student_submit_writing(text, text, text, text, text, int) to anon, authenticated;
grant execute on function public.board_load(text, text) to anon, authenticated;
grant execute on function public.board_add(text, text, jsonb) to anon, authenticated;
grant execute on function public.board_remove(text, text, bigint[]) to anon, authenticated;
