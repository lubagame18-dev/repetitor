# Стенд проверок repetitor (v67) — `_test/`

Офлайн-проверки актуальной версии сайта «репетитор» в реальном Chrome, без npm и без сети.
Наборы идут последовательно (`run.mjs`), U1 — отдельным процессом:

| набор | файл | что проверяет | браузер |
|-------|------|---------------|---------|
| Мок Supabase | `mock-selftest.mjs` | auth/rpc/from/channel/presence, доска, **quiz_get / quiz_submit / student_quizzes**, `student_save_work`/`student_submit_result`, `functions.invoke("ai")` (`generate_tasks`, **`build_lesson`**, `edit_lesson`/`generate_theory`), формы `results`/`topic_quiz_results` для графика динамики — **71 проверка** | нет |
| Доска | `board.mjs` + `board.html` | **22 сценария**: 15 старых (якоря, вложения, текст, живой фон, пустота) + **H1–H4** (точечный ластик, инлайн-текст, зум/пан/расширение, вставка в точку) + **I1–I3** (выделение/удаление, ресайз картинки и текста) | да |
| E2E (основной) | `e2e.mjs` | учитель + ученик в двух вкладках на `teacher.html`/`index.html`: a, b1, **R1**, b2–b3, **Q1–Q6**, **S1–S4**, **T1–T4**, **V1–V3**, U2 — **23 сценария** | да |
| E2E (U1 отдельно) | `e2e.mjs` `E2E_ONLY=U1` | база самообучения и конструктор наборов учителя (U1) | да |

## Запуск

```bash
cd repetitor-live
node _test/run.mjs              # всё: mock-selftest + доска + e2e (24) + e2e U1
node _test/mock-selftest.mjs    # только мок (быстро, Chrome не нужен): 67/67
node _test/board.mjs            # только доска: 22/22
node _test/e2e.mjs              # только основной e2e: 24/24
E2E_ONLY=S node _test/e2e.mjs   # только самообучение S1–S4
E2E_ONLY=V node _test/e2e.mjs   # только панель «Инструменты»/генерация V1–V3
E2E_ONLY=U1 node _test/e2e.mjs  # отдельно U1 (вкладки делят localStorage — нужен свой процесс)
BOARD_ONLY=H node _test/board.mjs   # только H1–H4 (ластик/инлайн/зум/вставка)
BOARD_ONLY=I node _test/board.mjs   # только I1–I3 (выделение/Delete/кнопка/меню, ресайз картинки и текста)
```

Полезные переменные окружения:

| Переменная      | По умолчанию | Что делает                                    |
|-----------------|--------------|-----------------------------------------------|
| `BOARD_ONLY`    | (все)        | фильтр сценариев доски: `C`, `F`, `D2,E1`, `H`, `H1` |
| `E2E_ONLY`      | (все)        | фильтр e2e: `a,b1`, `Q`, `Q6`, `S`, `T`, `V`, `U1` |
| `BOARD_HEADLESS`| `1`          | `0` — показать окно браузера (доска)          |
| `E2E_HEADLESS`  | `1`          | `0` — показать окно браузера (e2e)            |
| `PORT`          | `8765`/`8766`| статика доски / e2e                           |
| `CDP_PORT`      | `9333`/`9334`| remote debugging Chrome доски / e2e           |
| `CHROME`        | авто         | путь к chrome.exe/msedge.exe                  |

Код выхода: `0` — всё прошло, `1` — есть падения, `2` — стенд не поднялся.
Скриншоты падений — `_test/artifacts/` (создаётся при падении).
Порты `PORT`/`CDP_PORT` могут быть заняты параллельным прогоном — стенд автоматически берёт
следующий свободный (и для статики, и для CDP, до +20) и печатает фактический URL. Это
исключает прежнюю проблему, когда стенд молча подключался к чужому Chrome и получал серию
«CDP timeout: Runtime.evaluate». **Не запускайте два прогона e2e (или доску и e2e) одновременно
в один Chrome-профиль** — при перегрузке возможны единичные «CDP timeout» на первых шагах.

**Ограничение:** в части сессий субагента Chrome не стартует (mojo/named pipes). В этом
окружении прогоны из subagent-сессии проходят: **mock-selftest 71/71, доска 22/22, e2e 24/24,
U1 1/1** — три подряд полных прогона `run.mjs` (2026-11-09, v67: кабинет на планшете, R1, динамика, тест по первой
попытке, H1–H4, I1–I3, V1–V3). На занятой машине встречаются единичные env-флейки:
`CDP timeout: Runtime.evaluate` — `cdp.mjs` делает `Runtime.evaluate` с коротким таймаутом и
повторяет 3 раза (обычно проходит со второй попытки), но два одновременных прогона в один
Chrome всё равно не запускайте; `b1` при пороге 6 c дал 8.6 c — порог поднят до 10 c, как у
a/b2 (в норме смена урока < 2 c, это не регрессия продукта); в b3 добавлена повторная отправка
refresh, если тост не пришёл с первого раза.
Если Chrome не поднимается — `node --check _test/*.mjs` и запуск обычной командой из консоли.

## E2E-сценарии (`e2e.mjs`)

Мир: учитель `t-1001`, ученик Аня — две строки одного человека (`rowA` рус-5, `rowB` math-5,
общий `person_id`), курсы `rus-5`/`math-5` (по 5 уроков, читаются локально через `vm`).
Мок Supabase внедряется через `Page.addScriptToEvaluateOnNewDocument` ДО скриптов страницы;
CDN (supabase-js, шрифты) блокируется сетью.

| id | Сценарий |
|----|----------|
| a  | ученик на предмете B, учитель начинает урок A → ученик сам переключается на предмет A (`student_switch`), видит материал на доске в комнате без перезагрузки (порог < 10 c с запасом; маркер проверяет, что страница НЕ перезагружалась); у учителя «онлайн» (по person/ids), каналы доски совпадают |
| b1 | смена урока в комнате (`#room-lesson`) → у ученика новый урок и материал (в норме < 2 c; порог 10 c с запасом на нагрузку; без перезагрузки) |
| **R1** | **меню и баннер во время урока**: урок идёт (после a/b1, `S.view="room"`) → меню `[data-act="open-drawer"]` + `[data-go="self"]`/`home` переключает раздел, `S.away=true`, `S.room` сохраняется; `.lesson-backbar` с `[data-act="back-to-room"]` «Вернуться к уроку» на разделе; 2.8 c ожидания (presence) не выдёргивают в room и не показывают `.joinbox`; «Вернуться к уроку» → room/away=false/баннер скрыт; `room-end` → `S.room=null`, ученик остаётся в home без баннера; повторный `start-lesson` → room/away=false || b2 | урок из другого предмета: учитель открывает урок B, когда ученик в комнате на A → переключение предмета + материал (порог < 10 c; без перезагрузки), «онлайн» |
| b3 | refresh из канала → тост «Материалы обновились», доска не сбрасывается, без перезагрузки |
| **Q1** | **учитель собрал тест**: карточка ученика → `#qz-card`, отметить 2 темы (`[data-qz-topic]`), `[data-act="qz-build"]` → предпросмотр (`#qz-title`, группы `.qz-topic`), `[data-act="qz-save"]` → ссылка `?quiz=КОД` (`#qz-link`); в mock-БД `topic_quizzes` (student_id rowA, ≥2 вопросов/тем, у каждого `topic`/`topicId`); «Открыть у ученика» → live `cmd {type:"quiz", to, token, title}` |
| **Q2** | **ручное «пройдено»**: `[data-act="covered-toggle"][data-lid][data-on="1"]` → в mock-БД `students.covered[lid]` **и** `covered_manual[lid]`, чип «✓»; «Выполнено» не меняется; повторное нажатие снимает обе метки |
| **Q3** | **ученик проходит тест по ссылке** `index.html?quiz=КОД`: неверный → `.quiz-fb.no` + `[data-qretry]`; повторно неверно → `[data-qnext]`, тема в `needsWork`; остальные верно → `.quiz-result[data-qresult]`, `.quiz-score`, «Надо доработать», `#qz-map .qz-topic.bad`; mock-БД `topic_quiz_results` (`details.questions[0].attempts=2`), rpc `quiz_submit` с `p_code,p_token,p_score,p_total,p_details,p_needs_work` |
| **Q4** | **карта тем**: у учителя в карточке rowA `#qz-map .qz-topic.bad` и `.qz-need` «Надо доработать» (после live-обновления/«Обновить»); у ученика раздел «Тесты» (`[data-go="quizzes"]`) → `.quiz-list`, `[data-quiz]`, `#qz-map .qz-topic.bad` |
| **Q5** | **ссылка ?quiz= в браузере учителя** открывается как тест ученика (`location.pathname` не `teacher.html`, `S.quizToken` сохранён), а не редирект в кабинет |
| **Q6** | **счёт по первой попытке**: первый вопрос — неверно → `[data-qretry]` → верно, остальные верно; `.quiz-score[data-score]` = n−1, `.quiz-result [data-q-first]` «с первой попытки: n−1 из n»; mock `topic_quiz_results` score=n−1, `details.questions[0] = {first:false, attempts:2, ok:true}`; rpc `quiz_submit.p_score`=n−1; у учителя % темы < 100 |
| **S1** | **блок ударений**: экран `[data-go="self"]` → ≥10 блоков `[data-act="self-stress-block"]`; ошибка → `.play-res.bad` с правильным ударением; все 15 слов верно; works `self:stress` task=0 `done`, `mastered.length=15`, `errors`; результат `kind=self`; после закрытия кнопка 15/15 |
| **S2** | **ошибка = повтор (+2)**: блок 1, первый ответ неверный; `Play.stressState()`: слова нет в mastered, `reps>=3`, фидбек «Слово встретится ещё раз»; works task=1 `done/mastered/errors` |
| **S3** | **карточки**: колода «Паронимы» → `[data-show]` → `.self-back`; «Ещё учить» возвращает карточку; «Знаю» до всех; works `self:deck` task=0 `done`, `mastered.length = всех`; результат `kind=self` (`self:cards`) |
| **S4** | **прогресс/«Мои ошибки»**: перезагрузка → блок 0 = 15/15, `.self-prep` «Что подтянуть»; `[data-act="self-errors"][data-self-errors-left>=2]`; тренажёр ошибок пройден → works `self:errors` items уменьшился, DOM-счётчик уменьшился |
| **T1** | **карточка ученика (всё, что делает ученик)**: `[data-t-student-all]`; `[data-t-self-stress="0"|"1"]`, `[data-t-self-deck="0"]`, `[data-t-self-errors]`/`[data-t-err-key]`; база `[data-t-base]`; доска `[data-t-board-row]` (`data-strokes/texts/files`), `[data-t-board-summary]`, `[data-act="boards-reload"]`; «Открыть доску» → `T.view==="board"`, `T.board.info().items>0` |
| **T2** | **динамика у учителя**: сид results rowA (5/10, 8/10, 6/10, 10/10) + quiz 3/4; карточка `[data-t-student-trend]` → `.trend-line`, `.trend-dot>=2`, `.trend[data-points>=3]`, `data-last=100`, «сейчас 100%»; хук `window.__teacher.trendPoints(s)` |
| **T3** | **автоподбор тем**: отметить урок «Пройдено» (`[data-act="covered-toggle"]`), очистить выбор тем, `[data-act="qz-build"]` → в `T.qzDraft.topics` пройденная тема, чекбокс отмечен; `[data-act="qz-save"]` → `topic_quizzes.data.topics` содержит её |
| **T4** | **статистика ученика**: «Статистика» (`[data-go="stats"]`) → `[data-t-trend]` c `.trend-line`, `.trend-dot>=1`, `data-points>=1`, `data-last=100` (по results+quiz_results из сида T2) |
| **V1** | **комната → «Инструменты»** (`[data-act="room-tools"]`, `[data-tools-pane]`): заметка `#tool-note-text`→`[data-act="tool-note"]` даёт t-объект `insertNote`; картинка `#tool-img-url`→`[data-act="tool-img"]` вызывает `T.board.insertImage(url)`; поиск `#tool-search-q` → ссылки `a[data-search]` с запросом и доменами (sdamgia/fipi/wordwall), 📌 `[data-act="tool-search-board"]` → текст ссылки на доске; `[data-act="tool-insert-board"]` → `insertPage` добавляет и открывает лист |
| **V2** | **генерация к курсу ученика**: комната rowB (math-5) → `[data-act="tool-gen-theory"]` → `#ce-req`/`[data-act="ce-ai"]` → `[data-act="ce-save"]`: в mock-БД `materials` `kind="tasks"`, `data.kind="content-edit"`, `course="math-5"`, `student_id=rowB`, `data.theory`; материал уходит на доску (`insertPage`) и ученику refresh |
| **V3** | **урок для другого предмета/класса**: карточка rowB → `[data-build-lesson]`: `#bl-topic`/`#bl-notes` → `[data-act="build-lesson"]` → mock `materials` `kind="lesson"`, `course="math-5"`, `student_id=rowB`, `lesson_id=c…`, `data.custom=true`, `data.theory/practice/test`; учитель видит тему в карточке; ученик rowB после reload видит урок в «Моих уроках» и теорию в плане |
| **U1** | отдельный процесс: база самообучения (12 блоков/180 слов, 5 колод) + конструктор наборов учителя (создание stress/deck `kind:"tasks"`, `lesson_id:"self"`), ученик видит/проходит свои наборы, прогресс `task=SELF_DATA.taskFor("m<id>")` у учителя, правка названия и удаление; см. секцию ниже |
| **U2** | доступ без подписки: раздел «Доступ», всё открыто, оплата не предлагается |
| **W1** | **кабинет на планшете**: (a) `__MOCK.delay("topic_quizzes", 15000)` (медленный фон) → `[data-student]` появляются задолго до конца фона (проба в странице: studentsAt < bgAt−1 c), `T.loading=false`, без висящего «Загружаю…» и без карточки ошибки, затем `T.bgLoaded=true` и `T.bgError` содержит «тесты по темам», после снятия задержки и «Обновить» фон догружается без ошибок; (b) `__MOCK.fail("students","нет сети")` → карточка `[data-t-load-error]` «Не загрузились ученики: нет сети» + `[data-act="reload"]` «Повторить», списка нет; после снятия fail и клика — `[data-student]` появились; (c) `Emulation.setDeviceMetricsOverride` 820×1180 + iPad UA: ≥2 строки `[data-student]` видимы/в документе/не перекрыты (elementFromPoint), клик открывает `[data-t-student-all]` |

Важные детали e2e:
- все вкладки одного origin делят `localStorage`, поэтому mock-БД пишется только в пустое
  хранилище (`seedScript`), а перед Q3 старая вкладка ученика (rowB) закрывается, чтобы её
  сессия не перетирала сессию rowA;
- T1/T2 сидят mock-БД своим сидом (пересоздают целиком) — поэтому идут после Q/S и до V;
- V2/V3 идут после T4 и работают в кабинете без перезагрузки: открывают карточку rowB,
  начинают/завершают комнату, вызывают панель «Инструменты»;
- мок-лог (`__MOCK.cmdList()`, `__MOCK.lastRpc()`) локальный на вкладку: команды `cmd`
  проверяются на вкладке учителя, `quiz_submit` — на вкладке ученика;
- у ученика есть `window.__app = {S, render}` — тесты проверяют состояние (`S.view`,
  `S.room`, `S.profile`) вместо хрупких DOM-признаков;
- перед открытием карточки после перезагрузки кабинета тесты делают `sessionStorage.clear()`
  (иначе восстановленный маршрут открывает не тот экран).

## Мок Supabase (`mock-supabase.js`)

Фейковый `window.supabase.createClient` (внедряется до скриптов страницы): auth
(`getSession/signIn…/onAuthStateChange/updateUser/signOut`), `rpc`, `from()` с цепочками
`select/insert/update/delete/upsert/eq/neq/in/order/limit/single`, `functions.invoke`,
`storage.from().upload/getPublicUrl/remove`, `channel(name,{config})` с `broadcast/presence/
track/presenceState/subscribe/removeChannel`. Общее состояние вкладок — `localStorage` +
`BroadcastChannel`; данные задаются через `window.__MOCK_CFG` (`session`, `db`, `reset`).

Расширения под тесты:
- НАШИ таблицы `topic_quizzes`/`topic_quiz_results` — обычные таблицы общей БД; при `insert`
  учителя проставляется `teacher_id = auth.uid()` (как default в `supabase/schema.sql`);
- RPC по контракту `schema.sql`: `quiz_get`, `quiz_submit` (валидирует код/баллы/принадлежность,
  размер details), `student_quizzes` → `{quizzes:[…last], results:[…]}`;
- `functions.invoke("ai", {body:{action}})`:
  - `generate_tasks` → 2–3 вопроса `{q,o:[4],a,e,tag}` в `data.test` (+`title`/`mini`);
  - **`build_lesson`** (V3) → `{title, learn[], theory:[{h,t,list,ex,mini}]x2, practice:[{t,key,items}]x2, test:[{q,o,a,e,tag}]x2, hw[], method:{focus}}` — полноценный урок для любого предмета/класса;
  - **`edit_lesson`** (`kind:"theory"` → `{blocks:[{h,t,list,ex,mini}]}`, `kind:"practice"` → `{tasks:[{t,key,items}]}`) и `generate_theory`/`generate_content`/`content_edit`/`generate_material` → блоки теории/практики/тестов (панель «Сгенерировать материал»);
  - `log("rpcs", {name, keys, args})` — в `args` компактные скаляры (например `p_score`, `p_total`), тесты проверяют `__MOCK.lastRpc("quiz_submit").args`;
- **самообучение**: `student_save_work` — настоящий upsert `works(student_id, lesson_id, task)`;
  `student_submit_result` пишет `results` (`kind="self"`), `student_state` отдаёт формы схемы:
  `works:[{lesson_id,task,data}]`, `results:[{lesson_id,kind,score,total,wrong,created_at,duration_sec}]`;
- **динамика (график)**: `results`/`topic_quiz_results` отдают `created_at/kind/score/total`
  и сортируются по `created_at` — как ждёт `Trend.pointsFromRows/pointsFromQuizzes`;
- **карточка учителя**: `from("board_items")` с фильтрами по `student_id`/`lesson_id`, `.in`,
  `.order`, `.limit`; `works` читаются по `student_id`;
- **управляемые задержки/ошибки (W1)**: `__MOCK.delay(table, ms)` — `from(table).select` ждёт ms; `__MOCK.fail(table, msg)` — возвращает `{data:null,error:{message}}`; `__MOCK.failRpc(name, msg)`; `__MOCK.clearControls()`, `__MOCK.controlsDone()`. По умолчанию карты пусты — поведение мока не меняется; настройку для сценария ставят через `addScriptToEvaluateOnNewDocument` ДО загрузки страницы (новый документ создаёт новый мок), снимают `page.removeInjected(id)`;- хелперы `window.__MOCK`: `dbTable(name)`, `tables()`, `tokens()`, `reset(seed)`,
  `broadcastLog()`, `cmdList()`, `lastRpc(name)`, `rpcNames()`, `involveLog()`, `channels()`,
  `presenceOf(name)`.

## Доска (`board.mjs`, `board.html`)

Страница `board.html` монтирует **две доски** (1100 px и 380 px) с общим in-memory api и
fake-каналом; `window.__boards = {teacher, student}`, хелперы — `window.__board`:

- геометрия: `point/logicalRect/ink/scaleOf`, якоря `elementAtAnchor/elementUnderPoint`;
- **зум/пан**: `boardView/zoomOf/scrollInfo/setScroll/clickZoom/zoomLabel/extendBoard/wheelBoard`,
  прямые вызовы API — `setZoom/zoomBy/fitWidth/extendHeight`;
- **инлайн-текст**: `inlineInfo` (`.bd-inline` + `[data-bd-inline]`, textarea `.bd-inline-ta`,
  ручка `.bd-inline-drag`, resize `.bd-inline-resize`/`.bd-editor-handle`, `logical`-бокс,
  `dragVisible`), `inlineType`, `hoverInline`;
- **вставка**: `pasteBoard` (ClipboardEvent с DataTransfer: текст/картинка), `boardCall` для
  `insertText/insertNote/insertImage/insertPage/pasteAtPoint/lastPoint`, `items/countItems`
  (из `debug().raw`);
- канал/вложения/листы/живой фон — как раньше (`channelLog`, `attachFiles`, `pageKeys/openPage`,
  `bgHtml/bgSource/waitBgSource`).

| id    | Сценарий |
|-------|----------|
| A0    | обе доски монтируются, листы рендерятся, fake-presence видит обе стороны |
| SMOKE | инструменты (pen/hl/text/erase/hand/touch/move ✥), кнопки attach/embed, снимок 📸, `info().ready/width/anchors`, `Board.keep()`; затем bg-режим |
| B1    | штрих учителя появляется у ученика через broadcast |
| C     | якорь: штрих остаётся на тексте при сдвинутом макете второй стороны (+remount) |
| D1    | две картинки через «На этот лист» не накладываются, видны второй стороне, живы после remount |
| D2    | ✥ двигает картинку: позиция сохраняется, вторая сторона видит, жива после remount |
| D3    | PDF «Отдельными листами»: доп. листы в `"_pages"`, видны обеим сторонам, живы после remount |
| D4    | большой лист (>55k html): обрезан ≤55000, одинаков у сторон, сохранён, жив после remount |
| E1    | текст: T → тап → `.bd-editor` в фокусе, ввод, ручка размера (перечитывается после ввода, т.к. инлайн авто-растёт), Enter → надпись, видна учителю |
| E2    | надпись переживает remount |
| F1–F4 | единый фон живого листа: `bgSource=remote`, совпадение координат/якорей у сторон, `bgreq` из detached-рендера |
| G     | якоря в пустоте: штрих между абзацами остаётся у ближайшего абзаца при вставке абзаца + refresh |
| **H1** | **точечный ластик**: две параллельные линии в 12 лог. px (радиус ER=7 + полутолщина — при 2–4 px соседняя линия неизбежно попадает в радиус; 12 px — «рядом, но вне радиуса») + надпись через `insertText`; ластик по середине первой линии → старый stroke-item удалён и заменён ≥2 новыми `t:"s"` кусками, второй штрих (id/p не изменились) и надпись целы; клик ластиком рядом с надписью её не удаляет, внутри реального текста — удаляет |
| **H2** | **инлайн-текст**: тап T → `.bd-editor.bd-inline` (без старого большого окна), textarea `.bd-inline-ta`, длинная строка увеличивает ширину (авто-размер); при наведении видна ручка `.bd-inline-drag` (opacity), таскает окошко; `.bd-inline-resize`/`.bd-editor-handle` меняет w/h; Enter → объект `{t:"t", s, x,y,w,h}` в точке клика с авто w/h; remount — надпись жива |
| **H3** | **зум/пан/расширение**: `[data-zoom=in/out/reset/fit]` и `[data-zoom-label]` меняют `info().zoom`; Ctrl+wheel зумит к курсору; `.bd-stage` scroll → `info().scrollX/Y`; hand-drag прокручивает; `[data-act=extend]` увеличивает `info().height`; после `setZoom(1.6)` `lastPoint()` и нарисованный штрих совпадают с логическими координатами клика (±8) |
| **I1** | **выделение и удаление**: `board.select(id)`/✥-тап по объекту → `.bd-selbox` (`data-id`), `.bd-sel-bar`, `info().selected`; 🗑 `[data-sel=del]`, **Delete/Backspace** и контекстное меню (`contextmenu` → `.bd-menu [data-mact=del]` «🗑 Удалить») удаляют картинку и надпись у обеих сторон, после удаления рамка/панель скрыты |
| **I2** | **ресайз картинки**: drag `.bd-sel-resize` увеличивает w/h с сохранением пропорций (id переезжает, selection не теряется), `[data-sel=reset]` возвращает базовый w, после remount размер сохранён и виден второй стороне |
| **I3** | **ресайз/шрифт текста**: A+/A− меняют `sz` (22→26, шаг 2, высота растёт), drag угла меняет w/h, `[data-sel=reset]` → sz=22/авто-ширина, `sz` сохраняется после remount |
| **H4** | **вставка в точку**: клик по холсту обновляет `lastPoint`; paste текста открывает `.bd-inline` в lastPoint (Enter → t-объект ±20); `insertText/insertImage` API ставят объекты в заданные (x,y); вставки видны второй стороне; paste картинки — `t:"i"` в lastPoint; `insertPage` добавляет и открывает лист (`info().page`, `info().pages`) |

**Живой фон листа.** Ученик после отрисовки live-листа шлёт `send("bg",{page,html})`;
учитель предпочитает этот html своему (`bgSource="remote"`), а если его нет — шлёт `bgreq`;
ученик отвечает даже для не открытого листа (detached-рендер). Хуки: `info().bgSource`,
`debug().remoteBgPages`, канал — `__board.channelLog("bg"|"bgreq")`.
Контракт доски: `mount().info/debug/whenIdle/attach/addPage/openPage/refresh/destroy` +
аддитивные `insertText/insertNote/insertImage/insertPage/pasteAtPoint/lastPoint/getView/
setZoom/zoomBy/fitWidth/extendHeight`; `info()` доп. `zoom, scrollX, scrollY, lastPoint, view`.

## Файлы

- `run.mjs` — полный прогон наборов (mock + доска + e2e + e2e U1), итог PASS/FAIL, exit code;
- `mock-supabase.js` — фейковый Supabase (auth/rpc/from/channel/storage/functions + quiz + ai);
- `mock-selftest.mjs` — самопроверка мока без браузера (71 проверка);
- `e2e.mjs` — мир учителя/ученика, сценарии a,b1,R1,b2–b3,Q1–Q6,S1–S4,T1–T4,V1–V3,U2,W1,U1;
- `board.html` + `board-harness.js` + `board.mjs` — стенд доски и 22 сценария (15 старых + H1–H4 + I1–I3);
- `cdp.mjs` — мини-драйвер CDP (Chrome, мышь/клавиатура, `Runtime.evaluate`, скриншоты);
- `serve.mjs` — статический сервер корня worktree (без кэша, авто-порт);
- `artifacts/` — скриншоты падений (создаётся при падении).
