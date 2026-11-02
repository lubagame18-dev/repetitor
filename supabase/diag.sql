-- Диагностика без личных данных: есть ли официальный кабинет (по хешу почты)
select json_build_object(
  'users_with_hash', (select count(*) from auth.users u where encode(extensions.digest(lower(u.email), 'sha256'), 'hex') = 'a1130f92712dae28b23f72b1ca0baeaa75b0a83d5ce8016c88df81d47730ed63'),
  'teacher_with_hash', (select left(t.id::text, 8) from auth.users u join teachers t on t.id = u.id where encode(extensions.digest(lower(u.email), 'sha256'), 'hex') = 'a1130f92712dae28b23f72b1ca0baeaa75b0a83d5ce8016c88df81d47730ed63'),
  'users_total', (select count(*) from auth.users),
  'mailru_users', (select count(*) from auth.users where email ilike '%@mail.ru')
) as diag;
