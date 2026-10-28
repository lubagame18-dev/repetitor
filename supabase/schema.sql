-- Платформа «Учу по ФРП · репетиторство»: учителя, ученики, тесты, домашки, сочинения, общая доска,
-- своя база материалов, работа в паре, кабинет разработчика и ключи нейросети.
-- Выполнить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Файл можно запускать повторно (например, после обновления) – данные не удаляются.

create extension if not exists pgcrypto;

-- ---------- Учителя и разработчики ----------
-- Строка создаётся сама при первом входе учителя (функция me()).
-- role: 'teacher' | 'developer'. base_access – какие встроенные базы открыты: 'oge-rus', 'ege-rus', 'school-rus'.
create table if not exists public.teachers (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'teacher' check (role in ('teacher','developer')),
  base_access text[] not null default '{}',
  theme       text,
  created_at  timestamptz not null default now()
);

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
alter table public.students add column if not exists grade         int;
alter table public.students add column if not exists goal          text;
alter table public.students add column if not exists goals         text[] not null default '{}';
alter table public.students add column if not exists contact       text;
alter table public.students add column if not exists password_hash text;
alter table public.students add column if not exists access_token  text unique;
alter table public.students add column if not exists invite_token  text unique;
alter table public.students add column if not exists registered_at timestamptz;
alter table public.students add column if not exists start_date    date;
alter table public.students add column if not exists dates         jsonb not null default '{}'::jsonb;  -- {"l05":"2026-12-10"} – перенос отдельных уроков
alter table public.students add column if not exists unlocked      jsonb not null default '[]'::jsonb;
alter table public.students add column if not exists subject       text not null default 'rus';
alter table public.students add column if not exists pair_id       uuid references public.students(id) on delete set null;  -- напарник
alter table public.students add column if not exists theme         text;
alter table public.students add column if not exists mascot        text;
alter table public.students add column if not exists person_id     uuid;   -- один ученик в нескольких предметах: у всех его строк общий person_id
alter table public.students add column if not exists call_url      text;   -- ссылка на созвон (Телемост и т. п.) для этого ученика
alter table public.teachers add column if not exists call_url      text;   -- ссылка на созвон по умолчанию
-- подписка: basic – 100 ₽ (свои материалы), materials – 300 ₽ (+ наша база, анализ и план), full – 500 ₽ (+ вся нейросеть)
alter table public.teachers add column if not exists plan          text not null default 'basic';
alter table public.teachers add column if not exists paid_until    timestamptz;
alter table public.teachers add column if not exists trial         boolean not null default false;
alter table public.teachers add column if not exists join_code     text unique;   -- код, по которому ученики регистрируются сами

-- платежи (ЮKassa)
create table if not exists public.payments (
  id          text primary key,                 -- номер платежа в ЮKassa
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  plan        text not null,
  amount      numeric not null,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

-- встроенная база материалов: хранится в базе, а не на GitHub, и видна только по подписке
create table if not exists public.course_data (
  key        text primary key,                  -- oge-rus, ege-rus, rus-5 …
  data       jsonb not null,                    -- курс без ключей
  keys       jsonb,                             -- ответы к практике – только учителям
  updated_at timestamptz not null default now()
);   -- персонаж-помощник: kotik | duck | lamb | hedgehog | own

-- Попытки тестов: kind = 'lesson' | 'hw' | 'entry' | 'mini'. duration_sec – сколько длилась попытка.
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
alter table public.results add column if not exists duration_sec int;
create index if not exists results_student_idx on public.results(student_id);

-- Время в папке урока (по дням): так учитель видит, сколько ученик реально занимался.
create table if not exists public.activity (
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  day         date not null default current_date,
  seconds     int  not null default 0,
  primary key (student_id, lesson_id, day)
);

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

-- Сочинения и изложения: текст или фото работы + оценка учителя по критериям (+ черновик оценки от нейросети).
create table if not exists public.writings (
  student_id   uuid not null references public.students(id) on delete cascade,
  lesson_id    text not null,
  kind         text not null,
  text_id      text,
  body         text,
  words        int,
  submitted_at timestamptz,
  status       text not null default 'sent' check (status in ('sent','reviewed','redo')),
  scores       jsonb not null default '{}'::jsonb,
  errors       jsonb not null default '{}'::jsonb,
  total        int,
  max          int,
  comment      text,
  reviewed_at  timestamptz,
  primary key (student_id, lesson_id)
);
alter table public.writings add column if not exists photos jsonb not null default '[]'::jsonb;   -- ссылки на фото рукописной работы
alter table public.writings add column if not exists ai     jsonb;                               -- проверка нейросетью (черновик для учителя)

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

-- Своя база учителя: материалы в любую папку и свои уроки.
-- kind: 'link' | 'file' (url из хранилища) | 'text' | 'tasks' (data: {mini:[{q,a}], test:[{q,o,a,e}]}) | 'lesson' (data: урок целиком)
-- student_id пусто – материал для всех учеников этого курса; заполнено – только для одного ученика.
create table if not exists public.materials (
  id          bigint generated always as identity primary key,
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course      text not null,
  lesson_id   text not null,
  student_id  uuid references public.students(id) on delete cascade,
  kind        text not null check (kind in ('link','file','text','tasks','lesson')),
  title       text,
  body        text,
  url         text,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists materials_idx on public.materials(teacher_id, course);
alter table public.materials add column if not exists shared boolean not null default false;  -- общая база разработчика: видна всем учителям и их ученикам курса

-- Общая доска: штрихи и надписи. lesson_id = 'l01:practice' и т. п. У пары – общая доска (student_id младшего по id).
create table if not exists public.board_items (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   text not null,
  item        jsonb not null,
  author      text not null default 'student',
  created_at  timestamptz not null default now()
);
create index if not exists board_items_idx on public.board_items(student_id, lesson_id);

-- Разборы нейросети: анализ ученика, рекомендации к плану.
create table if not exists public.ai_reports (
  id          bigint generated always as identity primary key,
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  kind        text not null,
  body        jsonb not null,
  created_at  timestamptz not null default now()
);

-- Настройки сайта (видны всем): оформление по умолчанию, название. Меняет только разработчик.
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);

-- Секреты (ключи нейросети). Ни одна роль сайта их не читает – только серверная функция ai.
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ---------- Права ----------
alter table public.teachers     enable row level security;
alter table public.students     enable row level security;
alter table public.results      enable row level security;
alter table public.activity     enable row level security;
alter table public.homework     enable row level security;
alter table public.writings     enable row level security;
alter table public.sheets       enable row level security;
alter table public.materials    enable row level security;
alter table public.board_items  enable row level security;
alter table public.ai_reports   enable row level security;
alter table public.app_settings enable row level security;
alter table public.app_secrets  enable row level security;
alter table public.payments     enable row level security;
alter table public.course_data  enable row level security;

create or replace function public.is_dev()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from teachers where id = auth.uid() and role = 'developer');
$$;

-- действующий тариф: разработчик – full; иначе тариф, если оплачен (или идёт пробный период); null – подписки нет
create or replace function public.plan_active(uid uuid)
returns text language sql security definer set search_path = public stable as $$
  select case when t.role = 'developer' then 'full' when t.paid_until > now() then t.plan else null end from teachers t where t.id = uid;
$$;
-- доступ к встроенной базе: тариф 300/500, разработчик или выдано вручную
create or replace function public.can_read_base(uid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce(plan_active(uid) in ('materials','full'), false) or exists (select 1 from teachers where id = uid and cardinality(base_access) > 0);
$$;

drop policy if exists "payments_own" on public.payments;
create policy "payments_own" on public.payments for select to authenticated using (teacher_id = auth.uid() or public.is_dev());
drop policy if exists "base_read" on public.course_data;
create policy "base_read" on public.course_data for select to authenticated using (public.can_read_base(auth.uid()));
drop policy if exists "base_dev" on public.course_data;
create policy "base_dev" on public.course_data for all to authenticated using (public.is_dev()) with check (public.is_dev());

drop policy if exists "teacher_self" on public.teachers;
create policy "teacher_self" on public.teachers for select to authenticated using (id = auth.uid() or public.is_dev());
drop policy if exists "dev_teachers" on public.teachers;
create policy "dev_teachers" on public.teachers for update to authenticated using (public.is_dev()) with check (public.is_dev());

drop policy if exists "teacher_students" on public.students;
create policy "teacher_students" on public.students for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
-- новых учеников можно добавлять, только пока действует подписка (любой тариф)
drop policy if exists "students_need_plan" on public.students;
create policy "students_need_plan" on public.students as restrictive for insert to authenticated with check (public.plan_active(auth.uid()) is not null);

do $$ declare t text; begin
  foreach t in array array['results','activity','homework','writings','board_items'] loop
    execute format('drop policy if exists "teacher_%1$s" on public.%1$s', t);
    execute format('create policy "teacher_%1$s" on public.%1$s for all to authenticated
      using (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))
      with check (exists (select 1 from public.students s where s.id = student_id and s.teacher_id = auth.uid()))', t);
  end loop;
  foreach t in array array['sheets','materials','ai_reports'] loop
    execute format('drop policy if exists "teacher_%1$s" on public.%1$s', t);
    execute format('create policy "teacher_%1$s" on public.%1$s for all to authenticated
      using (teacher_id = auth.uid()) with check (teacher_id = auth.uid())', t);
  end loop;
end $$;
-- старые имена политик из прошлой версии
drop policy if exists "teacher_board" on public.board_items;

drop policy if exists "shared_materials_read" on public.materials;
create policy "shared_materials_read" on public.materials for select to authenticated using (shared);
-- в общую базу пишет только разработчик
create or replace function public.materials_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shared and not is_dev() then raise exception 'only developer can publish to shared base'; end if;
  return new;
end $$;
drop trigger if exists materials_guard on public.materials;
create trigger materials_guard before insert or update on public.materials for each row execute function public.materials_guard();

drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select to anon, authenticated using (true);
drop policy if exists "settings_dev" on public.app_settings;
create policy "settings_dev" on public.app_settings for all to authenticated using (public.is_dev()) with check (public.is_dev());
-- app_secrets: политик нет вообще = закрыто для сайта.

-- ---------- Учитель ----------
-- профиль учителя (создаётся при первом входе)
create or replace function public.me()
returns json language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); r teachers; first boolean; days int;
begin
  if uid is null then return null; end if;
  first := not exists (select 1 from teachers);
  days := coalesce((select (value)::text::int from app_settings where key = 'trial_days'), 7);
  insert into teachers(id, email, name, role, plan, paid_until, trial)
  values (uid, (select email from auth.users where id = uid), (select raw_user_meta_data->>'name' from auth.users where id = uid),
          'teacher',
          'full', case when days > 0 then now() + make_interval(days => days) end, days > 0)
  on conflict (id) do nothing;
  if (select join_code from teachers where id = uid) is null then
    loop
      begin
        update teachers set join_code = upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 6)) where id = uid; exit;
      exception when unique_violation then null; end;
    end loop;
  end if;
  select * into r from teachers where id = uid;
  return json_build_object('join_code', r.join_code, 'id', r.id, 'email', r.email, 'name', r.name, 'role', r.role, 'base_access', r.base_access, 'theme', r.theme, 'call_url', r.call_url,
    'plan', r.plan, 'paid_until', r.paid_until, 'trial', r.trial, 'active', plan_active(r.id), 'base', can_read_base(r.id),
    'prices', (select value from app_settings where key = 'prices'));
end $$;

create or replace function public.teacher_set_theme(p_theme text)
returns void language sql security definer set search_path = public as $$
  update teachers set theme = left(p_theme, 20) where id = auth.uid();
$$;

-- выдать новую ссылку-приглашение (повторная регистрация или сброс пароля)
create or replace function public.teacher_new_invite(p_student uuid)
returns text language plpgsql security invoker set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(18), 'hex');
begin
  update students set invite_token = t, access_token = null where id = p_student and teacher_id = auth.uid();
  if not found then raise exception 'not your student'; end if;
  return t;
end $$;

-- объединить двух учеников в пару (или разъединить: p_b = null)
create or replace function public.teacher_set_pair(p_a uuid, p_b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from students where id = p_a and teacher_id = auth.uid()) then raise exception 'not your student'; end if;
  if p_b is not null and not exists (select 1 from students where id = p_b and teacher_id = auth.uid()) then raise exception 'not your student'; end if;
  update students set pair_id = null where teacher_id = auth.uid() and (pair_id = p_a or id = p_a or (p_b is not null and (pair_id = p_b or id = p_b)));
  if p_b is not null and p_b <> p_a then
    update students set pair_id = p_b where id = p_a;
    update students set pair_id = p_a where id = p_b;
  end if;
end $$;

-- ссылка на созвон по умолчанию (Телемост и т. п.)
create or replace function public.teacher_set_call(p_url text)
returns void language sql security definer set search_path = public as $$
  update teachers set call_url = nullif(left(trim(p_url), 500), '') where id = auth.uid();
$$;

-- добавить ученику ещё один предмет: та же учётная запись (логин и пароль), свои уроки, доска и результаты
create or replace function public.teacher_add_subject(p_student uuid, p_subject text, p_grade int, p_course text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare r students; nid uuid; c text;
begin
  select * into r from students where id = p_student and teacher_id = auth.uid();
  if r.id is null then raise exception 'not your student'; end if;
  if exists (select 1 from students where coalesce(person_id, id) = coalesce(r.person_id, r.id) and subject = p_subject) then raise exception 'subject exists'; end if;
  loop c := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 7)); exit when not exists (select 1 from students where code = c); end loop;
  update students set person_id = coalesce(person_id, id) where id = r.id;
  insert into students(teacher_id, name, course, code, grade, goal, goals, contact, password_hash, registered_at, start_date, subject, theme, mascot, person_id)
  values (r.teacher_id, r.name, coalesce(p_course, ''), c, p_grade, r.goal, r.goals, r.contact, r.password_hash, r.registered_at, current_date,
          left(p_subject, 20), r.theme, r.mascot, coalesce(r.person_id, r.id))
  returning id into nid;
  return nid;
end $$;

-- ---------- Разработчик ----------
-- Разработчиком становятся так: вход в кабинет своей почтой + код разработчика (как в «Учу по ФРП»).
-- Код хранится только в виде хэша. Задать или сменить код: в SQL Editor выполните
--   select public.dev_set_code('ваш-код');
create or replace function public.dev_set_code(p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_code, '')) < 6 then raise exception 'code too short'; end if;
  insert into app_secrets(key, value) values ('dev_code_hash', crypt(p_code, gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.dev_set_code(text) from public, anon, authenticated;

-- вход в режим разработчика: проверка кода на сервере; при успехе учётная запись получает роль разработчика
create or replace function public.dev_join(p_code text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if auth.uid() is null then return false; end if;
  select value into h from app_secrets where key = 'dev_code_hash';
  if h is null or crypt(coalesce(p_code, ''), h) <> h then perform pg_sleep(1); return false; end if;
  perform me();
  update teachers set role = 'developer' where id = auth.uid();
  return true;
end $$;

create or replace function public.dev_set_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'developer only'; end if;
  if coalesce(p_value, '') = '' then delete from app_secrets where key = p_key;
  else insert into app_secrets(key, value) values (left(p_key, 60), p_value)
       on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
end $$;

-- список ключей: у самих ключей видно только последние 4 символа, настройки (провайдер, модель) – целиком
create or replace function public.dev_list_secrets()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'developer only'; end if;
  return coalesce((select json_agg(json_build_object('key', key, 'tail', case when key like 'key\_%' or key like '%secret%' then right(value, 4) else value end, 'updated_at', updated_at) order by key) from app_secrets), '[]'::json);
end $$;

create or replace function public.dev_stats()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'developer only'; end if;
  return json_build_object('teachers', (select count(*) from teachers), 'students', (select count(*) from students where registered_at is not null),
    'results', (select count(*) from results), 'writings', (select count(*) from writings), 'ai', (select count(*) from ai_reports));
end $$;

-- ---------- Ученик: приглашение → анкета и пароль → вход. Доступ к данным – только через эти функции ----------
create or replace function public.student_id_by_code(p_code text)
returns uuid language sql security definer set search_path = public stable as $$
  select id from students where access_token = p_code and length(p_code) >= 32;
$$;
revoke all on function public.student_id_by_code(text) from public, anon, authenticated;

-- чья доска: у пары одна общая доска
create or replace function public.board_owner(sid uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select case when pair_id is not null and pair_id::text < id::text then pair_id else id end from students where id = sid;
$$;

create or replace function public.student_profile_json(sid uuid)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('id', s.id, 'name', s.name, 'grade', s.grade, 'goal', s.goal, 'goals', s.goals, 'course', s.course, 'login', s.code,
                           'start_date', s.start_date, 'dates', s.dates, 'unlocked', s.unlocked, 'theme', s.theme, 'mascot', s.mascot, 'teacher', s.teacher_id, 'subject', s.subject,
                           'call_url', coalesce(nullif(s.call_url, ''), (select t.call_url from teachers t where t.id = s.teacher_id)),
                           'subjects', (select json_agg(json_build_object('id', o.id, 'subject', o.subject, 'course', o.course, 'grade', o.grade) order by o.created_at)
                                          from students o where coalesce(o.person_id, o.id) = coalesce(s.person_id, s.id) and o.registered_at is not null),
                           'registered', s.registered_at is not null,
                           'pair', (select json_build_object('id', p.id, 'name', p.name) from students p where p.id = s.pair_id),
                           'board_owner', board_owner(s.id))
  from students s where s.id = sid;
$$;
revoke all on function public.student_profile_json(uuid) from public, anon, authenticated;

create or replace function public.invite_info(p_invite text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('name', case when registered_at is null and name like '(%' then '' else name end, 'grade', grade, 'subject', subject,
                           'theme', (select value from app_settings where key = 'default_theme'))
  from students where invite_token = p_invite and length(p_invite) >= 24;
$$;

-- регистрация по одноразовой ссылке. Курс (план) выбирается по классу и целям,
-- если у учителя открыта нужная база; иначе план составит учитель.
drop function if exists public.student_register(text, text, int, text, text, text);
create or replace function public.student_register(p_invite text, p_name text, p_grade int, p_goals text[], p_contact text, p_password text, p_course text default null, p_theme text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid; tok text; acc text[]; pack text; cur text;
begin
  select id, course into sid, cur from students where invite_token = p_invite and length(p_invite) >= 24;
  if sid is null then raise exception 'invite used or wrong'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'short password'; end if;
  if p_grade < 0 or p_grade > 11 then raise exception 'bad grade'; end if;
  select t.base_access into acc from teachers t join students s on s.teacher_id = t.id where s.id = sid;
  pack := case when p_course ~ '^rus-(5|6|7|8|9|10|11)$' then 'school-rus' when p_course in ('oge-rus','ege-rus') then p_course else null end;
  tok := encode(gen_random_bytes(24), 'hex');
  update students set name = left(trim(p_name), 120), grade = p_grade, goals = coalesce(p_goals, '{}'), goal = array_to_string(p_goals, ', '),
         contact = left(p_contact, 200), theme = left(p_theme, 20),
         password_hash = crypt(p_password, gen_salt('bf')), access_token = tok, invite_token = null,
         registered_at = coalesce(registered_at, now()),
         course = case when p_course is null then '' when pack is null or pack = any(coalesce(acc, '{}')) then left(p_course, 40) else '' end,
         start_date = coalesce(start_date, current_date)
   where id = sid;
  return json_build_object('token', tok, 'profile', student_profile_json(sid));
end $$;

-- ученик регистрируется сам по коду учителя (без ссылки-приглашения)
create or replace function public.teacher_by_code(p_code text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('name', coalesce(name, 'Учитель'), 'active', plan_active(id) is not null) from teachers where join_code = upper(trim(p_code));
$$;
create or replace function public.student_signup(p_teacher_code text, p_name text, p_subject text, p_grade int, p_goals text[], p_contact text, p_password text, p_course text default null, p_theme text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare t teachers; sid uuid; tok text; c text; pack text;
begin
  select * into t from teachers where join_code = upper(trim(p_teacher_code));
  if t.id is null then raise exception 'teacher code not found'; end if;
  if plan_active(t.id) is null then raise exception 'teacher subscription inactive'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'short password'; end if;
  if p_grade < 0 or p_grade > 11 then raise exception 'bad grade'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name required'; end if;
  loop c := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 7)); exit when not exists (select 1 from students where code = c); end loop;
  pack := case when p_course ~ '^rus-(5|6|7|8|9|10|11)$' then 'school-rus' when p_course in ('oge-rus','ege-rus') then p_course else null end;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into students(teacher_id, name, course, code, grade, goals, goal, contact, password_hash, access_token, registered_at, start_date, subject, theme)
  values (t.id, left(trim(p_name), 120), case when p_course is null then '' when pack is null or can_read_base(t.id) then left(p_course, 40) else '' end,
          c, p_grade, coalesce(p_goals, '{}'), array_to_string(p_goals, ', '), left(p_contact, 200), crypt(p_password, gen_salt('bf')), tok, now(), current_date,
          left(coalesce(p_subject, 'rus'), 20), left(p_theme, 20))
  returning id into sid;
  return json_build_object('token', tok, 'profile', student_profile_json(sid));
end $$;

create or replace function public.student_login(p_login text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r students; tok text;
begin
  select * into r from students where code = upper(trim(p_login));
  if r.id is null or r.password_hash is null or r.password_hash <> crypt(p_password, r.password_hash) then return null; end if;
  tok := coalesce(r.access_token, encode(gen_random_bytes(24), 'hex'));
  update students set access_token = tok where id = r.id;
  return json_build_object('token', tok, 'profile', student_profile_json(r.id));
end $$;

-- переключиться на другой предмет того же ученика
create or replace function public.student_switch(p_code text, p_target uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare me students; r students; tok text;
begin
  select * into me from students where id = student_id_by_code(p_code);
  if me.id is null then return null; end if;
  select * into r from students where id = p_target and coalesce(person_id, id) = coalesce(me.person_id, me.id) and registered_at is not null;
  if r.id is null then return null; end if;
  tok := coalesce(r.access_token, encode(gen_random_bytes(24), 'hex'));
  update students set access_token = tok where id = r.id;
  return json_build_object('token', tok, 'profile', student_profile_json(r.id));
end $$;

create or replace function public.student_state(p_code text)
returns json language sql security definer set search_path = public stable as $$
  with s as (select * from students where id = student_id_by_code(p_code))
  select json_build_object(
    'profile',  student_profile_json(s.id),
    'results',  coalesce((select json_agg(json_build_object('lesson_id', r.lesson_id, 'kind', r.kind, 'score', r.score, 'total', r.total, 'wrong', r.wrong, 'created_at', r.created_at, 'duration_sec', r.duration_sec) order by r.created_at)
                          from results r where r.student_id = s.id), '[]'::json),
    'homework', coalesce((select json_agg(json_build_object('lesson_id', h.lesson_id, 'note', h.note, 'status', h.status, 'grade', h.grade, 'comment', h.comment, 'sent_at', h.sent_at))
                          from homework h where h.student_id = s.id), '[]'::json),
    'writings', coalesce((select json_agg(json_build_object('lesson_id', w.lesson_id, 'kind', w.kind, 'text_id', w.text_id, 'body', w.body, 'words', w.words, 'photos', w.photos, 'status', w.status, 'scores', w.scores, 'errors', w.errors, 'total', w.total, 'max', w.max, 'comment', w.comment, 'submitted_at', w.submitted_at))
                          from writings w where w.student_id = s.id), '[]'::json),
    'sheets',   coalesce((select json_agg(json_build_object('lesson_id', x.lesson_id, 'name', x.name, 'url', x.url, 'note', x.note))
                          from sheets x where x.teacher_id = s.teacher_id and x.course = s.course), '[]'::json),
    'course_data', (select c.data from course_data c where c.key = s.course and can_read_base(s.teacher_id)),
    'materials', coalesce((select json_agg(json_build_object('id', m.id, 'course', m.course, 'lesson_id', m.lesson_id, 'student_id', m.student_id, 'shared', m.shared, 'kind', m.kind, 'title', m.title, 'body', m.body, 'url', m.url, 'data', m.data) order by m.id)
                          from materials m where m.course = s.course and ((m.teacher_id = s.teacher_id and (m.student_id is null or m.student_id = s.id)) or (m.shared and m.student_id is null))), '[]'::json)
  ) from s;
$$;

drop function if exists public.student_submit_result(text, text, int, int, jsonb, text);
create or replace function public.student_submit_result(p_code text, p_lesson text, p_score int, p_total int, p_wrong jsonb, p_kind text default 'lesson', p_duration int default null)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  if p_score < 0 or p_total <= 0 or p_score > p_total or p_total > 100 then raise exception 'bad score'; end if;
  insert into results(student_id, lesson_id, kind, score, total, wrong, duration_sec)
  values (sid, left(p_lesson, 40), case when p_kind in ('hw','entry','mini') then p_kind else 'lesson' end, p_score, p_total, coalesce(p_wrong, '[]'::jsonb),
          case when p_duration between 0 and 86400 then p_duration end);
end $$;

-- «я на уроке»: раз в минуту, пока папка открыта
create or replace function public.student_ping(p_code text, p_lesson text, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  insert into activity(student_id, lesson_id, seconds) values (sid, left(p_lesson, 40), least(greatest(p_seconds, 0), 120))
  on conflict (student_id, lesson_id, day) do update set seconds = activity.seconds + excluded.seconds;
end $$;

create or replace function public.student_set_theme(p_code text, p_theme text)
returns void language sql security definer set search_path = public as $$
  update students set theme = left(p_theme, 20) where id = student_id_by_code(p_code);
$$;

create or replace function public.student_set_mascot(p_code text, p_mascot text)
returns void language sql security definer set search_path = public as $$
  update students set mascot = left(p_mascot, 20) where id = student_id_by_code(p_code);
$$;

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

drop function if exists public.student_submit_writing(text, text, text, text, text, int);
create or replace function public.student_submit_writing(p_code text, p_lesson text, p_kind text, p_text text, p_body text, p_words int, p_photos jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code);
begin
  if sid is null then raise exception 'unknown code'; end if;
  insert into writings(student_id, lesson_id, kind, text_id, body, words, photos, submitted_at, status)
  values (sid, left(p_lesson, 40), left(p_kind, 10), left(p_text, 10), left(p_body, 20000), p_words, coalesce(p_photos, '[]'::jsonb), now(), 'sent')
  on conflict (student_id, lesson_id) do update
    set kind = excluded.kind, text_id = excluded.text_id, body = excluded.body, words = excluded.words, photos = excluded.photos,
        submitted_at = now(), status = 'sent', ai = null;
end $$;

create or replace function public.board_load(p_code text, p_lesson text)
returns json language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(json_build_object('id', b.id, 'item', b.item) order by b.id), '[]'::json)
  from board_items b where b.student_id = board_owner(student_id_by_code(p_code)) and b.lesson_id = p_lesson;
$$;

create or replace function public.board_add(p_code text, p_lesson text, p_item jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare sid uuid := student_id_by_code(p_code); nid bigint;
begin
  if sid is null then raise exception 'unknown code'; end if;
  if length(p_item::text) > 60000 then raise exception 'too big'; end if;
  insert into board_items(student_id, lesson_id, item, author) values (board_owner(sid), left(p_lesson, 60), p_item, 'student') returning id into nid;
  return nid;
end $$;

create or replace function public.board_remove(p_code text, p_lesson text, p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  delete from board_items where student_id = board_owner(student_id_by_code(p_code)) and lesson_id = p_lesson and id = any(p_ids);
$$;

-- ---------- Хранилище файлов ----------
-- materials – файлы учителя (рабочие листы, картинки); works – фото рукописных работ учеников (загружает функция ai).
insert into storage.buckets (id, name, public) values ('materials', 'materials', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('works', 'works', true) on conflict (id) do nothing;
drop policy if exists "teacher_upload_materials" on storage.objects;
create policy "teacher_upload_materials" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "teacher_delete_materials" on storage.objects;
create policy "teacher_delete_materials" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Доступ к функциям ----------
drop function if exists public.student_login(text);
do $$ declare f text; begin
  foreach f in array array[
    'public.invite_info(text)', 'public.student_register(text, text, int, text[], text, text, text, text)', 'public.student_login(text, text)',
    'public.student_state(text)', 'public.student_submit_result(text, text, int, int, jsonb, text, int)', 'public.student_ping(text, text, int)',
    'public.student_set_theme(text, text)', 'public.teacher_by_code(text)', 'public.student_signup(text, text, text, int, text[], text, text, text, text)', 'public.student_switch(text, uuid)', 'public.student_set_mascot(text, text)', 'public.student_submit_homework(text, text, text)',
    'public.student_submit_writing(text, text, text, text, text, int, jsonb)',
    'public.board_load(text, text)', 'public.board_add(text, text, jsonb)', 'public.board_remove(text, text, bigint[])'] loop
    execute 'revoke all on function ' || f || ' from public';
    execute 'grant execute on function ' || f || ' to anon, authenticated';
  end loop;
  foreach f in array array['public.plan_active(uuid)', 'public.can_read_base(uuid)', 'public.teacher_new_invite(uuid)', 'public.teacher_add_subject(uuid, text, int, text)', 'public.teacher_set_call(text)', 'public.teacher_set_pair(uuid, uuid)', 'public.me()', 'public.teacher_set_theme(text)',
    'public.dev_join(text)', 'public.dev_set_secret(text, text)', 'public.dev_list_secrets()', 'public.dev_stats()', 'public.is_dev()'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  execute 'revoke all on function public.board_owner(uuid) from public, anon, authenticated';
  begin execute 'grant execute on function public.plan_active(uuid) to service_role'; exception when undefined_object then null; end;
end $$;
