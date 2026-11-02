-- Диагностика без личных данных: только количества и настройки доступа
select json_build_object(
  'teachers', (select json_agg(json_build_object('t', left(t.id::text, 8), 'role', t.role, 'students', (select count(*) from students s where s.teacher_id = t.id),
     'registered', (select count(*) from students s where s.teacher_id = t.id and s.registered_at is not null),
     'courses', (select json_agg(distinct coalesce(s.course, '-') || ' / ' || coalesce(s.subject, '-')) from students s where s.teacher_id = t.id))) from teachers t),
  'students_without_teacher', (select count(*) from students s where not exists (select 1 from teachers t where t.id = s.teacher_id)),
  'policies', (select json_agg(json_build_object('table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles::text, 'permissive', permissive, 'using', left(qual, 200))) from pg_policies where schemaname = 'public' and tablename in ('students', 'teachers')),
  'rls', (select json_agg(json_build_object('table', relname, 'rls', relrowsecurity)) from pg_class where relname in ('students', 'teachers', 'results') and relnamespace = 'public'::regnamespace),
  'me_fn', (select count(*) from pg_proc where proname = 'me'),
  'plan_fn', (select count(*) from pg_proc where proname = 'plan_active')
) as diag;
