# Стенд проверок repetitor (v57) — `_test/`

Офлайн-проверки актуальной версии сайта «репетитор» (ветка `fix/board-live`) в реальном
Chrome, без npm и без сети. Три набора идут последовательно:

| набор | файл | что проверяет | браузер |
|-------|------|---------------|---------|
| Мок Supabase | `mock-selftest.mjs` | auth/rpc/from/channel/presence, доска, **quiz_get / quiz_submit / student_quizzes**, `functions.invoke("ai", generate_tasks)` | нет |
| Доска | `board.mjs` + `board.html` | 15 сценариев доски: якоря, вложения, текст, живой фон, якоря в пустоте | да |
| E2E | `e2e.mjs` | учитель + ученик в двух вкладках на `teacher.html`/`index.html`: a, b1–b3, **Q1–Q4** | да |

## Запуск

```bash
cd repetitor-live
node _test/run.mjs              # всё: mock-selftest + доска + e2e
node _test/mock-selftest.mjs    # только мок (быстро, Chrome не нужен)
node _test/board.mjs            # только доска (15/15)
node _test/e2e.mjs              # только e2e (a,b1–b3,Q1–Q4)
```

Полезные переменные окружения:

| Переменная      | По умолчанию | Что делает                                    |
|-----------------|--------------|-----------------------------------------------|
| `BOARD_ONLY`    | (все)        | фильтр сценариев доски: `C`, `F`, `D2,E1`, `G`|
| `E2E_ONLY`      | (все)        | фильтр e2e: `a,b1`, `Q`, `Q3`                 |
| `BOARD_HEADLESS`| `1`          | `0` — показать окно браузера (доска)          |
| `E2E_HEADLESS`  | `1`          | `0` — показать окно браузера (e2e)            |
| `PORT`          | `8765`/`8766`| статика доски / e2e                           |
| `CDP_PORT`      | `9333`/`9334`| remote debugging Chrome доски / e2e           |
| `CHROME`        | авто         | путь к chrome.exe/msedge.exe                  |

Код выхода: `0` — всё прошло, `1` — есть падения, `2` — стенд не поднялся.
Скриншоты падений — `_test/artifacts/` (создаётся только при падении).

**Ограничение:** в части сессий субагента Chrome не стартует (mojo/named pipes). В этом
окружении прогоны из subagent-сессии проходят: **mock-selftest 40/40, доска 15/15, e2e 8/8**,
три полных прогона `run.mjs` подряд (2026-11-04, v57 + тесты по темам). Если Chrome не
поднимается — `node --check _test/*.mjs` и запуск обычной командой из консоли.

## E2E-сценарии (`e2e.mjs`)

Мир: учитель `t-1001`, ученик Аня — две строки одного человека (`rowA` рус-5, `rowB` math-5,
общий `person_id`), курс с уроками. Мок Supabase внедряется через
`Page.addScriptToEvaluateOnNewDocument` ДО скриптов страницы; CDN (supabase-js, шрифты)
блокируется сетью. Файлы курсов читаются локально через `vm` (без сети).

| id | Сценарий |
|----|----------|
| a  | ученик на предмете B, учитель начинает урок A → ученик сам переключается на предмет A (`student_switch`), видит материал на доске в комнате без перезагрузки (< 6 c); у учителя «онлайн» (по person/ids), каналы доски у сторон совпадают |
| b1 | смена урока в комнате (`#room-lesson`) → у ученика новый урок и материал < 2.5 c, без перезагрузки |
| b2 | урок из другого предмета: учитель открывает урок B, когда ученик в комнате на A → переключение предмета + материал < 6 c, без перезагрузки, «онлайн» |
| b3 | refresh из канала → тост «Материалы обновились», доска не сбрасывается, без перезагрузки |
| **Q1** | **учитель собрал тест**: карточка ученика → `#qz-card`, отметить 2 темы (`[data-qz-topic]`), `[data-act="qz-build"]` → предпросмотр (`#qz-title`, группы `.qz-topic`, «вопросов: N»), `[data-act="qz-save"]` → ссылка `?quiz=КОД` (`#qz-link`, `[data-qz-link]`); в mock-БД строка `quizzes` (student_id rowA, ≥2 вопросов, ≥2 тем, у каждого `topic`/`topicId`); «Открыть у ученика» → live `cmd` `{type:"quiz", to, token, title}` |
| **Q2** | **ручное «пройдено»**: `[data-act="covered-toggle"][data-lid][data-on="1"]` → в mock-БД `students.covered[lid]` **и** `covered_manual[lid]`; в карточке чип «✓»; колонка «Выполнено» не изменилась; повторное нажатие (`data-on=0`) снимает обе метки |
| **Q3** | **ученик проходит тест по прямой ссылке** `index.html?quiz=КОД` (сессия rowA, новая вкладка): тест открывается сам (`S.view="quiz"`), даже если у учителя идёт урок (presence не выдёргивает в комнату); неверный ответ → `.quiz-fb.no` с объяснением + `[data-qretry]`; повторно неверно → `[data-qnext]`, тема в `needsWork`; остальные верно → `.quiz-result[data-qresult]`, `.quiz-score` (score/total/%), «Надо доработать» с `.chip.bad`, `#qz-map .qz-topic.bad`; mock-БД `quiz_results` (score/total, `details.topics[].needsWork`, `needs_work[]`, `details.questions[0].attempts=2`), rpc `quiz_submit` с параметрами ровно `p_code,p_token,p_score,p_total,p_details,p_needs_work` |
| **Q4** | **карта тем**: у учителя в карточке rowA `#qz-map .qz-topic.bad` с названием заваленной темы и блок `.qz-need` «Надо доработать» (после живого обновления; при необходимости — кнопка «Обновить»); у ученика раздел «Тесты» (`[data-go="quizzes"]`) → `.quiz-list`, `[data-quiz]`, `#qz-map .qz-topic.bad` по `student_quizzes` |

Важные детали e2e:
- все вкладки одного origin делят `localStorage`, поэтому mock-БД пишется только в пустое
  хранилище (`seedScript`), а перед Q3 старая вкладка ученика (rowB) закрывается, чтобы её
  сессия не перетирала сессию rowA у новой вкладки;
- мок-лог (`__MOCK.cmdList()`, `__MOCK.lastRpc()`) локальный на вкладку: команды `cmd`
  проверяются на вкладке учителя, `quiz_submit` — на вкладке ученика;
- у ученика есть `window.__app = {S, render}` — тесты проверяют состояние (`S.view`,
  `S.room`, `S.profile`) вместо хрупких DOM-признаков.

## Мок Supabase (`mock-supabase.js`)

Фейковый `window.supabase.createClient` (внедряется до скриптов страницы): auth
(`getSession/signIn…/onAuthStateChange/updateUser/signOut`), `rpc`, `from()` с цепочками
`select/insert/update/delete/upsert/eq/neq/in/order/limit/single`, `functions.invoke`,
`storage.from().upload/getPublicUrl/remove`, `channel(name,{config})` с `broadcast/presence/
track/presenceState/subscribe/removeChannel`. Общее состояние вкладок — `localStorage` +
`BroadcastChannel`; данные задаются через `window.__MOCK_CFG` (`session`, `db`, `reset`).

Расширения под тесты по темам:
- таблицы `quizzes`/`quiz_results` — обычные таблицы общей БД; при `insert` учителя
  проставляется `teacher_id = auth.uid()` (как default в `supabase/schema.sql`);
- RPC по контракту `schema.sql`: `quiz_get({p_token})` → `{id,title,data,created_at}` или
  `null`; `quiz_submit({p_code,p_token,p_score,p_total,p_details,p_needs_work})` → void,
  валидирует код/баллы/принадлежность теста/размер details; `student_quizzes({p_code})` →
  `{quizzes:[{id,title,created_at,topics,questions,last}], results:[{quiz_id,title,score,total,details,needs_work,created_at}]}`;
- `functions.invoke("ai", {body:{action:"generate_tasks",topic,count,grade}})` → детерминированные
  2–3 вопроса `{q,o:[4],a,e,tag}` в `data.test` (+ `title`/`mini`), как ждёт `teacher.ai()`;
- хелперы `window.__MOCK`: `dbTable(name)`, `tables()`, `tokens()`, `reset(seed)`,
  `broadcastLog()`, `cmdList()`, `lastRpc(name)`, `rpcNames()`, `involveLog()`, `channels()`,
  `presenceOf(name)`.

## Доска (`board.mjs`, `board.html`)

Страница `board.html` монтирует **две доски** (1100 px и 380 px) с общим in-memory api и
fake-каналом; `window.__boards = {teacher, student}`, `window.__board` — хелперы стенда
(логические координаты, ink по canvas, кнопки/инструменты, редактор, якоря, листы, вложения,
live-фон: `mountLiveBoth`/`bgHtml`/`bgSource`/`waitBgSource`, журнал канала).

| id    | Сценарий |
|-------|----------|
| A0    | обе доски монтируются, листы рендерятся, fake-presence видит обе стороны |
| SMOKE | инструменты (pen/hl/text/erase/hand/touch/move ✥), кнопки attach/embed, снимок 📸, `info().ready/width/anchors`, `Board.keep()` переиспользует инстанс; затем bg-режим: кнопки/📸/`_pages` не сломаны, `bgSource` в `remote\|own\|static` |
| B1    | штрих учителя появляется у ученика через broadcast |
| C     | якорь: штрих остаётся на тексте при сдвинутом макете второй стороны (+remount) |
| D1    | две картинки через «На этот лист» не накладываются, видны второй стороне, живы после remount |
| D2    | ✥ двигает картинку: позиция сохраняется, вторая сторона видит, жива после remount |
| D3    | PDF «Отдельными листами»: доп. листы в `"_pages"`, видны обеим сторонам, живы после remount |
| D4    | большой лист (>55k html): обрезан ≤55000, одинаков у сторон, сохранён, жив после remount |
| E1    | текст: T → тап → `.bd-editor` в фокусе, ввод, ручка размера, Enter → надпись, видна учителю |
| E2    | надпись переживает remount |
| F1    | единый фон живого листа: свой `TEACHER-KEYS` у учителя → ученик отрисовал `STUDENT-SHEET` → фон учителя = HTML ученика, `bgSource="remote"` |
| F2    | ученик рисует в пустом месте общего листа → у учителя те же координаты/якорь/элемент |
| F3    | учитель рисует на общем фоне → у ученика те же координаты/элемент |
| F4    | `bgreq`: ученик не открывал лист, но отдаёт его из detached-рендера; без ученика учитель остаётся на своём фоне без исключений |
| G     | якоря в пустоте: штрих между абзацами остаётся у ближайшего абзаца при вставке абзаца + refresh |

**Живой фон листа.** Ученик после отрисовки live-листа шлёт `send("bg",{page,html})`;
учитель предпочитает этот html своему (`bgSource="remote"`), а если его нет — шлёт `bgreq`;
ученик отвечает даже для не открытого листа (detached-рендер). Хуки: `info().bgSource ∈
remote|own|static`, `debug().remoteBgPages`, канал — `__board.channelLog("bg"|"bgreq")`.
Контракт доски (`mount().info/debug/whenIdle/attach/addPage/openPage/refresh/destroy`),
DOM-селекторы стенда и устройство `board-harness.js` описаны в истории задачи/комментариях
файлов.

## Файлы

- `run.mjs` — полный прогон трёх наборов, итог PASS/FAIL, exit code;
- `mock-supabase.js` — фейковый Supabase (auth/rpc/from/channel/storage/functions + quiz);
- `mock-selftest.mjs` — самопроверка мока без браузера (40 проверок);
- `e2e.mjs` — мир учителя/ученика, сценарии a,b1–b3,Q1–Q4;
- `board.html` + `board-harness.js` + `board.mjs` — стенд доски и 15 сценариев;
- `cdp.mjs` — мини-драйвер CDP (Chrome, мышь/клавиатура, `Runtime.evaluate`, скриншоты);
- `serve.mjs` — статический сервер корня worktree (без кэша);
- `artifacts/` — скриншоты падений (создаётся при падении).
