# Последнее обновление Supabase

Время: 2026-11-19 09:11 UTC · коммит cac1d12

## База (schema.sql)
```
{"message":"Failed to run sql query: ERROR:  42P01: missing FROM-clause entry for table \"s\"\nLINE 837:   where m.student_id in (select x.id from public.students x where coalesce(x.person_id, x.id) = coalesce(s.person_id, s.id));\n                                                                                                                   ^\n"}
ОШИБКА 400 (изменения отменены)
```

## Функция ai
```
Warning: --project-ref is deprecated and will be removed in v4. Use --remote=<ref> instead
Target: project affncgnhqfvdbtyujfvz
Confirmed by --yes: Deploy 1 Function on project affncgnhqfvdbtyujfvz
Uploading asset (ai): supabase/functions/ai/index.ts
Deployed Functions on project affncgnhqfvdbtyujfvz: ai
You can inspect your deployment in the Dashboard: https://supabase.com/dashboard/project/affncgnhqfvdbtyujfvz/functions
ok
```
