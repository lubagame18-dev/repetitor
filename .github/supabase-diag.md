# Диагностика 2026-11-02 16:17 UTC
```json
[
  {
    "diag": {
      "teachers": [
        {
          "t": "a2663102",
          "role": "developer",
          "students": 0,
          "registered": 0,
          "courses": null
        },
        {
          "t": "8295d3c3",
          "role": "developer",
          "students": 3,
          "registered": 2,
          "courses": [
            " / rus",
            "oge-rus / rus"
          ]
        },
        {
          "t": "31d99ed3",
          "role": "developer",
          "students": 5,
          "registered": 3,
          "courses": [
            "oge-rus / rus",
            "rus-7 / rus",
            "rus-8 / rus",
            "vpr-rus-7 / rus",
            "vpr-rus-8 / rus"
          ]
        }
      ],
      "students_without_teacher": 0,
      "policies": [
        {
          "table": "students",
          "name": "students_need_plan",
          "cmd": "INSERT",
          "roles": "{authenticated}",
          "permissive": "RESTRICTIVE",
          "using": null
        },
        {
          "table": "students",
          "name": "teacher_students",
          "cmd": "ALL",
          "roles": "{authenticated}",
          "permissive": "PERMISSIVE",
          "using": "my_team(teacher_id)"
        },
        {
          "table": "teachers",
          "name": "dev_teachers",
          "cmd": "UPDATE",
          "roles": "{authenticated}",
          "permissive": "PERMISSIVE",
          "using": "is_dev()"
        },
        {
          "table": "teachers",
          "name": "teacher_self",
          "cmd": "SELECT",
          "roles": "{authenticated}",
          "permissive": "PERMISSIVE",
          "using": "((id = auth.uid()) OR is_dev())"
        }
      ],
      "rls": [
        {
          "table": "results",
          "rls": true
        },
        {
          "table": "students",
          "rls": true
        },
        {
          "table": "teachers",
          "rls": true
        }
      ],
      "me_fn": 1,
      "plan_fn": 1
    }
  }
]
```
