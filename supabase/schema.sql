-- Платформа «Учу по ФРП · репетиторство»: ученики, тесты, домашние задания.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.

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

-- Попытки тестов.
create table if not exists public.results (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  score       int  not null check (score >= 0),
  total       int  not null check (total > 0 and total <= 100),
  wrong       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
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

-- ---------- Права: учитель работает только со своими данными ----------
alter table public.students enable row level security;
alter table public.results  enable row level security;
alter table public.homework enable row level security;
alter table public.sheets   enable row level security;

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

drop policy if exists "teacher_sheets" on public.sheets;
create policy "teacher_sheets" on public.sheets for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- ---------- Ученик входит по коду: только эти функции, без доступа к таблицам ----------
create or replace function public.student_login(p_code text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('id', id, 'name', name, 'course', course)
  from students where code = upper(trim(p_code));
$$;

create or replace function public.student_state(p_code text)
returns json language sql security definer set search_path = public stable as $$
  with s as (select * from students where code = upper(trim(p_code)))
  select json_build_object(
    'results',  coalesce((select json_agg(json_build_object('lesson_id', r.lesson_id, 'score', r.score, 'total', r.total, 'wrong', r.wrong, 'created_at', r.created_at) order by r.created_at)
                          from results r join s on r.student_id = s.id), '[]'::json),
    'homework', coalesce((select json_agg(json_build_object('lesson_id', h.lesson_id, 'note', h.note, 'status', h.status, 'grade', h.grade, 'comment', h.comment, 'sent_at', h.sent_at))
                          from homework h join s on h.student_id = s.id), '[]'::json),
    'sheets',   coalesce((select json_agg(json_build_object('lesson_id', x.lesson_id, 'name', x.name, 'url', x.url, 'note', x.note))
                          from sheets x join s on x.teacher_id = s.teacher_id and x.course = s.course), '[]'::json)
  ) from s;
$$;

create or replace function public.student_submit_result(p_code text, p_lesson text, p_score int, p_total int, p_wrong jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from students where code = upper(trim(p_code));
  if sid is null then raise exception 'unknown code'; end if;
  if p_score < 0 or p_total <= 0 or p_score > p_total or p_total > 100 then raise exception 'bad score'; end if;
  insert into results(student_id, lesson_id, score, total, wrong)
  values (sid, left(p_lesson, 40), p_score, p_total, coalesce(p_wrong, '[]'::jsonb));
end $$;

create or replace function public.student_submit_homework(p_code text, p_lesson text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from students where code = upper(trim(p_code));
  if sid is null then raise exception 'unknown code'; end if;
  insert into homework(student_id, lesson_id, note, sent_at, status)
  values (sid, left(p_lesson, 40), left(p_note, 2000), now(), 'sent')
  on conflict (student_id, lesson_id) do update
    set note = excluded.note, sent_at = now(),
        status = case when homework.status = 'accepted' then 'accepted' else 'sent' end;
end $$;

revoke all on function public.student_login(text) from public;
revoke all on function public.student_state(text) from public;
revoke all on function public.student_submit_result(text, text, int, int, jsonb) from public;
revoke all on function public.student_submit_homework(text, text, text) from public;
grant execute on function public.student_login(text) to anon, authenticated;
grant execute on function public.student_state(text) to anon, authenticated;
grant execute on function public.student_submit_result(text, text, int, int, jsonb) to anon, authenticated;
grant execute on function public.student_submit_homework(text, text, text) to anon, authenticated;
