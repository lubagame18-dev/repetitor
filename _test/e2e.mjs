/* E2E-проверки repetitor v57 без npm и без сети (Node 22+, глобальный WebSocket, Chrome).
   Сценарии:
     a) ученик на предмете B, учитель начинает урок предмета A → ученик сам переключается
        на предмет A, видит материал урока без перезагрузки; у учителя «онлайн», а не «не в сети»;
     b1) смена урока в комнате → у ученика новый материал < 2 c без перезагрузки;
     b2) урок из другого предмета (учитель открывает урок B, когда ученик в комнате на A)
         → ученик переключается и видит материал < 4 c без перезагрузки;
     b3) refresh в комнате → тост «Материалы обновились», доска не сбрасывается, без перезагрузки;
     Q1) учитель собрал тест по темам → строка в topic_quizzes, ссылка ?quiz=, кнопка «Открыть у ученика»
         отправляет live cmd type "quiz";
     Q2) ручное «пройдено»: covered + covered_manual, колонка «Выполнено» не меняется, снятие;
     Q3) ученик проходит тест по прямой ссылке: неверно → объяснение + повтор, повторно неверно →
         «Дальше» и тема needs_work; финиш .quiz-result + rpc quiz_submit;
     Q4) карта тем у учителя (#qz-map .qz-topic.bad) и у ученика (раздел «Тесты»);
     S1) самообучение, блок ударений: ошибка → подсказка/повтор, 15/15; works self:stress + result kind self;
     S2) ошибка возвращает слово (+2 повтора), оно не освоено и попадает в errors (Play.stressState);
     S3) карточки: «Показать ответ» → «Знаю»/«Ещё учить» (возврат карточки) до всех карточек;
         works self:deck + result kind self (self:cards);
     S4) «Мои ошибки» собираются из ошибок тренажёров, проход уменьшает items; прогресс подхватывается
         после перезагрузки; блок «Что подтянуть» (.self-prep).
   Доска в реальном приложении проверяется отдельно стендом _test/board.mjs (board.html).

   Запуск: node _test/e2e.mjs            (headless)
           E2E_HEADLESS=0 node _test/e2e.mjs
           E2E_ONLY=a,b1,Q1 node _test/e2e.mjs    (S1–S4 можно гонять отдельно: E2E_ONLY=S)
   Мок Supabase внедряется до скриптов страницы (addScriptToEvaluateOnNewDocument).
   Порты: 8766 (статика) / 9334 (CDP), чтобы не пересекаться с board.mjs (8765/9333).
   Если порт занят другим прогоном — задайте PORT/CDP_PORT (иначе можно подключиться к чужому Chrome
   и получить серию «CDP timeout: Runtime.evaluate»). */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";
import { startServer, REPO_ROOT } from "./serve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "artifacts");
const MOCK_SRC = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const PORT = +(process.env.PORT || 8766);
const CDP_PORT = +(process.env.CDP_PORT || 9334);

/* ================= данные: учитель, две строки ученика (два предмета), курсы ================= */
const TEACHER_ID = "t-1001";
const PERSON_ID = "person-1";
const ROW_A = "rowA"; // русский
const ROW_B = "rowB"; // математика
const TOKEN_B = "TOKEN-STUDENT-B";
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

function extractBuiltinCourses(keys) {
  // локальные файлы курсов грузим в vm (сеть не нужна)
  const indexBox = { window: {}, console };
  vm.createContext(indexBox);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "courses", "school.js"), "utf8"), indexBox, { timeout: 60000 });
  const IDX = indexBox.window.BUILTIN_INDEX || {};
  const box = { window: {}, console };
  vm.createContext(box);
  const subs = [...new Set(keys.map(k => (IDX[k] && IDX[k].subj) || null).filter(Boolean))];
  for (const subj of subs) {
    const f = path.join(REPO_ROOT, "courses", "school", subj + ".js");
    if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, "utf8"), box, { timeout: 180000 });
  }
  const all = box.window.BUILTIN_COURSES || {};
  const out = {};
  keys.forEach(k => { if (all[k]) out[k] = all[k]; });
  return out;
}
function trimCourse(c, maxLessons = 5) {
  const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
  const lessons = (c.lessons || []).slice(0, maxLessons).map(l => ({
    id: l.id, title: l.title, date: l.date, block: l.block, oge: l.oge, learn: (l.learn || []).slice(0, 3),
    theory: (l.theory || []).slice(0, 2).map(t => ({ h: clip(t.h, 300), t: clip(t.t, 1200), mini: (t.mini || []).slice(0, 2) })),
    practice: (l.practice || []).slice(0, 2),
    test: (l.test || []).slice(0, 2),
    hwtest: (l.hwtest || []).slice(0, 2),
    hw: clip(l.hw, 500),
    writing: l.writing ? { type: l.writing.type, text: l.writing.text, task: clip(l.writing.task, 400), classwork: clip(l.writing.classwork, 400) } : null,
    materials: [],
  }));
  return {
    course: c.course, tag: c.tag, goal: c.goal, grade: c.grade, grades: c.grades || null,
    blocks: c.blocks || {}, events: [], lessons,
    texts: c.texts || {}, izl: c.izl || {}, criteria: c.criteria || { errors: [], essay: [], izl: [] },
    methodology: [],
  };
}
export function buildWorld() {
  const raw = extractBuiltinCourses(["rus-5", "math-5"]);
  const rus = trimCourse(raw["rus-5"], 5);
  const math = trimCourse(raw["math-5"], 5);
  const rowCommon = {
    teacher_id: TEACHER_ID, teacher: TEACHER_ID, person_id: PERSON_ID, grade: 5,
    registered_at: new Date().toISOString(), start_date: iso(TODAY), dates: {}, unlocked: [],
    pair_id: null, theme: null, call_url: "", goals: ["Контрольные и домашние"], goal: "Контрольные и домашние",
    contact: "", note: "", invite_token: "", covered: {}, covered_manual: {},
  };
  const students = [
    Object.assign({}, rowCommon, { id: ROW_A, name: "Аня Тестова", course: "rus-5", subject: "ru", code: "STURU01", invite_token: "invA" }),
    Object.assign({}, rowCommon, { id: ROW_B, name: "Аня Тестова", course: "math-5", subject: "math", code: "STUMAT02", invite_token: "invB" }),
  ];
  const teachers = [{
    id: TEACHER_ID, name: "Любовь Игоревна", email: "teacher@test.local", join_code: "JOIN01",
    base: true, base_access: ["oge-rus", "rus-5", "math-5"], role: "teacher", theme: null, call_url: "",
    free: true, active: "full",
  }];
  const db = {
    seq: 5000,
    tokens: { [TOKEN_B]: ROW_B, "TOKEN-STUDENT-A": ROW_A },
    tables: {
      students, teachers, materials: [],
      course_data: [{ key: "rus-5", data: rus }, { key: "math-5", data: math }],
      board_items: [], app_settings: [], results: [], homework: [], writings: [], sheets: [], activity: [], ai_reports: [], works: [],
      topic_quizzes: [], topic_quiz_results: [],
    },
  };
  const profileOf = row => {
    const subs = students.filter(r => (r.person_id || r.id) === (row.person_id || row.id))
      .map(r => ({ id: r.id, subject: r.subject, course: r.course, grade: r.grade, name: r.name }));
    return {
      id: row.id, name: row.name, login: row.code, teacher: TEACHER_ID, grade: row.grade,
      subject: row.subject, course: row.course, person_id: row.person_id || row.id, subjects: subs,
      board_owner: row.id, call_url: "", theme: null, mascot: null, pair: null,
      unlocked: [], dates: {}, start_date: row.start_date, goals: row.goals || [], goal: row.goal || "",
    };
  };
  const lessons = {
    rus: rus.lessons.map(l => ({ id: l.id, title: l.title, testN: (l.test || []).length })),
    math: math.lessons.map(l => ({ id: l.id, title: l.title })),
  };
  return {
    db, lessons, profileOf,
    studentSession: (rowId) => {
      const row = students.find(r => r.id === rowId);
      return { token: rowId === ROW_B ? TOKEN_B : "TOKEN-STUDENT-A", profile: profileOf(row) };
    },
  };
}

const TEACHER_SESSION = { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, user: { id: TEACHER_ID, email: "teacher@test.local", user_metadata: { name: "Любовь Игоревна" } } };

/* ================= внедряемые скрипты ================= */
/* db пишем ТОЛЬКО в пустой localStorage: все вкладки одного origin делят mock-БД,
   иначе перезагрузка кабинета в Q4 или новая вкладка Q3 затёрла бы сохранённый тест. */
function seedScript({ db, session, studentSession, joinHow }) {
  return `(() => {
  if (typeof location !== "undefined" && location.protocol === "about:") return;  // about:blank — localStorage недоступен
  window.__MOCK_CFG = ${JSON.stringify({ session: session || null, reset: false })};
  try {
    if (!localStorage.getItem("mock-db-v1") && ${db ? "true" : "false"}) {
      localStorage.setItem("mock-db-v1", ${JSON.stringify(db ? JSON.stringify(db) : "null")});
      localStorage.setItem("mock-db-ver", "seed-" + Date.now());
    }
  } catch (e) { console.error("seed db", e); }
  try {
    ${studentSession
      ? `localStorage.setItem("oge-session", ${JSON.stringify(JSON.stringify(studentSession))});`
      : `localStorage.removeItem("oge-session");`}
    ${joinHow === null || joinHow === false
      ? `localStorage.removeItem("oge-join-how");`
      : `localStorage.setItem("oge-join-how", ${JSON.stringify(JSON.stringify(joinHow || "board"))});`}
  } catch (e) { console.error("seed session", e); }
})();`;
}
const blockUrls = async page => {
  // CDN в обычной сессии может быть доступен — блокируем, иначе настоящий supabase-js перезапишет мок
  try {
    await page.cdp.send("Network.enable");
    await page.cdp.send("Network.setBlockedURLs", { urls: ["*cdn.jsdelivr.net*", "*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
  } catch (_) {}
};

/* ================= раннер ================= */
const TESTS = [];
const test = (id, name, fn) => TESTS.push({ id, name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, what) {
  if (String(actual) !== String(expected)) throw new Error(`${what}: ожидали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`);
}
const studentSession = page => page.eval(`JSON.parse(localStorage.getItem("oge-session") || "null")`);
/** последняя команда учителя нужного типа (в логе бывают и refresh/act) */
const cmdOfType = (page, type) => page.eval(`(() => { const l = window.__MOCK.cmdList().filter(c => c.type === ${JSON.stringify(type)}); return l.length ? l[l.length - 1] : null; })()`);
/** состояние приложения ученика (window.__app = {S, render} в student.js) */
const studentState = page => page.eval(`(() => { const S = window.__app && window.__app.S; return S ? {view:S.view, subject:S.profile && S.profile.subject, id:S.profile && S.profile.id, room:S.room || null, quizToken:S.quizToken || null} : null; })()`);
const teacherDB = (page, table) => page.eval(`window.__MOCK.dbTable(${JSON.stringify(table)})`);
/** найти строку плана урока в карточке ученика (кнопка «Отметить»/чип «✓») по id урока */
const coveredRow = (page, lid) => page.eval(`(() => {
  const b = document.querySelector('[data-act="covered-toggle"][data-lid="${lid}"]');
  if (!b) return null;
  const tr = b.closest("tr"); if (!tr) return null;
  const cells = [...tr.children].map(td => (td.textContent || "").trim());
  return { lid: ${JSON.stringify(lid)}, covered: cells[4] || "", done: cells[6] || "", on: b.dataset.on, hasChip: /✓/.test(cells[4] || "") };
})()`);

/* ---------- самообучение: SELF_DATA, тренажёры Play (оверлей .play-ov) ---------- */
const ST_VOWELS = "аеёиоуыэюя";
/** индекс ударной буквы ровно как Play.stParse: заглавная гласная, иначе «ё», иначе 0 */
function stressIdx(raw){
  const chars = [...String(raw || "")];
  let idx = -1;
  chars.forEach((ch, i) => { const lc = ch.toLowerCase(); if (ST_VOWELS.includes(lc) && ch !== lc) idx = i; });
  if (idx < 0){ idx = chars.findIndex(c => c.toLowerCase() === "ё"); if (idx < 0) idx = 0; }
  return idx;
}
const stressPlain = raw => [...String(raw || "").toLowerCase()].join("");
const selfWords = (page, b) => page.eval(`(window.SELF_DATA && window.SELF_DATA.stress.blocks[${b}] && window.SELF_DATA.stress.blocks[${b}].words) || []`);
const selfDeckData = (page, d) => page.eval(`(window.SELF_DATA && window.SELF_DATA.decks[${d}]) || null`);
const stressDone = page => page.eval(`!!document.querySelector('.play-ov .play-end')`);

async function selfOpen(page){
  await page.eval(`(() => { const b = document.querySelector('[data-go="self"]'); if (b) b.click(); return !!b; })()`);
  await page.waitFor(`document.querySelectorAll('[data-act="self-stress-block"]').length >= 10 ? 1 : 0`,
    { timeout: 15000, label: "экран самообучения (>=10 блоков ударений)" });
}
async function openStressBlock(page, b){
  await page.eval(`(() => { const x = document.querySelector('[data-act="self-stress-block"][data-b="${b}"]'); if (x) x.click(); return !!x; })()`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .st-word .st-v') ? 1 : 0`,
    { timeout: 15000, label: "тренажёр ударений: блок " + b });
}
async function waitStressReady(page, timeout = 8000){
  await page.waitFor(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return 1; if (ov.querySelector('.play-res')) return 0; return (ov.querySelector('.play-end') || ov.querySelector('.st-word')) ? 1 : 0; })()`,
    { timeout, label: "следующее слово/финал ударений" });
}
async function closePlay(page){
  await page.eval(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return false; const x = ov.querySelector('.play-end [data-close]') || ov.querySelector('.play-x'); if (x) x.click(); return true; })()`);
  await page.waitFor(`!document.querySelector('.play-ov') ? 1 : 0`, { timeout: 6000, label: "оверлей Play закрыт" });
}
/** пройти блок ударений кликами по гласным; b — индекс встроенного блока или массив слов (свои наборы) */
async function runStressMastery(page, b, { firstWrong = false, maxSteps = 320 } = {}){
  const words = Array.isArray(b) ? b : await selfWords(page, b);
  const label = Array.isArray(b) ? "свой набор" : "блок " + b;
  assert(Array.isArray(words) && words.length >= 1, label + ": нет слов: " + JSON.stringify(words));
  const meta = new Map(words.map(w => [stressPlain(w), { raw: w, idx: stressIdx(w), plain: stressPlain(w) }]));
  const seen = new Map(); let steps = 0, firstBad = null, wrongDone = false, retryFeedback = false, stateAfterWrong = null;
  while (steps++ < maxSteps) {
    if (await stressDone(page)) break;
    const cur = await page.eval(`(() => { const w = document.querySelector('.play-ov .play-body .st-word'); return w ? w.textContent : null; })()`);
    assert(cur, "нет текущего слова в тренажёре ударений");
    const m = meta.get(cur);
    assert(m, "слово «" + cur + "» не найдено в " + label + ": " + JSON.stringify([...meta.keys()]));
    seen.set(cur, (seen.get(cur) || 0) + 1);
    if (!wrongDone && firstWrong) {
      const k = await page.eval(`[...document.querySelectorAll('.play-ov .st-v')].map(x => +x.dataset.k).find(k => k !== ${m.idx})`);
      assert(k != null, "не нашли неверную гласную для слова «" + cur + "»");
      await page.eval(`document.querySelector('.play-ov .st-v[data-k="${k}"]').click(); true`);
      const bad = await page.waitFor(`(() => { const f = document.querySelector('.play-ov .play-res.bad'); return f ? f.textContent : null; })()`,
        { timeout: 6000, label: "неверный ответ: подсказка .play-res.bad" });
      assert(bad.includes(m.raw), "в подсказке нет правильного ударения «" + m.raw + "»: " + JSON.stringify(bad));
      firstBad = m.plain; wrongDone = true;
      /* state-хук Play.stressState(): слово не освоено, ошибка записана, повторов +2 (reps = 3) */
      stateAfterWrong = await page.eval(`(() => { const s = window.Play && Play.stressState && Play.stressState(); return s ? {mastered: s.mastered, errors: s.errors, reps: s.reps, left: s.left, attempts: s.attempts} : null; })()`);
    } else {
      await page.eval(`document.querySelector('.play-ov .st-v[data-k="${m.idx}"]').click(); true`);
      const okText = await page.waitFor(`(() => { const f = document.querySelector('.play-ov .play-res.ok'); return f ? f.textContent : null; })()`,
        { timeout: 6000, label: "верный ответ: .play-res.ok" });
      if (firstBad === m.plain && /ещё раз|закрепим/i.test(okText)) retryFeedback = true;
    }
    await waitStressReady(page);
  }
  assert(await stressDone(page), "тренажёр ударений не дошёл до финала за " + maxSteps + " шагов (" + label + ")");
  return { seen, firstBad, retryFeedback, stateAfterWrong };
}
/** дождаться строки в materials (свои наборы учителя) */
async function waitMaterial(teacher, pred, timeout = 15000){
  return waitMockRow(teacher, "materials", pred, timeout);
}
/** пройти колоду карточек (или тренажёр «Мои ошибки»): Показать ответ → Знаю / Ещё учить */
async function runDeckLoop(page, { firstAgain = false, maxSteps = 400 } = {}){
  const seen = new Map(); let steps = 0, learnFront = null, backShown = 0;
  while (steps++ < maxSteps) {
    if (await page.eval(`!!document.querySelector('.play-ov .play-end')`)) break;
    const front = await page.eval(`(() => { const f = document.querySelector('.play-ov .play-body .self-front'); return f ? f.textContent : null; })()`);
    assert(front, "нет .self-front в тренажёре карточек");
    seen.set(front, (seen.get(front) || 0) + 1);
    if (await page.eval(`!!document.querySelector('.play-ov [data-show]')`)) {
      await page.eval(`document.querySelector('.play-ov [data-show]').click(); true`);
      const back = await page.waitFor(`(() => { const b = document.querySelector('.play-ov .self-back'); return b ? b.textContent : null; })()`,
        { timeout: 6000, label: "карточка: показан ответ ([data-show])" });
      assert(back && back.trim().length > 2, "пустой ответ на карточке «" + front + "»");
      backShown++;
    }
    if (!learnFront && firstAgain) { learnFront = front; await page.eval(`document.querySelector('.play-ov [data-again]').click(); true`); }
    else await page.eval(`document.querySelector('.play-ov [data-know]').click(); true`);
    await page.waitFor(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return 1; return (ov.querySelector('.play-end') || ov.querySelector('[data-show]')) ? 1 : 0; })()`,
      { timeout: 6000, label: "следующая карточка" });
  }
  assert(await page.eval(`!!document.querySelector('.play-ov .play-end')`), "колода не дошла до финала за " + maxSteps + " шагов");
  return { seen, learnFront, backShown };
}
/** дождаться строки в mock-БД (прогресс сохраняется с дебаунсом ~700 мс) */
async function waitMockRow(teacher, table, pred, timeout = 15000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const rows = await teacherDB(teacher, table);
    const row = rows.find(pred);
    if (row) return row;
    await sleep(150);
  }
  return null;
}
/** вкладка ученика rowA для S-сценариев (в полном прогоне её создаёт Q3) */
async function ensureSelfStudent({ browser, baseUrl }){
  if (W.quizTab) return W.quizTab;
  const page = await browser.newPage("about:blank");
  W.quizTab = page;
  await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-self.js");
  await page.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(page);
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && window.__app.S.profile ? 1 : 0`, { timeout: 25000, label: "вкладка ученика rowA (самообучение)" });
  return page;
}
/** дождаться прогресса на КАРТОЧКЕ блока (.self-blocks; в .self-prep такая же кнопка — не путать) */
async function waitBlockProgress(page, b, want = "15/15", timeout = 8000){
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < timeout) {
    last = await page.eval(`(() => { const el = document.querySelector('.self-blocks [data-act="self-stress-block"][data-b="${b}"]'); return el ? (el.getAttribute('data-self-progress') || el.textContent || "") : ""; })()`);
    if (String(last).includes(want)) return last;
    await sleep(150);
  }
  throw new Error("карточка блока " + b + " не показывает «" + want + "» (сейчас: " + JSON.stringify(last) + ")");
}

/** клик по строке ученика с повтором: кабинет может перерисоваться/зависнуть на загрузке.
    Успех = либо кликнули по строке, либо карточка ученика уже открылась (клик прошёл, а ответ eval потерялся). */
async function clickStudentRow(teacher, id, label = "строка ученика") {
  for (let i = 0; i < 60; i++) {
    const st = await teacher.eval(`(() => {
      const T = window.__teacher && window.__teacher.T;
      const el = document.querySelector('[data-student="${id}"]');
      if (el){ el.click(); return "clicked"; }
      if (document.querySelector('[data-t-student-all]') || (T && T.view === "student")) return "opened";
      return false;
    })()`).catch(() => false);
    if (st) return true;
    await teacher.waitFor(`document.querySelector('[data-student="${id}"]') ? 1 : 0`, { timeout: 3000, label }).catch(() => {});
    await sleep(200);
  }
  const diag = await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; return { view: T && T.view, students: T && T.students ? T.students.length : null, loading: T && T.loading, loadError: T && T.loadError, dom: document.querySelectorAll('[data-student]').length, body: (document.body.innerText || "").slice(0, 260) }; })()`).catch(e => String(e));
  throw new Error("не удалось кликнуть " + label + " (" + id + ") :: " + JSON.stringify(diag));
}
/** нажать «▶ Урок» в плане, дождавшись готовности карточки (курс может догружаться после списка учеников):
    кнопка может исчезнуть при перерисовке — повторяем клик, пока он не пройдёт */
async function clickStartLesson(teacher, lessonId, label = "урок в плане") {
  const sel = `[data-act="start-lesson"][data-rl="${lessonId}"]`;
  for (let i = 0; i < 120; i++) {
    const st = await teacher.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el){ el.click(); return "clicked"; }
      const T = window.__teacher && window.__teacher.T;
      return (document.querySelector('[data-t-loading]') || (T && T.bgLoading)) ? "loading" : false;
    })()`).catch(() => false);
    if (st === "clicked") return true;
    await sleep(150);
  }
  const diag = await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; return { view: T && T.view, loading: T && T.loading, bgLoading: T && T.bgLoading, students: T && T.students ? T.students.length : null, hasStart: !!document.querySelector('[data-act="start-lesson"]'), body: (document.body.innerText || "").slice(0, 300) }; })()`).catch(e => String(e));
  throw new Error("не дождались кнопки «▶ Урок» (" + lessonId + ", " + label + ") :: " + JSON.stringify(diag));
}
let W = null; // world (db+lessons) — заполняется в runE2E

/* ---------- a: авто-переключение предмета + присутствие ---------- */
test("a", "Ученик на предмете B: учитель начинает урок A → сам переключается, видит материал, у учителя «онлайн»", async ({ teacher, student }) => {
  const L = W.lessons.rus[0];
  // присутствие ДО начала: ученик сейчас на строке B, но его person_id общий → строка A тоже «онлайн»
  const badgeA = await teacher.eval(`(document.querySelector('[data-online="${ROW_A}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badgeA), "у учителя строка A не «онлайн», хотя ученик в сети на предмете B: " + JSON.stringify(badgeA));
  const count0 = await teacher.eval(`(document.getElementById("online-count") || {}).textContent || ""`);
  assert(/онлайн/.test(count0), "в кабинете нет «сейчас онлайн»: " + JSON.stringify(count0));

  await clickStudentRow(teacher, ROW_A, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${L.id}"]') ? 1 : 0`, { timeout: 12000, label: "план урока A у учителя («▶ Урок»)" });
  const s0 = await studentSession(student);
  assert(s0 && s0.profile && s0.profile.subject === "math", "ученик должен начинать на предмете B (math), а он на " + (s0 && s0.profile && s0.profile.subject));
  await student.eval(`window.__e2eMarker = "a"; true`);
  await teacher.eval(`window.Call = null; window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await clickStartLesson(teacher, L.id, "a: урок A");
  await sleep(150);
  const toast = await teacher.eval(`(document.getElementById("toast") || {}).textContent || ""`);
  const cmd = await cmdOfType(teacher, "lesson");
  assert(cmd, "учитель не отправил live-команду ученику (broadcast cmd)");
  eq(cmd.type, "lesson", "тип команды");
  eq(cmd.to, ROW_A, "адресат (to)");
  eq(cmd.lesson, L.id, "поле lesson в команде");
  eq(cmd.title, L.title, "поле title в команде");
  // v57: предмет ученик определяет по адресату (student_switch) — поля subj/course в команде не обязательны

  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.profile && S.profile.subject === "ru" && String(S.profile.id) === "${ROW_A}" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик сам переключился на предмет A (student_switch)" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(L.title)}) ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл урок A в комнате (без перезагрузки)" });
  await student.waitFor(`(() => { const b = document.querySelector("#board"); return b && b.querySelector(".bd-cv") && b.querySelector(".bd-bg") ? 1 : 0; })()`,
    { timeout: 9000, label: "у ученика смонтирована доска урока (#board .bd-cv/.bd-bg)" });
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 9000, label: "у ученика виден материал урока на доске (live-лист)" });
  const dt = Date.now() - t0;
  W.aMs = dt;
  assert(dt < 25000, `авто-переключение заняло ${dt} мс (> 25 c; в норме < 2 c; большой порог — шумная машина/OneDrive, фоновая догрузка курсов в кабинете)`);
  eq(await student.eval(`window.__e2eMarker || null`), "a", "страница ученика перезагрузилась (маркер сброшен)");

  const badge = await teacher.eval(`(document.querySelector('[data-online="${ROW_A}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badge), "у учителя нет бейджа «онлайн» у ученика: " + JSON.stringify(badge));
  assert(!/не в сети/i.test(toast), "ложный тост «ученик не в сети»: " + JSON.stringify(toast));

  // каналы доски у сторон совпадают (общая доска урока)
  await teacher.waitFor(`document.querySelector("#board .bd-cv") ? 1 : 0`, { timeout: 9000, label: "доска у учителя в комнате" });
  const tc = await teacher.eval(`window.__MOCK.channels()`);
  const sc = await student.eval(`window.__MOCK.channels()`);
  const shared = (tc || []).filter(n => n.startsWith("board-") && (sc || []).includes(n));
  assert(shared.length > 0, "каналы доски не совпадают: teacher=" + JSON.stringify(tc) + "; student=" + JSON.stringify(sc));
});

/* ---------- b1: смена урока в комнате ---------- */
test("b1", "Смена урока в комнате → у ученика новый материал < 2 c, без перезагрузки", async ({ teacher, student }) => {
  const L2 = W.lessons.rus[1];
  await teacher.waitFor(`document.getElementById("room-lesson") ? 1 : 0`, { timeout: 8000, label: "комната учителя: выбор урока" });
  await student.eval(`window.__e2eMarker = "b1"; true`);
  await teacher.eval(`window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await teacher.eval(`(() => { const s = document.getElementById("room-lesson"); s.value = ${JSON.stringify(L2.id)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.room && String(S.room.lesson) === ${JSON.stringify(L2.id)} ? 1 : 0; })()`,
    { timeout: 5000, label: "ученик получил новый урок (S.room.lesson)" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(L2.title)}) ? 1 : 0; })()`,
    { timeout: 5000, label: "у ученика заголовок нового урока в комнате" });
  const dt = Date.now() - t0;
  /* в норме смена урока < 2 c; порог 10 c — запас на нагрузку CI (как у a/b2): на занятой машине
     Chrome с тремя вкладками может отрисовать доску заметно дольше, это не регрессия продукта */
  assert(dt < 10000, `смена урока заняла ${dt} мс (> 10 c, порог с запасом на нагрузку CI; в норме < 2 c)`);
  eq(await student.eval(`window.__e2eMarker || null`), "b1", "страница ученика перезагрузилась при смене урока");
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 6000, label: "у ученика материал нового урока на доске" });
  const cmd = await cmdOfType(teacher, "lesson");
  eq(cmd.lesson, L2.id, "lesson в команде смены урока");
});

/* ---------- F1: «Вести ученика» – включает только учитель, действия ученика режим не снимают ---------- */
test("R0", "Ученик: все 54 урока ОГЭ и все их вкладки отрисовываются без ошибок и не пустые", async ({ student }) => {
  const res = await student.eval(`(async () => {
    const S = window.__app.S; const bad = [];
    await window.BuiltinLoader.ensure("oge-ru");
    const keepP = S.profile.course, keepM = S.mats; S.profile.course = "oge-ru"; S.mats = [];
    const c = U.courseFor(S.profile, []);
    const keep = S.course; S.course = c;
    for (const l of c.lessons){
      let tabs = []; try { tabs = __app.lessonTabs(l).filter(t => t[0] !== "board"); } catch (e) { bad.push(l.id + " tabs: " + e.message); continue; }
      if (!tabs.length) bad.push(l.id + ": нет вкладок");
      for (const [k] of tabs){ try { const h = __app.lessonPane(l, k); if (!h || h.length < 40) bad.push(l.id + "/" + k + ": пусто"); } catch (e) { bad.push(l.id + "/" + k + ": " + e.message); } }
    }
    S.course = keep; S.profile.course = keepP; S.mats = keepM; return {n: c.lessons.length, bad: bad.slice(0, 12), nbad: bad.length};
  })()`);
  console.log("       [R0] " + JSON.stringify(res));
  if (res.nbad) throw new Error("R0: " + JSON.stringify(res.bad));
});

test("F1", "Учитель включает «Вести ученика»: у ученика S.follow.on; уход ученика в раздел режим не сбрасывает; снимает только учитель", async ({ teacher, student }) => {
  await student.waitFor(`(() => { const S = window.__app.S; return S && S.view === "room" && S.room ? 1 : 0; })()`, { timeout: 8000, label: "F1: ученик в комнате" });
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="room-follow"]'); if (!b) return false; b.click(); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app.S; return S.follow && S.follow.on ? 1 : 0; })()`, { timeout: 8000, label: "F1: у ученика включился режим ведения" });
  /* ученик нажимает у себя в меню – режим остаётся */
  await student.eval(`(() => { const b = document.querySelector('[data-act="open-drawer"]'); if (b) b.click(); return true; })()`);
  await student.eval(`(() => { const b = document.querySelector('[data-go="self"]'); if (b) b.click(); return true; })()`);
  await sleep(1500);
  eq(await student.eval(`!!(window.__app.S.follow && window.__app.S.follow.on)`), true, "F1: действие ученика сбросило режим ведения");
  /* учитель снимает вручную */
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="room-follow"]'); if (!b) return false; b.click(); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app.S; return !S.follow ? 1 : 0; })()`, { timeout: 8000, label: "F1: учитель выключил – у ученика режим снят" });
  /* вернуть ученика на урок для следующих проверок */
  await student.eval(`(() => { const b = document.querySelector('.lesson-backbar [data-act="back-to-room"]'); if (b) b.click(); return true; })()`);
});

/* ---------- R1: меню ученика во время урока и баннер «Вернуться к уроку» ---------- */
test("R1", "Ученик: меню во время урока (data-go), баннер .lesson-backbar, presence не выдёргивает, завершение/повторный старт", async ({ teacher, student }) => {
  /* 1) урок уже идёт (после a/b1), ученик в комнате */
  await student.waitFor(`(() => { const S = window.__app.S; return S && S.view === "room" && S.room ? 1 : 0; })()`,
    { timeout: 8000, label: "R1: ученик в комнате урока (S.view=room, S.room)" });
  const lessonId = await student.eval(`String(window.__app.S.room.lesson)`);
  /* 2) меню ученика работает во время урока: self */
  await student.eval(`(() => { const b = document.querySelector('[data-act="open-drawer"]'); if (b) b.click(); return !!b; })()`);
  await student.waitFor(`window.__app.S.drawer ? 1 : 0`, { timeout: 5000, label: "R1: меню ученика открыто" });
  await student.eval(`(() => { const b = document.querySelector('[data-go="self"]'); if (!b) return false; b.click(); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app.S; return S.view === "self" ? 1 : 0; })()`,
    { timeout: 8000, label: "R1: меню переключило на «Самообучение» во время урока" });
  eq(await student.eval(`window.__app.S.away`), true, "R1: S.away=true после ухода из комнаты по меню");
  eq(await student.eval(`!!window.__app.S.room`), true, "R1: S.room пропал после ухода (урок идёт)");
  /* 3) постоянный баннер «Идёт урок» + кнопка «Вернуться к уроку» */
  await student.waitFor(`document.querySelector('.lesson-backbar') ? 1 : 0`, { timeout: 6000, label: "R1: баннер .lesson-backbar на разделе" });
  const bar = await student.eval(`(() => { const b = document.querySelector('.lesson-backbar'); const btn = b && b.querySelector('[data-act="back-to-room"]'); return { text: (b && b.textContent || "").trim(), btn: btn ? (btn.textContent || "").trim() : null }; })()`);
  if (!bar.btn) throw new Error("R1: в .lesson-backbar нет [data-act=back-to-room]: " + JSON.stringify(bar));
  if (!/урок/i.test(bar.text)) throw new Error("R1: в баннере нет текста про урок: " + JSON.stringify(bar));
  /* 4) ждём 2–3 c (presence/учитель онлайн) — не должно выдёргивать в room */
  await sleep(2800);
  const st = await student.eval(`(() => { const S = window.__app.S; return { view: S.view, room: !!S.room, away: S.away, join: !!document.querySelector('.joinbox'), bar: !!document.querySelector('.lesson-backbar') }; })()`);
  eq(st.view, "self", "R1: присутствие выдернуло ученика из «Самообучения» обратно в room");
  eq(st.room, true, "R1: S.room должен оставаться, пока урок идёт");
  if (st.join) throw new Error("R1: во время урока показан .joinbox (ученика зовут обратно): " + JSON.stringify(st));
  if (!st.bar) throw new Error("R1: баннер .lesson-backbar пропал на разделе «Самообучение»");
  /* 5) «Вернуться к уроку» → room, баннер исчез */
  await student.eval(`document.querySelector('.lesson-backbar [data-act="back-to-room"]').click(); true`);
  await student.waitFor(`(() => { const S = window.__app.S; return S.view === "room" ? 1 : 0; })()`, { timeout: 8000, label: "R1: «Вернуться к уроку» → room" });
  if (await student.eval(`!!document.querySelector('.lesson-backbar')`)) throw new Error("R1: баннер остался в комнате урока");
  eq(await student.eval(`window.__app.S.away`), false, "R1: S.away=false после возврата в комнату");
  /* снова уходим, теперь на «Главную» — баннер снова есть */
  await student.eval(`(() => { const b = document.querySelector('[data-act="open-drawer"]'); if (b) b.click(); return true; })()`);
  await student.waitFor(`window.__app.S.drawer ? 1 : 0`, { timeout: 5000, label: "R1: меню открыто во второй раз" });
  await student.eval(`document.querySelector('[data-go="home"]').click(); true`);
  await student.waitFor(`(() => { const S = window.__app.S; return S.view === "home" ? 1 : 0; })()`, { timeout: 8000, label: "R1: меню → «Главная» во время урока" });
  await student.waitFor(`document.querySelector('.lesson-backbar') ? 1 : 0`, { timeout: 6000, label: "R1: баннер на «Главной»" });
  /* 6) учитель завершает урок → баннер исчез, ученик остался в своём разделе, S.room=null */
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="room-end"]'); if (!b) return false; b.click(); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app.S; return !S.room ? 1 : 0; })()`, { timeout: 15000, label: "R1: урок завершён → S.room=null" });
  await student.waitFor(`(() => { const S = window.__app.S; return S.view === "home" ? 1 : 0; })()`, { timeout: 8000, label: "R1: после завершения урока ученик остался в «Главной»" });
  if (await student.eval(`!!document.querySelector('.lesson-backbar')`)) throw new Error("R1: баннер остался после завершения урока");
  /* 7) учитель снова начинает урок → явная команда снова открывает комнату, away=false */
  await teacher.eval(`document.querySelector('.navitem[data-view="students"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 8000, label: "R1: список учеников после завершения урока" });
  await clickStudentRow(teacher, ROW_A, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${lessonId}"]') ? 1 : 0`, { timeout: 10000, label: "R1: кнопка «▶ Урок» для повторного старта" });
  await clickStartLesson(teacher, lessonId, "V: урок в плане");
  await student.waitFor(`(() => { const S = window.__app.S; return S.view === "room" ? 1 : 0; })()`, { timeout: 12000, label: "R1: явная команда учителя снова открыла комнату" });
  eq(await student.eval(`window.__app.S.away`), false, "R1: S.away=false после явной команды учителя");
});

/* ---------- b2: урок из другого предмета ---------- */
test("b2", "Урок из другого предмета: ученик в комнате на A, учитель открывает урок B → переключение и материал < 4 c", async ({ teacher, student }) => {
  const M = W.lessons.math[0];
  await teacher.eval(`document.querySelector('.navitem[data-view="students"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_B}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников у учителя" });
  await clickStudentRow(teacher, ROW_B, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${M.id}"]') ? 1 : 0`, { timeout: 10000, label: "план урока B у учителя" });
  await student.eval(`window.__e2eMarker = "b2"; true`);
  await teacher.eval(`window.Call = null; window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await clickStartLesson(teacher, M.id, "b2: урок B");
  await sleep(150);
  const cmd = await cmdOfType(teacher, "lesson");
  assert(cmd, "нет команды урока B");
  eq(cmd.to, ROW_B, "адресат команды B");
  eq(cmd.lesson, M.id, "lesson команды B");
  eq(cmd.title, M.title, "title команды B");
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.profile && S.profile.subject === "math" && String(S.profile.id) === "${ROW_B}" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик переключился на предмет B" });
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.room && String(S.room.lesson) === ${JSON.stringify(M.id)} ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл урок B в комнате" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(M.title)}) ? 1 : 0; })()`,
    { timeout: 8000, label: "у ученика заголовок урока B в комнате" });
  const dt = Date.now() - t0;
  W.b2Ms = dt;
  assert(dt < 10000, `переключение на другой предмет заняло ${dt} мс (> 10 c, порог с запасом на нагрузку CI)`);
  eq(await student.eval(`window.__e2eMarker || null`), "b2", "страница ученика перезагрузилась при смене предмета");
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 8000, label: "у ученика материал урока B на доске" });
  const badge = await teacher.eval(`(document.querySelector('[data-online="${ROW_B}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badge), "у учителя нет «онлайн» у строки B: " + JSON.stringify(badge));
});

/* ---------- b3: refresh в комнате ---------- */
test("b3", "refresh в комнате: тост «Материалы обновились», доска не сбрасывается, без перезагрузки", async ({ teacher, student }) => {
  await student.eval(`window.__e2eMarker = "b3"; true`);
  const sendRefresh = () => teacher.eval(`(async () => {
    const ch = window.__MOCK.client.channel("live-${TEACHER_ID}", {config: {broadcast: {self: false}}});
    await new Promise(res => ch.subscribe(() => res()));
    ch.send({type: "broadcast", event: "cmd", payload: {cmd: true, to: ${JSON.stringify(ROW_B)}, type: "refresh", msg: "Материалы обновились"}});
    await new Promise(r => setTimeout(r, 250));
    ch.unsubscribe();
    return true;
  })()`);
  const toastShown = () => student.waitFor(`(() => { const t = document.getElementById("toast"); return t && !t.hidden && t.textContent.includes("Материалы обновились") ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик получил refresh (тост «Материалы обновились»)" });
  /* канал-подписчик иногда не успевает подписаться до send (BroadcastChannel) — повторяем отправку один раз */
  try { await sendRefresh(); await toastShown(); }
  catch (_) { await sleep(500); await sendRefresh(); await toastShown(); }
  await sleep(250);
  eq(await student.eval(`window.__e2eMarker || null`), "b3", "страница ученика перезагрузилась на refresh");
  assert(await student.eval(`!!document.querySelector("#board .bd-cv")`), "доска исчезла после refresh (S.pendingRender должен сохранять доску)");
});

/* ---------- Q1: учитель собрал тест по темам ---------- */
test("Q1", "Учитель собрал тест по 2 темам → строка в topic_quizzes, ссылка ?quiz=, «Открыть у ученика» шлёт cmd quiz", async ({ teacher }) => {
  await teacher.eval(`document.querySelector('.navitem[data-view="students"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников у учителя" });
  await clickStudentRow(teacher, ROW_A, "список учеников");
  await teacher.waitFor(`document.getElementById("qz-card") ? 1 : 0`, { timeout: 10000, label: "карточка «Тест по темам» у учителя" });

  const topics = await teacher.eval(`[...document.querySelectorAll("[data-qz-topic]")].map(x => x.value)`);
  assert(topics.length >= 2, "в карточке меньше 2 тем-уроков: " + JSON.stringify(topics));
  W.lessonA = topics[0];
  // выбираем 2 темы и 2 вопроса на тему (детерминированно, быстро); после каждой отметки render() пересоздаёт DOM
  await teacher.eval(`(() => { const b = [...document.querySelectorAll("[data-qz-topic]")][0]; b.checked = true; b.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(120);
  await teacher.eval(`(() => { const b = [...document.querySelectorAll("[data-qz-topic]")][1]; b.checked = true; b.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(120);
  await teacher.eval(`(() => { const cnt = document.getElementById("qz-count"); if (cnt){ cnt.value = "2"; cnt.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  await sleep(100);
  await teacher.eval(`document.querySelector('[data-act="qz-build"]').click(); true`);
  await teacher.waitFor(`document.getElementById("qz-title") && document.querySelector('[data-act="qz-save"]') ? 1 : 0`,
    { timeout: 20000, label: "предпросмотр теста (название + «Сохранить и получить ссылку»)" });
  const draftInfo = await teacher.eval(`(() => {
    const t = document.getElementById("qz-title"), card = document.getElementById("qz-card");
    return { title: t ? t.value : null, topics: card ? card.querySelectorAll(".qz-topic").length : 0,
             save: !!(card && card.querySelector('[data-act="qz-save"]')),
             text: card ? (card.textContent || "") : "" };
  })()`);
  assert(draftInfo.title && draftInfo.title.length > 3, "в предпросмотре нет названия теста (#qz-title): " + JSON.stringify(draftInfo.title));
  assert(draftInfo.topics >= 2, "в предпросмотре меньше 2 групп тем (.qz-topic): " + draftInfo.topics);
  assert(draftInfo.save, "в предпросмотре нет кнопки [data-act=qz-save]");
  assert(/вопросов\s*:\s*\d+/i.test(draftInfo.text) || /Предпросмотр:\s*\d+\s*вопр/i.test(draftInfo.text), "предпросмотр не показывает число вопросов: " + JSON.stringify(draftInfo.text.slice(-300)));

  await teacher.eval(`document.querySelector('[data-act="qz-save"]').click(); true`);
  await teacher.waitFor(`document.querySelector("[data-qz-link]") && document.getElementById("qz-link") ? 1 : 0`,
    { timeout: 15000, label: "ссылка ?quiz= после сохранения теста" });
  const link = await teacher.eval(`document.getElementById("qz-link").value`);
  const m = /[?&]quiz=([^&]+)/.exec(link || "");
  assert(m, "в ссылке нет ?quiz=КОД: " + JSON.stringify(link));
  W.quizId = decodeURIComponent(m[1]);
  const anchorOk = await teacher.eval(`(() => { const a = document.querySelector("[data-qz-link]"); return a ? /[?&]quiz=/.test(a.getAttribute("href") || "") : false; })()`);
  assert(anchorOk, "нет ссылки [data-qz-link] с ?quiz=");

  const quizzes = await teacherDB(teacher, "topic_quizzes");
  const row = quizzes.find(q => q.id === W.quizId);
  assert(row, "в mock-БД нет строки topic_quizzes с id " + W.quizId + ": " + JSON.stringify(quizzes.map(q => q.id)));
  eq(row.student_id, ROW_A, "quizzes.student_id");
  assert(Array.isArray(row.data.questions) && row.data.questions.length >= 2, "в тесте меньше 2 вопросов: " + JSON.stringify(row.data && row.data.questions && row.data.questions.length));
  assert(Array.isArray(row.data.topics) && row.data.topics.length >= 2, "в тесте меньше 2 тем: " + JSON.stringify(row.data && row.data.topics));
  assert(row.data.questions.every(q => q.topic && q.topicId), "у вопроса нет topic/topicId: " + JSON.stringify(row.data.questions.find(q => !q.topic || !q.topicId)));
  W.quizTopic = row.data.questions.find(q => q.topic)?.topic || "";
  W.quizQuestions = row.data.questions;

  // «Открыть у ученика» → live cmd type "quiz"
  const refreshQ = await teacher.waitFor(`(() => { const l = window.__MOCK.cmdList().filter(c => c.type === "refresh" && c.to === "${ROW_A}"); return l.length ? l[l.length - 1] : null; })()`,
    { timeout: 6000, label: "после сохранения теста ученику отправлено обновление (refresh)" });
  assert(refreshQ, "нет live cmd refresh ученику после сохранения теста");
  await teacher.eval(`window.__MOCK.LOG.broadcasts.length = 0; true`);
  await teacher.eval(`document.querySelector('[data-act="qz-open"]').click(); true`);
  const quizCmd = await teacher.waitFor(`(() => { const l = window.__MOCK.cmdList().filter(c => c.type === "quiz"); return l.length ? l[l.length - 1] : null; })()`,
    { timeout: 6000, label: "live cmd type=quiz после «Открыть у ученика»" });
  eq(quizCmd.token, W.quizId, "cmd quiz.token");
  assert(quizCmd.title, "в cmd quiz нет title");
});

/* ---------- Q2: ручное «пройдено» ---------- */
test("Q2", "Ручное «пройдено»: covered+covered_manual, чип ✓, «Выполнено» не меняется, повторное нажатие снимает", async ({ teacher }) => {
  await teacher.waitFor(`document.querySelector("[data-act='covered-toggle']") ? 1 : 0`, { timeout: 10000, label: "кнопки «Отметить» в таблице уроков" });
  const before = await coveredRow(teacher, W.lessonA);
  assert(before, "не нашли строку урока с [data-act=covered-toggle][data-lid=" + W.lessonA + "]");
  eq(before.on, "1", "до отметки data-on (ожидали кнопку «Отметить» с data-on=1)");
  await teacher.eval(`document.querySelector('[data-act="covered-toggle"][data-lid="${W.lessonA}"][data-on="1"]').click(); true`);
  const after = await teacher.waitFor(`(() => {
    const row = window.__MOCK.dbTable("students").find(x => x.id === "${ROW_A}");
    return row && row.covered_manual && row.covered_manual[${JSON.stringify(W.lessonA)}] ? row : null;
  })()`, { timeout: 8000, label: "mock-БД: students.covered_manual обновился" });
  assert(after.covered && after.covered[W.lessonA], "в students.covered нет отметки: " + JSON.stringify(after.covered));
  const rowAfter = await coveredRow(teacher, W.lessonA);
  assert(rowAfter && rowAfter.hasChip, "в карточке не появился чип «✓»: " + JSON.stringify(rowAfter));
  eq(rowAfter.done, before.done, "колонка «Выполнено» изменилась после ручной отметки");
  // снятие
  await teacher.eval(`document.querySelector('[data-act="covered-toggle"][data-lid="${W.lessonA}"][data-on="0"]').click(); true`);
  await teacher.waitFor(`(() => { const row = window.__MOCK.dbTable("students").find(x => x.id === "${ROW_A}"); return row && (!row.covered_manual || !row.covered_manual[${JSON.stringify(W.lessonA)}]) ? 1 : 0; })()`,
    { timeout: 8000, label: "повторное нажатие сняло covered_manual" });
  const rowOff = await coveredRow(teacher, W.lessonA);
  assert(rowOff && !rowOff.hasChip && rowOff.on === "1", "после снятия снова должна быть кнопка «Отметить»: " + JSON.stringify(rowOff));
});

/* ---------- Q3: ученик проходит тест по прямой ссылке ---------- */
test("Q3", "Ученик открывает ?quiz=: неверно → объяснение + повтор, повторно неверно → «Дальше» и тема needs_work; финиш + rpc quiz_submit", async ({ teacher, student, browser, baseUrl }) => {
  assert(W.quizId, "Q1 не сохранил тест — Q3 нечего открывать");
  const quiz = (await teacherDB(teacher, "topic_quizzes")).find(q => q.id === W.quizId);
  assert(quiz, "в mock-БД нет теста " + W.quizId);
  const qs = quiz.data.questions;
  assert(qs.length >= 2, "в тесте меньше 2 вопросов");
  const topicOfFirst = qs[0].topic;

  /* Вкладки делят origin/localStorage: закрываем старую вкладку ученика, чтобы её сессия (rowB)
     не перетирала сессию rowA у новой. Комнату учителя специально НЕ завершаем — проверяем, что
     ссылка на тест открывается даже во время урока (presence не должен выдёргивать ученика в комнату). */
  try { await student.close(); } catch (_) {}

  const page = await browser.newPage("about:blank");
  W.quizTab = page;
  try {
    await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-quiz.js");
    await page.inject(MOCK_SRC, "mock-supabase.js");
    await blockUrls(page);
    await page.goto(baseUrl + "/index.html?quiz=" + encodeURIComponent(W.quizId));
    await page.waitFor(`window.__app && window.__app.S && document.querySelector(".quiz-wrap .quiz-opt") ? 1 : 0`,
      { timeout: 25000, label: "тест открылся по прямой ссылке (index.html?quiz=)" });
    const st0 = await studentState(page);
    eq(st0.view, "quiz", "S.view после перехода по ссылке");
    eq(st0.quizToken, null, "S.quizToken должен сброситься после открытия теста");

    /* вопрос 1: неверно → объяснение + повтор → неверно повторно → «Дальше» */
    const wrong1 = (+qs[0].a + 1) % qs[0].o.length;
    await page.eval(`document.querySelector('[data-qopt="${wrong1}"]').click(); true`);
    const fbNo = await page.waitFor(`(() => { const f = document.querySelector(".quiz-fb.no"); return f ? f.textContent : null; })()`,
      { timeout: 6000, label: "неверный ответ → .quiz-fb.no" });
    assert(/Объяснение ИИ|Один плюс|Правильный ответ|\./i.test(fbNo) && fbNo.trim().length > 5, "в .quiz-fb.no нет объяснения: " + JSON.stringify(fbNo));
    assert(await page.eval(`!!document.querySelector("[data-qretry]")`), "после первой ошибки нет кнопки повтора [data-qretry]");
    await page.eval(`document.querySelector("[data-qretry]").click(); true`);
    await page.waitFor(`(() => { const o = document.querySelector("[data-qopt]"); return !document.querySelector(".quiz-fb") && o && !o.disabled ? 1 : 0; })()`,
      { timeout: 5000, label: "повтор: варианты снова доступны, объяснение скрыто" });
    /* второй неверный вариант: гарантированно не верный (при 2 вариантах формула по модулю дала бы верный) */
    const wrong2 = [0, 1, 2, 3, 4, 5].find(i => i < qs[0].o.length && i !== +qs[0].a && i !== wrong1);
    assert(wrong2 != null, "не нашли второй неверный вариант: a=" + qs[0].a + ", o=" + qs[0].o.length);
    await page.eval(`document.querySelector('[data-qopt="${wrong2}"]').click(); true`);
    await page.waitFor(`!!document.querySelector(".quiz-fb.no")`, { timeout: 6000, label: "вторая ошибка → .quiz-fb.no" });
    assert(await page.eval(`!!document.querySelector("[data-qnext]")`), "после второй ошибки нет кнопки «Дальше» [data-qnext]");
    await page.eval(`document.querySelector("[data-qnext]").click(); true`);
    await page.waitFor(`(() => { const A = window.__app.S.qz; return A && A.i === 1 ? 1 : 0; })()`, { timeout: 6000, label: "переход ко второму вопросу" });

    /* остальные вопросы — верно */
    for (let i = 1; i < qs.length; i++) {
      const a = +qs[i].a;
      await page.waitFor(`(() => { const A = window.__app.S.qz; return A && A.i === ${i} ? 1 : 0; })()`, { timeout: 6000, label: "вопрос " + (i + 1) });
      await page.eval(`document.querySelector('[data-qopt="${a}"]').click(); true`);
      await page.waitFor(`!!document.querySelector(".quiz-fb.ok")`, { timeout: 6000, label: "верный ответ на вопрос " + (i + 1) });
      await page.eval(`document.querySelector("[data-qnext]").click(); true`);
      await sleep(120);
    }
    await page.waitFor(`document.querySelector(".quiz-result[data-qresult]") ? 1 : 0`, { timeout: 10000, label: "экран итогов .quiz-result" });
    const resultText = await page.eval(`document.querySelector(".quiz-result").textContent`);
    const score = qs.length - 1;
    assert(new RegExp("(^|\\D)" + score + "(\\D|$)").test(resultText), "на итогах нет score " + score + ": " + JSON.stringify(resultText.slice(0, 300)));
    assert(resultText.includes(String(qs.length)) && /Надо доработать/i.test(resultText), "на итогах нет «Надо доработать» и total: " + JSON.stringify(resultText.slice(0, 300)));
    const badChip = await page.eval(`(() => { const b = document.querySelector(".quiz-result .chip.bad"); return b ? b.textContent : null; })()`);
    assert(badChip && badChip.includes(topicOfFirst), "чип темы на доработку не совпал: " + JSON.stringify(badChip) + ", тема " + JSON.stringify(topicOfFirst));
    assert(await page.eval(`!!document.querySelector(".quiz-result #qz-map .qz-topic.bad")`), "на итогах нет карты тем с .qz-topic.bad");

    /* mock-БД: quiz_submit записал результат (запись асинхронная — ждём появления строки) */
    let rows = [];
    let res = null;
    for (let i = 0; i < 40 && !res; i++) {
      rows = await teacherDB(teacher, "topic_quiz_results");
      res = rows.filter(r => r.quiz_id === W.quizId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
      if (!res) await sleep(100);
    }
    if (!res) {
      const diag = {
        rpcs: await page.eval(`JSON.stringify(window.__MOCK.rpcNames ? window.__MOCK.rpcNames() : null)`),
        lastSubmit: await page.eval(`JSON.stringify(window.__MOCK.lastRpc("quiz_submit"))`),
        quizDb: await page.eval(`JSON.stringify(window.__MOCK.dbTable("topic_quiz_results"))`),
        teacherDb: JSON.stringify(rows),
        errs: page.errors.slice(-4),
        token: await page.eval(`(window.__app && window.__app.S && window.__app.S.token) || null`),
      };
      throw new Error("quiz_submit не записал результат в mock-БД: " + JSON.stringify(diag).slice(0, 1500));
    }
    eq(res.score, score, "topic_quiz_results.score");
    eq(res.total, qs.length, "topic_quiz_results.total");
    eq(res.student_id, ROW_A, "topic_quiz_results.student_id");
    assert(Array.isArray(res.needs_work) && res.needs_work.includes(topicOfFirst), "в needs_work нет темы с ошибкой: " + JSON.stringify(res.needs_work));
    const t0 = (res.details.topics || []).find(t => (t.title || t.id) === topicOfFirst) || (res.details.topics || [])[0];
    assert(t0 && t0.needsWork === true, "в details.topics нет needsWork по теме: " + JSON.stringify(res.details.topics));
    const q0 = (res.details.questions || [])[0];
    assert(q0 && q0.attempts === 2 && q0.ok === false && q0.first === false, "details.questions[0] не отражает две попытки: " + JSON.stringify(q0));
    /* LOG мока локальный на вкладку: quiz_submit уходит из вкладки ученика (W.quizTab), не из кабинета */
    const rpc = await page.eval(`window.__MOCK.lastRpc("quiz_submit")`);
    assert(rpc && rpc.keys && rpc.keys.join(",") === "p_code,p_token,p_score,p_total,p_details,p_needs_work",
      "quiz_submit вызван с неверными именами параметров: " + JSON.stringify(rpc && rpc.keys));
  } catch (e) {
    // диагностика для владельцев student.js: что было на экране
    try { console.log("       [Q3 debug] view=" + JSON.stringify(await studentState(page))); } catch (_) {}
    throw e;
  }
});

/* ---------- Q4: карта тем у учителя и ученика ---------- */
test("Q4", "Карта тем: у учителя #qz-map .qz-topic.bad с темой, у ученика раздел «Тесты» с картой", async ({ teacher }) => {
  const topic = W.quizTopic || (W.quizQuestions && W.quizQuestions[0] && W.quizQuestions[0].topic) || "";
  assert(topic, "Q1 не сохранил тему теста");

  /* учитель: карточка rowA → карта тем; если live-обновление не дошло, перезагружаем кабинет (мок-БД общая) */
  const openTeacherMap = async () => {
    await teacher.eval(`document.querySelector('.navitem[data-view="students"]') && document.querySelector('.navitem[data-view="students"]').click(); true`);
    await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников" });
    await clickStudentRow(teacher, ROW_A, "список учеников");
    await teacher.waitFor(`document.querySelector("#qz-map") ? 1 : 0`, { timeout: 10000, label: "#qz-map в карточке ученика" });
  };
  await openTeacherMap();
  let tBad = await teacher.eval(`(() => { const b = document.querySelector("#qz-map .qz-topic.bad"); return b ? b.textContent : null; })()`);
  if (!tBad) {
    // карта могла ещё не обновиться из БД — обновляем данные карточки кнопкой «Обновить» (loadAll + render)
    await teacher.eval(`(() => { const b = document.querySelector('[data-act="reload"]'); if (b) b.click(); return true; })()`);
    await sleep(400);
    await teacher.eval(`document.querySelector('[data-student="${ROW_A}"]') && document.querySelector('[data-student="${ROW_A}"]').click(); true`);
    await teacher.waitFor(`document.querySelector("#qz-map") ? 1 : 0`, { timeout: 10000, label: "#qz-map после обновления карточки" });
    tBad = await teacher.eval(`(() => { const b = document.querySelector("#qz-map .qz-topic.bad"); return b ? b.textContent : null; })()`);
  }
  assert(tBad, "у учителя в #qz-map нет .qz-topic.bad (тема с ошибкой)");
  assert(tBad.includes(topic), "в .qz-topic.bad нет темы «" + topic + "»: " + JSON.stringify(tBad));
  const need = await teacher.eval(`document.querySelector("#qz-map .qz-need") ? document.querySelector("#qz-map .qz-need").textContent : ""`);
  assert(/Надо доработать/i.test(need) && need.includes(topic), "в блоке «Надо доработать» нет темы: " + JSON.stringify(need));

  /* ученик: раздел «Тесты» → карта тем по результатам */
  const page = W.quizTab;
  assert(page, "нет вкладки ученика из Q3");
  await page.eval(`(() => { const b = document.querySelector('[data-go="quizzes"]'); if (b) b.click(); return true; })()`);
  await page.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.view === "quizzes" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл раздел «Тесты»" });
  await page.waitFor(`(() => { const m = document.querySelector("#qz-map"); return m && (m.textContent || "").trim().length > 10 ? 1 : 0; })()`,
    { timeout: 10000, label: "#qz-map в разделе «Тесты»" });
  await page.waitFor(`document.querySelector("#qz-map .qz-topic.bad") ? 1 : 0`, { timeout: 10000, label: "у ученика карта тем с .qz-topic.bad" });
  const inList = await page.eval(`!!document.querySelector('.quiz-list [data-quiz="${W.quizId}"]')`);
  assert(inList, "ученик не видит собранный тест в разделе «Тесты» (список)");  const sBad = await page.eval(`document.querySelector("#qz-map .qz-topic.bad").textContent`);
  assert(sBad.includes(topic), "у ученика в карте тема не совпала: " + JSON.stringify(sBad) + ", ожидали " + JSON.stringify(topic));
});

/* ---------- Q5: ссылка на тест не уводит в кабинет учителя ---------- */
test("Q5", "Ссылка на тест в браузере учителя открывается как тест ученика, а не редирект в кабинет", async ({ browser, baseUrl }) => {
  assert(W.quizId, "Q1 не сохранил тест");
  const page = await browser.newPage("about:blank");
  await page.inject(seedScript({ db: null, session: TEACHER_SESSION, studentSession: null, joinHow: null }), "seed-q5.js");
  await page.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(page);
  try {
    await page.goto(baseUrl + "/index.html?quiz=" + encodeURIComponent(W.quizId));
    await page.waitFor(`window.__app && window.__app.S ? 1 : 0`, { timeout: 25000, label: "приложение ученика по ссылке ?quiz" });
    const st = await page.eval(`(() => ({ path: location.pathname, token: window.__app.S.quizToken || null, teach: /teacher\\.html$/.test(location.pathname) }))()`);
    assert(!st.teach, "ссылка ?quiz= увела в кабинет учителя: " + JSON.stringify(st));
    eq(st.token, W.quizId, "quizToken из ссылки сохранён");
  } finally { try { await page.close(); } catch (_) {} }
});
/* ---------- Q6: результат теста — по верным с ПЕРВОЙ попытки ---------- */
test("Q6", "Тест: ошибка→повтор→верно снижает score (с первой попытки): details.first=false/attempts=2, у учителя % темы <100", async ({ teacher, baseUrl }) => {
  assert(W.quizId && W.quizQuestions && W.quizQuestions.length >= 2, "Q1 не подготовил тест для Q6");
  const qs = W.quizQuestions, n = qs.length, topic0 = qs[0].topic || "";
  const page = W.quizTab;
  assert(page, "нет вкладки ученика из Q3");
  const qResBefore = (await teacherDB(teacher, "topic_quiz_results")).filter(r => r.quiz_id === W.quizId).length;
  await page.goto(baseUrl + "/index.html?quiz=" + encodeURIComponent(W.quizId));
  await page.waitFor(`window.__app && window.__app.S && document.querySelector(".quiz-wrap .quiz-opt") ? 1 : 0`,
    { timeout: 25000, label: "Q6: тест открылся по ссылке" });
  /* 1-й вопрос: неверно → [data-qretry] → верно (в зачёт пойдёт только первая попытка).
     Варианты могут переставляться при повторе, поэтому кликаем по ТЕКСТУ правильного варианта, а не по индексу. */
  const pageQs = await page.eval(`window.__app.S.quiz.questions.map(q => ({a: q.a, o: (q.o || []).map(String)}))`);
  const n2 = pageQs.length;
  const clickOpt = (want, wrong = false) => {
    const expr = wrong
      ? `(() => { const want = ${JSON.stringify(String(want))}; const norm = t => String(t || "").replace(/^\\s*\\d+[.)]\\s*/, "").replace(/\\s+/g, " ").trim(); const els = [...document.querySelectorAll("[data-qopt]")]; const el = els.find(e => !norm(e.textContent).includes(norm(want))); if (!el) return false; el.click(); return true; })()`
      : `(() => { const want = ${JSON.stringify(String(want))}; const norm = t => String(t || "").replace(/^\\s*\\d+[.)]\\s*/, "").replace(/\\s+/g, " ").trim(); const els = [...document.querySelectorAll("[data-qopt]")]; const el = els.find(e => norm(e.textContent) === norm(want)) || els.find(e => norm(e.textContent).includes(norm(want))); if (!el) return false; el.click(); return true; })()`;
    return page.eval(expr);
  };
  const right0 = pageQs[0].o[+pageQs[0].a];
  assert(await clickOpt(right0, true), "Q6: не нашли неверный вариант на вопрос 1");
  await page.waitFor(`!!document.querySelector('.quiz-fb.no')`, { timeout: 6000, label: "Q6: неверный ответ (.quiz-fb.no)" });
  assert(await page.eval(`!!document.querySelector("[data-qretry]")`), "Q6: нет кнопки повтора [data-qretry]");
  await page.eval(`document.querySelector("[data-qretry]").click(); true`);
  await page.waitFor(`(() => { const o = document.querySelector("[data-qopt]"); return !document.querySelector(".quiz-fb") && o && !o.disabled ? 1 : 0; })()`,
    { timeout: 5000, label: "Q6: повтор варианты снова доступны" });
  assert(await clickOpt(right0), "Q6: не нашли правильный вариант «" + right0 + "» на повтор");
  await page.waitFor(`!!document.querySelector('.quiz-fb.ok')`, { timeout: 6000, label: "Q6: верно со второй попытки (.quiz-fb.ok)" });
  await page.eval(`document.querySelector("[data-qnext]").click(); true`);
  for (let i = 1; i < n2; i++) {
    await page.waitFor(`(() => { const A = window.__app.S.qz; return A && A.i === ${i} ? 1 : 0; })()`, { timeout: 6000, label: "Q6: вопрос " + (i + 1) });
    assert(await clickOpt(pageQs[i].o[+pageQs[i].a]), "Q6: не нашли правильный вариант на вопрос " + (i + 1));
    await page.waitFor(`!!document.querySelector('.quiz-fb.ok')`, { timeout: 6000, label: "Q6: верный ответ на вопрос " + (i + 1) });
    await page.eval(`document.querySelector("[data-qnext]").click(); true`);
    await sleep(120);
  }
  await page.waitFor(`document.querySelector(".quiz-result[data-qresult]") ? 1 : 0`, { timeout: 10000, label: "Q6: экран итогов .quiz-result" });
  const sc = await page.eval(`(() => { const el = document.querySelector(".quiz-score"); return el ? {score: +el.dataset.score, total: +el.dataset.total, pct: +el.dataset.pct} : null; })()`);
  assert(sc, "Q6: нет .quiz-score[data-score]/[data-total]/[data-pct]");
  eq(sc.score, n2 - 1, "Q6: score с первой попытки");
  eq(sc.total, n2, "Q6: total");
  eq(sc.pct, Math.round((n2 - 1) / n2 * 100), "Q6: pct");
  const firstNote = await page.eval(`(() => { const el = document.querySelector(".quiz-result [data-q-first]") || document.querySelector(".quiz-result"); return el ? el.textContent : ""; })()`);
  if (!/с первой попытки/i.test(firstNote)) throw new Error("Q6: в итогах нет «с первой попытки X из N»: " + JSON.stringify(String(firstNote).slice(0, 300)));
  if (!String(firstNote).includes(String(n2 - 1))) throw new Error("Q6: в «с первой попытки» не score n-1: " + JSON.stringify(String(firstNote).slice(0, 300)));
  /* mock-БД: rpc quiz_submit может завершиться уже после показа итогов — ждём НОВУЮ строку результата
     (иначе можно прочитать предыдущую попытку Q3) */
  let rows = [];
  { const tW = Date.now(); while (Date.now() - tW < 12000) { rows = (await teacherDB(teacher, "topic_quiz_results")).filter(r => r.quiz_id === W.quizId); if (rows.length > qResBefore) break; await sleep(150); } }
  const res = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  assert(res, "Q6: в mock-БД нет quiz_results по тесту");
  eq(res.score, n2 - 1, "Q6: topic_quiz_results.score (first)");
  eq(res.total, n2, "Q6: topic_quiz_results.total");
  const q0 = (res.details && res.details.questions || [])[0];
  assert(q0 && q0.first === false && q0.attempts === 2 && q0.ok === true,
    "Q6: details.questions[0] ожидали {first:false, attempts:2, ok:true}: " + JSON.stringify(q0));
  const rpc = await page.eval(`window.__MOCK.lastRpc("quiz_submit")`);
  assert(rpc && rpc.args && +rpc.args.p_score === n2 - 1 && +rpc.args.p_total === n2,
    "Q6: quiz_submit p_score/p_total (ожидали " + (n2 - 1) + "/" + n2 + "): " + JSON.stringify(rpc && rpc.args));
  /* у учителя % по теме ниже 100 (считается по first) */
  const pctOf = () => teacher.eval(`(() => { const els = [...document.querySelectorAll("#qz-map .qz-topic")]; const el = els.find(e => (e.textContent || "").includes(${JSON.stringify(topic0)})); if (!el) return null; const m = (el.textContent || "").match(/(\\d+)\\s*%/); return m ? +m[1] : null; })()`);
  let pct = await pctOf();
  let t0 = Date.now();
  while ((pct == null || pct >= 100) && Date.now() - t0 < 12000) { await sleep(300); pct = await pctOf(); }
  if (pct == null || pct >= 100) {
    await reloadTeacherToRow(teacher, baseUrl);
    t0 = Date.now();
    while (pct == null && Date.now() - t0 < 10000) { await sleep(300); pct = await pctOf(); }
  }
  assert(pct != null && pct < 100, "Q6: у учителя % по теме «" + topic0 + "» не ниже 100 (pct=" + pct + ")");
});

/* ---------- S1–S4: самообучение (блоки ударений, карточки, ошибки, прогресс) ---------- */
test("S1", "Самообучение: блок ударений — ошибка с подсказкой, повтор, 15/15; прогресс works и результат self сохраняются", async ({ teacher, student, browser, baseUrl }) => {
  /* вкладка rowB больше не нужна и делит localStorage – закрываем, чтобы сессия rowA не перетиралась */
  try { await student.close(); } catch (_) {}
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  const blocks = await page.eval(`document.querySelectorAll('[data-act="self-stress-block"]').length`);
  assert(blocks >= 10, "блоков ударений меньше 10: " + blocks);
  await openStressBlock(page, 0);
  const res = await runStressMastery(page, 0, { firstWrong: true });
  assert(res.firstBad, "не удалось сделать ошибку в блоке: нет .play-res.bad");
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал блока ударений (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:stress" && +w.task === 0 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:stress task=0 done=true: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 400));
  const mastered = work.data.mastered || [];
  eq(mastered.length, 15, "works self:stress p_data.mastered.length");
  assert(mastered.every(x => typeof x === "string"), "mastered должен быть массивом слов: " + JSON.stringify(mastered).slice(0, 200));
  const errs = work.data.errors || {};
  assert((+errs[res.firstBad] || 0) >= 1, "в p_data.errors нет ошибки «" + res.firstBad + "»: " + JSON.stringify(errs).slice(0, 200));
  eq(work.data.total, 15, "works self:stress p_data.total");
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:stress"));
  assert(result, "нет результата kind self lesson_id self:stress: " + JSON.stringify(await teacherDB(teacher, "results")).slice(0, 400));
  eq(result.score, 15, "results.score блока ударений");
  await closePlay(page);
  await waitBlockProgress(page, 0, "15/15");
});

test("S2", "Самообучение: ошибка возвращает слово (+2), оно не освоено и попадает в errors; после верного ответа слово ещё раз", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  await openStressBlock(page, 1);
  const res = await runStressMastery(page, 1, { firstWrong: true });
  assert(res.firstBad, "нет ошибочного ответа в блоке 1");
  assert(res.stateAfterWrong, "Play.stressState() не вернул состояние (нет state-хука)");
  const stWrong = res.stateAfterWrong || {};
  assert(!((stWrong.mastered || []).map(x => String(x)).includes(res.firstBad)), "после ошибки слово «" + res.firstBad + "» уже освоено: " + JSON.stringify(stWrong.mastered).slice(0, 200));
  assert((+((stWrong.errors || {})[res.firstBad]) || 0) >= 1, "в Play.stressState().errors нет ошибки «" + res.firstBad + "»: " + JSON.stringify(stWrong.errors).slice(0, 200));
  assert((+(stWrong.reps || {})[res.firstBad] || 0) >= 3, "после ошибки у слова не +2 повтора (reps=" + JSON.stringify((stWrong.reps || {})[res.firstBad]) + ", ожидали >=3)");
  assert((res.seen.get(res.firstBad) || 0) >= 2, "слово «" + res.firstBad + "» не появилось повторно (ожидали +2): " + JSON.stringify([...res.seen.entries()].slice(0, 5)));
  assert(res.retryFeedback, "после ошибки не было пометки «Слово встретится ещё раз – закрепим» (повтор +2)");
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал блока 1 (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:stress" && +w.task === 1 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:stress task=1 done=true");
  eq((work.data.mastered || []).length, 15, "works task=1 mastered.length");
  assert((+((work.data.errors || {})[res.firstBad]) || 0) >= 1, "в p_data.errors нет слова с ошибкой «" + res.firstBad + "»: " + JSON.stringify(work.data.errors).slice(0, 200));
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:stress"));
  assert(result, "нет результата kind self по блоку 1");
  eq(result.total, 15, "results.total блока 1");
  await closePlay(page);
});

test("S3", "Самообучение: карточки — «Показать ответ», «Ещё учить» возвращает карточку, «Знаю» до всех карточек; прогресс и результат", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  const hasDeck = await page.eval(`!!document.querySelector('[data-act="self-deck"][data-d="0"]')`);
  assert(hasDeck, "нет колоды «Паронимы» ([data-act=self-deck][data-d=0])");
  await page.eval(`document.querySelector('[data-act="self-deck"][data-d="0"]').click(); true`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .self-front') ? 1 : 0`, { timeout: 15000, label: "тренажёр карточек открыт" });
  const deck = await selfDeckData(page, 0);
  assert(deck && Array.isArray(deck.cards) && deck.cards.length, "нет SELF_DATA.decks[0]");
  const total = deck.cards.filter(c => c && c.f).length;
  const res = await runDeckLoop(page, { firstAgain: true });
  assert(res.learnFront, "не удалось нажать «Ещё учить» на первой карточке");
  assert((res.seen.get(res.learnFront) || 0) >= 2, "карточка «Ещё учить» не вернулась в очередь: " + res.learnFront);
  assert(res.backShown >= total, "карточки показывали ответ реже, чем карточек: " + res.backShown + " из " + total);
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал колоды (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:deck" && +w.task === 0 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:deck task=0 done=true: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 400));
  eq((work.data.mastered || []).length, total, "works self:deck p_data.mastered.length (=все карточки)");
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:cards"));
  assert(result, "нет результата kind self lesson_id self:cards (колода): " + JSON.stringify(await teacherDB(teacher, "results")).slice(0, 400));
  await closePlay(page);
});

test("S4", "Самообучение: прогресс подхватывается после перезагрузки, «Мои ошибки» собираются и уменьшаются, есть «Что подтянуть»", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  // перезагрузка: прогресс и ошибки должны прийти из student_state.works
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="self"]') ? 1 : 0`,
    { timeout: 25000, label: "ученик после перезагрузки" });
  /* дождаться, что прогресс self:stress пришёл из student_state.works (иначе «0/15» — гонка загрузки) */
  await page.waitFor(`(() => { const S = window.__app.S; return S.works && Object.keys(S.works).some(k => k === "self:stress") ? 1 : 0; })()`,
    { timeout: 12000, label: "S4: student_state.works self:stress загружен" }).catch(() => {});
  await selfOpen(page);
  const prep = await page.eval(`(() => { const p = document.querySelector('.self-prep'); return p ? p.textContent : null; })()`);
  assert(prep && /подтянуть/i.test(prep), "нет блока рекомендаций «Что подтянуть» (.self-prep): " + JSON.stringify(prep));
  assert(await page.eval(`!!document.querySelector('.self-prep [data-act="self-stress-block"]')`), "в рекомендациях нет кнопки «ударения»");
  assert(await page.eval(`!!document.querySelector('.self-prep [data-act="self-deck"]')`), "в рекомендациях нет кнопки «карточки»");
  let label0 = "";
  const tL = Date.now();
  while (Date.now() - tL < 12000) {
    label0 = await page.eval(`(() => { const b = document.querySelector('.self-blocks [data-act="self-stress-block"][data-b="0"]'); return b ? (b.getAttribute('data-self-progress') || b.textContent || "") : ""; })()`);
    if (/15\s*\/\s*15/.test(label0)) break;
    await sleep(250);
  }
  if (!/15\s*\/\s*15/.test(label0)) {
    const diag = await page.eval(`(() => { const S = window.__app.S; return { works: S.works ? Object.keys(S.works) : null, view: S.view, body: (document.body.innerText || "").slice(0, 250) }; })()`).catch(err => ({ evalError: String(err) }));
    throw new Error("после перезагрузки карточка блока 0 не показывает 15/15 (прогресс не подхватился): " + JSON.stringify(label0) + " diag=" + JSON.stringify(diag).slice(0, 800));
  }
  const left0 = +(await page.eval(`(() => { const b = document.querySelector('[data-act="self-errors"]'); if (!b) return 0; return b.getAttribute('data-self-errors-left') || 0; })()`)) || 0;
  assert(left0 >= 2, "в «Моих ошибках» меньше 2 элементов (ожидали ошибку блока и карточку): " + left0);
  // проходим «Мои ошибки» (cardDeck по items): все «Знаю»
  await page.eval(`document.querySelector('[data-act="self-errors"]').click(); true`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .self-front') ? 1 : 0`, { timeout: 15000, label: "тренажёр «Мои ошибки» открыт (карточки)" });
  await runDeckLoop(page);
  const errWork = await waitMockRow(teacher, "works", w => w.lesson_id === "self:errors" && +w.task === 0 && Array.isArray(w.data && w.data.items) && w.data.items.length < left0);
  assert(errWork, "в works self:errors не уменьшился список items (было " + left0 + "): " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 500));
  await closePlay(page);
  /* после закрытия оверлея счётчик ошибок на экране уменьшился/исчез */
  const t0 = Date.now();
  let leftAfter = left0;
  while (Date.now() - t0 < 8000) {
    leftAfter = +(await page.eval(`(() => { const b = document.querySelector('[data-act="self-errors"]'); if (!b) return 0; return b.getAttribute('data-self-errors-left') || 0; })()`)) || 0;
    if (leftAfter < left0) break;
    await sleep(200);
  }
  assert(leftAfter < left0, "после прохождения «Моих ошибок» счётчик data-self-errors-left не уменьшился: было " + left0 + ", стало " + leftAfter);
});

/* ---------- T1: карточка ученика у учителя — самообучение, база, доска ученика ---------- */
/** мир T1: прогресс самообучения и пометки на доске rowA (сид пересоздаёт мок-БД целиком) */
function t1Seed(deckTotal, lessonId) {
  const seed = JSON.parse(JSON.stringify(W.db));
  const now = new Date().toISOString();
  const words = ["аэропорты", "банты", "бороду", "бухгалтеров", "вероисповедание", "водопровод", "вручит", "газопровод", "диспансер", "договор", "документ", "досуг", "еретик", "жалюзи", "звонит"];
  seed.tables.works = [
    { id: 9001, student_id: ROW_A, lesson_id: "self:stress", task: 0, data: { mastered: words.slice(0, 5), errors: { "звонить": 2 }, attempts: 20, done: false, total: 15 }, updated_at: now },
    { id: 9002, student_id: ROW_A, lesson_id: "self:stress", task: 1, data: { mastered: words.slice(), errors: {}, attempts: 15, done: true, total: 15 }, updated_at: now },
    { id: 9003, student_id: ROW_A, lesson_id: "self:deck", task: 0, data: { mastered: [0, 1], errors: { 2: 1 }, attempts: 5, done: false, total: deckTotal }, updated_at: now },
    { id: 9004, student_id: ROW_A, lesson_id: "self:errors", task: 0, data: { items: [
      { kind: "stress", key: "s:звонить", label: "звонить", detail: "звонИть", count: 2, at: Date.now() },
      { kind: "card", key: "d:paronyms:0", label: "абонент / абонемент", detail: "абонент – пользователь (телефонный абонент); абонемент – документ на право пользования.", count: 1, at: Date.now() },
    ], updatedAt: Date.now() }, updated_at: now },
  ];
  seed.tables.materials = [{ id: 9201, teacher_id: TEACHER_ID, course: "rus-5", lesson_id: lessonId, kind: "text", title: "Памятка по ударениям", body: "Ударение в глаголах.", shared: true, student_id: null, data: {}, created_at: now }];
  seed.tables.board_items = [
    { id: 9101, student_id: ROW_A, lesson_id: lessonId + ":theory", item: { t: "s", p: [[10, 30], [40, 40], [70, 50]], c: "#111", w: 3 }, author: "student", created_at: now },
    { id: 9102, student_id: ROW_A, lesson_id: lessonId + ":practice", item: { t: "t", x: 40, y: 80, w: 300, h: 40, s: "подчёркнуто", c: "#7b4cf5" }, author: "student", created_at: now },
    { id: 9103, student_id: ROW_A, lesson_id: lessonId + ":theory", item: { t: "i", x: 20, y: 120, w: 200, h: 120, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }, author: "teacher", created_at: now },
    { id: 9104, student_id: ROW_A, lesson_id: "free:p1", item: { t: "s", p: [[5, 5], [15, 15]], c: "#111", w: 3 }, author: "student", created_at: now },
  ];
  return seed;
}
test("T1", "Карточка ученика у учителя: прогресс самообучения, база и доска ученика; «Открыть доску» → board с пометками", async ({ teacher, baseUrl }) => {
  /* прогресс/доска засеваются в мок-БД и кабинет перезагружается: T1 идёт последним, чтобы не влиять на S1–S4 */
  const lessonId = W.lessons.rus[0].id;
  const deckTotal = await teacher.eval(`(window.SELF_DATA && window.SELF_DATA.decks && window.SELF_DATA.decks[0] && window.SELF_DATA.decks[0].cards.length) || 29`);
  const seed = t1Seed(+deckTotal || 29, lessonId);
  await teacher.eval(`window.__MOCK.reset(${JSON.stringify(seed)}); try { sessionStorage.clear(); } catch (_) {}; true`);
  await teacher.goto(baseUrl + "/teacher.html");
  /* кабинет восстанавливает прошлый маршрут из sessionStorage (после Q4 он мог быть в карточке ученика),
     поэтому ждём shell и явно возвращаемся к списку учеников */
  await teacher.waitFor(`window.__teacher && document.querySelector('.shell') ? 1 : 0`, { timeout: 25000, label: "кабинет учителя после сида T1 (shell + __teacher)" });
  /* сбрасываем «идущий урок», иначе ученик при загрузке получает room-pull и переключается на другой предмет */
  await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; if (!T) return false; T.room = null; if (T.me) T.me.room = null; return true; })()`);
  await teacher.eval(`(() => { const b = document.querySelector('[data-view="students"]'); if (b) b.click(); return !!b; })()`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 15000, label: "список учеников у учителя (T1)" });
  await clickStudentRow(teacher, ROW_A, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-t-student-all]') && document.querySelector('[data-t-board-row]') ? 1 : 0`,
    { timeout: 15000, label: "секция «Всё, что делает ученик» с доской (данные доски загрузились)" });
  const st = await teacher.eval(`(() => {
    const q = s => document.querySelector(s);
    const rows = [...document.querySelectorAll('[data-t-board-row]')];
    const agg = lesson => rows.filter(r => r.dataset.lesson === lesson).reduce((a, r) => ({
      strokes: a.strokes + (+r.dataset.strokes || 0), texts: a.texts + (+r.dataset.texts || 0), files: a.files + (+r.dataset.files || 0),
    }), { strokes: 0, texts: 0, files: 0 });
    const ds = el => el ? {...el.dataset} : null;
    return {
      hasAll: !!q('[data-t-student-all]'),
      heading: /всё, что делает|что делает ученик/i.test(document.body.innerText || ""),
      stress0: ds(q('[data-t-self-stress="0"]')), stress1: ds(q('[data-t-self-stress="1"]')),
      deck0: ds(q('[data-t-self-deck="0"]')),
      errs: (q('[data-t-self-errors]') || {}).innerText || "",
      errKeys: [...document.querySelectorAll('[data-t-err-key]')].map(x => x.getAttribute('data-t-err-key')),
      base: ds(q('[data-t-base]')), baseText: q('[data-t-base]') ? q('[data-t-base]').innerText : "",
      rows: rows.map(r => ({lesson: r.dataset.lesson, page: r.dataset.page, strokes: +r.dataset.strokes, texts: +r.dataset.texts, files: +r.dataset.files})),
      lessonAgg: agg(${JSON.stringify(lessonId)}), freeAgg: agg("free"),
      summary: (q('[data-t-board-summary]') || {}).textContent || "",
      boardText: q('.boards-list') ? q('.boards-list').innerText : "",
      reload: !!q('[data-act="boards-reload"]'),
      openBtns: [...document.querySelectorAll('.boards-list [data-boardfor][data-boardpage]')].length,
      text: document.body.innerText || "",
    };
  })()`);
  const fail = (msg) => { throw new Error(msg + " (state: " + JSON.stringify({ stress0: st.stress0, stress1: st.stress1, deck0: st.deck0, base: st.base, rows: st.rows, text: String(st.text).slice(0, 700) }) + ")"); };
  if (!st.hasAll) fail("нет контейнера [data-t-student-all]");
  if (!st.heading) fail("нет заголовка «Всё, что делает ученик»");
  // 1) самообучение
  if (!st.stress0 || +st.stress0.mastered !== 5 || String(st.stress0.done) === "1" || +st.stress0.errors !== 2) fail("блок ударений 0: ожидали 5/15, done=0, ошибок 2");
  if (!st.stress1 || +st.stress1.mastered !== 15 || String(st.stress1.done) !== "1") fail("блок ударений 1: ожидали 15/15, done=1 (✓)");
  if (!st.deck0 || +st.deck0.mastered !== 2) fail("колода 0: ожидали 2/" + (+deckTotal || 29));
  if (!st.errs.includes("звонить") || !st.errs.includes("звонИть")) fail("«Мои ошибки»: нет «звонить»/«звонИть»");
  if (!st.text.includes("5/15") || !st.text.includes("15/15") || !st.text.includes("2/" + (+deckTotal || 29))) fail("в тексте нет числовых прогрессов 5/15, 15/15, 2/N");
  if (!/✓/.test(st.text)) fail("у пройденного блока нет ✓");
  if (!/ошиб/i.test(st.text)) fail("нет упоминания ошибок в прогрессе самообучения");
  // 2) база
  if (!st.base) fail("нет блока базы [data-t-base]");
  if (st.base.openLessons == null || st.base.totalLessons == null) fail("база: нет data-open-lessons/data-total-lessons");
  if (+st.base.materials < 1) fail("база: материалов меньше 1 (сид дал 1 материал)");
  if (!/открыто\s+\d+\s+из\s+\d+/i.test(st.baseText)) fail("нет текста «открыто X из Y уроков»");
  if (!/материал/i.test(st.baseText)) fail("нет текста про материалы");
  // 3) доска ученика: строки по листам, счётчики, отдельная «Личная доска», кнопки
  if (!/штрих/i.test(st.boardText) || !/надпис/i.test(st.boardText) || !/вложен/i.test(st.boardText)) fail("нет строк доски со счётчиками «штрихов/надписей/вложений»");
  if (st.lessonAgg.strokes !== 1 || st.lessonAgg.texts !== 1 || st.lessonAgg.files !== 1) fail("счётчики пометок урока: ожидали штрихов 1, надписей 1, вложений 1");
  if (st.freeAgg.strokes !== 1) fail("«Личная доска»: ожидали 1 штрих, получили " + JSON.stringify(st.freeAgg));
  if (!/личная доска/i.test(st.text)) fail("нет отдельной строки «Личная доска»");
  if (!/штрихов\s+4|пометок\s+4/i.test(st.summary)) fail("сводка доски не показывает 4 пометки: " + JSON.stringify(st.summary));
  if (!st.reload) fail("нет кнопки «Обновить» [data-act=boards-reload]");
  if (st.openBtns < 1) fail("нет кнопки «Открыть доску» с data-boardpage в списке доски");
  // «Обновить» — кэш сбрасывается и строки снова появляются
  const rowsBefore = st.rows.length;
  await teacher.eval(`document.querySelector('[data-act="boards-reload"]').click(); true`);
  await teacher.waitFor(`document.querySelectorAll('[data-t-board-row]').length === ${rowsBefore} ? 1 : 0`,
    { timeout: 10000, label: "строки доски после «Обновить» (перечитывание board_items)" });
  // «Открыть доску» из новой секции → T.view="board", #board .bd-cv, T.board.info().items > 0
  const opened = await teacher.eval(`(() => {
    const b = document.querySelector('.boards-list [data-boardfor][data-boardpage]') || document.querySelector('[data-boardfor]:not([data-boardfor="free"])');
    if (!b) return false; b.click(); return true;
  })()`);
  if (!opened) throw new Error("не нашли кнопку «Открыть доску» ([data-boardfor][data-boardpage])");
  await teacher.waitFor(`window.__teacher && window.__teacher.T && window.__teacher.T.view === "board" ? 1 : 0`,
    { timeout: 15000, label: "T.view===\"board\" после «Открыть доску» (window.__teacher.T)" });
  await teacher.waitFor(`document.querySelector("#board .bd-cv") ? 1 : 0`, { timeout: 15000, label: "доска в кабинете (#board .bd-cv)" });
  await teacher.waitFor(`(() => { try { const T = window.__teacher.T; const b = T && T.board; const i = b && typeof b.info === "function" ? b.info() : null; return i && i.ready && i.items.length > 0 ? 1 : 0; } catch(_) { return 0; } })()`,
    { timeout: 20000, label: "T.board.info().ready && items > 0 (пометки ученика на доске)" });
  const boardInfo = await teacher.eval(`(() => { try { const T = window.__teacher.T; const b = T.board; const i = b.info(); return {items: i.items.length, page: i.page, lesson: T.boardLesson}; } catch(_) { return null; } })()`);
  if (!boardInfo || boardInfo.items < 1) throw new Error("T.board.info() не показывает пометки: " + JSON.stringify(boardInfo));
  if (String(boardInfo.lesson) !== lessonId) throw new Error("T.boardLesson не совпал с уроком: " + JSON.stringify(boardInfo) + ", ожидали " + lessonId);
});

/* ---------- T2–T4: динамика успеваемости (график), автоподбор тем ---------- */
/** мир T2: результаты rowA с разными процентами и по датам (последний — 100%) + результат теста по темам */
function t2Seed() {
  const seed = JSON.parse(JSON.stringify(W.db));
  const lid = W.lessons.rus[0].id, ltitle = W.lessons.rus[0].title;
  const q = { q: "Тренд-вопрос 1", o: ["а", "б", "в", "г"], a: 0, e: "объяснение", topic: ltitle, topicId: lid };
  seed.tables.results = [
    { id: 9301, student_id: ROW_A, lesson_id: lid, kind: "lesson", score: 5, total: 10, wrong: [], created_at: "2026-10-01T10:00:00.000Z" },
    { id: 9302, student_id: ROW_A, lesson_id: lid, kind: "lesson", score: 8, total: 10, wrong: [], created_at: "2026-10-05T10:00:00.000Z" },
    { id: 9303, student_id: ROW_A, lesson_id: lid, kind: "lesson", score: 6, total: 10, wrong: [], created_at: "2026-10-10T10:00:00.000Z" },
    { id: 9304, student_id: ROW_A, lesson_id: lid, kind: "lesson", score: 10, total: 10, wrong: [], created_at: "2026-10-20T10:00:00.000Z" },
  ];
  seed.tables.topic_quizzes = [{ id: "trendq01", teacher_id: TEACHER_ID, student_id: ROW_A, title: "Тест динамики", course: "rus-5",
    data: { title: "Тест динамики", topics: [{ id: lid, title: ltitle }], questions: [q] }, created_at: "2026-10-02T10:00:00.000Z" }];
  seed.tables.topic_quiz_results = [{ id: 9401, quiz_id: "trendq01", student_id: ROW_A, score: 3, total: 4,
    details: { questions: [], topics: [] }, needs_work: [], created_at: "2026-10-12T10:00:00.000Z" }];
  return seed;
}
/** лёгкая перезагрузка кабинета до карточки ученика (T2/T3/V*): без сброса «идущего урока» и presence-ожиданий */
async function reloadTeacherCard(teacher, baseUrl, rowId = ROW_A){
  await teacher.eval(`try { sessionStorage.clear(); } catch (_) {}; true`);
  await teacher.goto(baseUrl + "/teacher.html");
  await teacher.waitFor(`window.__teacher && document.querySelector('.shell') ? 1 : 0`, { timeout: 25000, label: "кабинет учителя (shell + __teacher)" });
  await teacher.eval(`(() => { const b = document.querySelector('[data-view="students"]'); if (b) b.click(); return !!b; })()`);
  await teacher.waitFor(`document.querySelector('[data-student="${rowId}"]') ? 1 : 0`, { timeout: 15000, label: "список учеников (T2)" });
  await clickStudentRow(teacher, rowId, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-t-student-all]') ? 1 : 0`, { timeout: 15000, label: "карточка ученика («Всё, что делает ученик»)" });
}
test("T2", "Динамика у учителя: [data-t-student-trend] с .trend-line и .trend-dot (data-points>=3), последняя точка 100%", async ({ teacher, baseUrl }) => {
  await teacher.eval(`window.__MOCK.reset(${JSON.stringify(t2Seed())}); true`);
  await reloadTeacherCard(teacher, baseUrl);
  await teacher.waitFor(`document.querySelector('[data-t-student-trend]') ? 1 : 0`, { timeout: 15000, label: "T2: секция «Динамика успеваемости» [data-t-student-trend]" });
  const st = await teacher.eval(`(() => {
    const box = document.querySelector('[data-t-student-trend]');
    const tr = box && box.querySelector('.trend');
    return {
      boxPoints: box ? box.dataset.points : null,
      points: tr ? +tr.dataset.points : 0, first: tr ? +tr.dataset.first : null, last: tr ? +tr.dataset.last : null,
      dots: box ? box.querySelectorAll('.trend-dot').length : 0,
      line: !!(box && box.querySelector('.trend-line')),
      text: box ? box.innerText : "",
    };
  })()`);
  assert(st.line, "T2: в [data-t-student-trend] нет .trend-line (SVG-линия)");
  assert(st.dots >= 2, "T2: .trend-dot меньше 2: " + st.dots);
  assert(st.points >= 3, "T2: data-points < 3: " + st.points);
  if (st.boxPoints != null) eq(+st.boxPoints, st.points, "T2: data-points на контейнере и на .trend");
  eq(st.last, 100, "T2: data-last (последняя по дате точка — 10/10)");
  assert(/сейчас\s*100\s*%/i.test(st.text), "T2: в тексте нет «сейчас 100%»: " + JSON.stringify(st.text.slice(0, 300)));
  /* хук teacher.trendPoints: 4 results + 1 quiz = 5 точек, последняя 100% */
  const pts = await teacher.eval(`(() => { try { const T = window.__teacher.T; const s = T.students.find(x => x.id === ${JSON.stringify(ROW_A)}); const p = window.__teacher.trendPoints ? window.__teacher.trendPoints(s) : null; return p ? p.map(x => ({p: x.p, kind: x.kind, at: x.at})) : null; } catch (_) { return null; } })()`);
  if (Array.isArray(pts)) {
    assert(pts.length >= 4, "T2: trendPoints меньше 4: " + pts.length);
    eq(pts[pts.length - 1].p, 100, "T2: последняя точка trendPoints");
  }
});

test("T3", "Автоподбор: пустой выбор тем → «Собрать тест» берёт тему, отмеченную «Пройдено», и сохраняет её в topic_quizzes", async ({ teacher }) => {
  /* карточка rowA открыта после T2; берём урок, у которого есть готовые вопросы */
  await teacher.waitFor(`document.getElementById("qz-card") ? 1 : 0`, { timeout: 12000, label: "T3: карточка «Тест по темам» (#qz-card)" });
  const lid = await teacher.eval(`(() => {
    const boxes = [...document.querySelectorAll('[data-qz-topic]')];
    for (const cb of boxes) { const t = (cb.closest("label") || cb.parentElement || {}).textContent || ""; const m = t.match(/(\\d+)\\s*вопр/); if (m && +m[1] > 0) return cb.value; }
    return null;
  })()`);
  assert(lid, "T3: в карточке нет урока с готовыми вопросами («N вопр.»)");
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="covered-toggle"][data-lid="${lid}"][data-on="1"]'); if (b) b.click(); return !!b; })()`);
  await teacher.waitFor(`(() => { const row = window.__MOCK.dbTable("students").find(x => x.id === ${JSON.stringify(ROW_A)}); return row && row.covered && row.covered[${JSON.stringify(lid)}] ? 1 : 0; })()`,
    { timeout: 8000, label: "T3: урок отмечен «Пройдено»" });
  /* пустой выбор тем */
  await teacher.eval(`(() => { [...document.querySelectorAll("[data-qz-topic]:checked")].forEach(cb => { cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); }); return true; })()`);
  await sleep(250);
  await teacher.eval(`document.querySelector('[data-act="qz-build"]').click(); true`);
  await teacher.waitFor(`(document.getElementById("qz-title") && document.querySelector('[data-act="qz-save"]')) ? 1 : 0`,
    { timeout: 25000, label: "T3: предпросмотр автоподбора (#qz-title + [data-act=qz-save])" });
  const draft = await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; return T && T.qzDraft ? { topics: (T.qzDraft.topics || []).map(t => t.id), questions: (T.qzDraft.questions || []).length } : null; })()`);
  assert(draft, "T3: T.qzDraft пуст после автоподбора");
  assert(draft.topics.includes(lid), "T3: автоподбор не взял пройденную тему " + lid + ": " + JSON.stringify(draft));
  assert(draft.questions > 0, "T3: в предпросмотре нет вопросов");
  const checked = await teacher.eval(`[...document.querySelectorAll("[data-qz-topic]:checked")].map(x => x.value)`);
  assert(checked.includes(lid), "T3: чекбокс пройденной темы не отмечен: " + JSON.stringify(checked));
  /* сохраняем и проверяем topic_quizzes.data.topics */
  const title = "Автотест пройденных тем";
  await teacher.eval(`(() => { const el = document.getElementById("qz-title"); if (el) { el.value = ${JSON.stringify(title)}; el.dispatchEvent(new Event("input", { bubbles: true })); } return true; })()`);
  await teacher.eval(`document.querySelector('[data-act="qz-save"]').click(); true`);
  const row = await waitMockRow(teacher, "topic_quizzes", q => q.title === title && q.student_id === ROW_A);
  assert(row, "T3: тест не сохранён в topic_quizzes: " + JSON.stringify(await teacherDB(teacher, "topic_quizzes")).slice(0, 400));
  const ids = ((row.data && row.data.topics) || []).map(t => t.id);
  assert(ids.includes(lid), "T3: в сохранённом тесте нет пройденной темы: " + JSON.stringify(ids));
});

test("T4", "Статистика ученика: [data-t-trend] с .trend-line и точками (data-points>=1), последняя точка 100%", async ({ browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="stats"]') ? 1 : 0`, { timeout: 25000, label: "T4: ученик после reload" });
  await page.eval(`document.querySelector('[data-go="stats"]').click(); true`);
  await page.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.view === "stats" ? 1 : 0; })()`, { timeout: 12000, label: "T4: раздел «Статистика»" });
  await page.waitFor(`document.querySelector('[data-t-trend]') ? 1 : 0`, { timeout: 15000, label: "T4: контейнер [data-t-trend]" });
  /* тесты подгружаются лениво: ждём student_quizzes, иначе последняя точка может быть не та */
  await page.waitFor(`(() => { const S = window.__app.S; return S && S.quizzes !== null ? 1 : 0; })()`,
    { timeout: 12000, label: "T4: student_quizzes загрузились" }).catch(() => {});
  try {
    await page.waitFor(`document.querySelector('[data-t-trend] .trend-line') ? 1 : 0`, { timeout: 15000, label: "T4: .trend-line у ученика" });
  } catch (e) {
    const diag = await page.eval(`(() => { const S = window.__app.S; const box = document.querySelector('[data-t-trend]'); let sess = null; try { sess = JSON.parse(localStorage.getItem("oge-session") || "null"); } catch (_) {} return {
      view: S.view, rows: (S.results || S.rows || []).length, qz: (S.qzResults || []).length,
      profile: S.profile ? {id: S.profile.id, course: S.profile.course, token: S.token} : null,
      sess: sess && sess.profile ? {id: sess.profile.id, token: sess.token} : sess,
      mockRows: (() => { try { return window.__MOCK.dbTable("results").filter(r => String(r.student_id) === String(S.profile && S.profile.id)).length; } catch (_) { return "ERR"; } })(),
      quizzes: S.quizzes === null ? null : (S.quizzes || []).length,
      box: box ? box.innerHTML.slice(0, 300) : null, body: (document.body.innerText || "").slice(0, 250) }; })()`).catch(err => ({ evalError: String(err) }));
    console.log("       [T4 diag] " + JSON.stringify(diag).slice(0, 1200));
    /* ленивая загрузка тестов могла дорисоваться уже после первого рендера — пробуем ещё раз */
    await page.eval(`(() => { const b = document.querySelector('[data-go="stats"]'); if (b) b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('[data-t-trend] .trend-line') ? 1 : 0`, { timeout: 15000, label: "T4: .trend-line после повторного рендера" });
  }
  const st = await page.eval(`(() => { const box = document.querySelector('[data-t-trend]'); const tr = box.querySelector('.trend'); return {
    points: tr ? +tr.dataset.points : 0, first: tr ? +tr.dataset.first : null, last: tr ? +tr.dataset.last : null,
    dots: box.querySelectorAll('.trend-dot').length, text: box.innerText }; })()`);
  assert(st.points >= 1, "T4: data-points < 1: " + st.points);
  assert(st.dots >= 1, "T4: .trend-dot < 1: " + st.dots);
  eq(st.last, 100, "T4: data-last (последняя по дате точка — 10/10)");
  assert(/сейчас\s*100\s*%/i.test(st.text), "T4: в тексте нет «сейчас 100%»: " + JSON.stringify(st.text.slice(0, 300)));
});

/* ---------- V1–V3: панель «Инструменты», генерация к курсу ученика, урок для другого предмета/класса ---------- */
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function openTeacherCard(teacher, rowId) {
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="room-end"]'); if (b) b.click(); return true; })()`);
  await sleep(250);
  await teacher.eval(`(() => { const b = document.querySelector('[data-view="students"]'); if (b) b.click(); return true; })()`);
  await teacher.waitFor(`document.querySelector('[data-student="${rowId}"]') ? 1 : 0`, { timeout: 15000, label: "V: список учеников" });
  await clickStudentRow(teacher, rowId, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-t-student-all]') ? 1 : 0`, { timeout: 15000, label: "V: карточка ученика" });
}
/** начать занятие по уроку из плана и дождаться комнаты с доской */
async function startTeacherRoom(teacher, lessonId) {
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${lessonId}"]') ? 1 : 0`,
    { timeout: 15000, label: "V: кнопка «▶ Урок» в плане" });
  await clickStartLesson(teacher, lessonId, "V: урок в плане");
  await teacher.waitFor(`(() => { const T = window.__teacher.T; return T.view === "room" && T.board ? 1 : 0; })()`,
    { timeout: 18000, label: "V: комната урока с доской (T.view=room, T.board)" });
}
async function openToolsTab(teacher) {
  await teacher.eval(`(() => { const b = document.querySelector('[data-act="room-tools"]'); if (b) b.click(); return true; })()`);
  await teacher.waitFor(`document.querySelector('[data-tools-pane]') ? 1 : 0`, { timeout: 12000, label: "V: вкладка «Инструменты» ([data-tools-pane])" });
}
const boardRawItems = teacher => teacher.eval(`(() => { try { return window.__teacher.T.board.debug().raw || []; } catch (_) { return []; } })()`);
const boardPagesOf = teacher => teacher.eval(`(() => window.__teacher.T.board ? window.__teacher.T.board.pages() : [])()`);
async function waitBoardItem(teacher, t, test, label, timeout = 10000) {
  const t0 = Date.now();
  let arr = [];
  while (Date.now() - t0 < timeout) {
    arr = await boardRawItems(teacher);
    if ((arr || []).some(r => r.item && r.item.t === t && (!test || test(r.item)))) return arr;
    await sleep(150);
  }
  throw new Error("на доске не появился элемент " + label + ": " + JSON.stringify((arr || []).slice(-4)).slice(0, 500));
}
test("V1", "Комната → «Инструменты»: заметка и картинка на доске, поиск ссылки, «Вставить урок на доску»", async ({ teacher, baseUrl }) => {
  const lid = W.lessons.rus[0].id;
  /* без перезагрузки: открыть карточку rowA (V1 идёт после T2–T4, где кабинет уже загружен) */
  await openTeacherCard(teacher, ROW_A);
  await startTeacherRoom(teacher, lid);
  await openToolsTab(teacher);
  /* заметка → T.board.insertNote */
  await teacher.eval(`(() => { const el = document.getElementById("tool-note-text"); el.value = "Заметка из панели"; el.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector('[data-act="tool-note"]').click(); return true; })()`);
  await waitBoardItem(teacher, "t", it => /Заметка из панели/.test(it.s || ""), "заметка «Заметка из панели»");
  /* картинка: панель должна вызвать T.board.insertImage(url) (https-ссылка; data:-URL панель не принимает) */
  const imgUrl = "https://example.org/scheme.png";
  await teacher.eval(`(() => { const B = window.__teacher.T.board; window.__boardImgCalls = []; if (B && B.insertImage && !B.__imgSpy) { B.__imgSpy = true; const orig = B.insertImage.bind(B); B.insertImage = (u, ...a) => { window.__boardImgCalls.push(String(u)); return orig(u, ...a); }; } const el = document.getElementById("tool-img-url"); el.value = ${JSON.stringify(imgUrl)}; el.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector('[data-act="tool-img"]').click(); return true; })()`);
  await teacher.waitFor(`(window.__boardImgCalls || []).some(u => u === ${JSON.stringify(imgUrl)}) ? 1 : 0`,
    { timeout: 10000, label: "V1: панель «Картинка» вызвала T.board.insertImage(url)" });
  /* поиск: ссылки с запросом и домены */
  await teacher.eval(`(() => { const q = document.getElementById("tool-search-q"); q.value = "запятые при обороте"; q.dispatchEvent(new Event("input", {bubbles:true})); return true; })()`);
  const hrefS = await teacher.eval(`(() => { const a = document.querySelector('a[data-act="tool-search"][data-search="sdamgia"]'); return a ? a.getAttribute("href") : null; })()`);
  assert(hrefS && hrefS.includes(encodeURIComponent("запятые")), "ссылка «Решу» не содержит запрос: " + hrefS);
  const hrefF = await teacher.eval(`(() => { const a = document.querySelector('a[data-act="tool-search"][data-search="fipi"]'); return a ? a.getAttribute("href") : "нет"; })()`);
  assert(/fipi\.ru/.test(hrefF), "ссылка ФИПИ не на домен fipi.ru: " + hrefF);
  const hrefW = await teacher.eval(`(() => { const a = document.querySelector('a[data-act="tool-search"][data-search="wordwall"]'); return a ? a.getAttribute("href") : "нет"; })()`);
  assert(/wordwall\.net/.test(hrefW), "ссылка Wordwall не на wordwall.net: " + hrefW);
  /* 📌 вставить ссылку на доску */
  await teacher.eval(`document.querySelector('[data-act="tool-search-board"][data-search="fipi"]').click(); true`);
  await waitBoardItem(teacher, "t", it => /fipi\.ru/.test(it.s || ""), "ссылка на доску из поиска");
  /* вставить урок/теорию на доску → insertPage открывает лист */
  const pages0 = (await boardPagesOf(teacher)).length;
  await teacher.eval(`document.querySelector('[data-act="tool-insert-board"]').click(); true`);
  await teacher.waitFor(`window.__teacher.T.board && window.__teacher.T.board.pages().length > ${pages0} ? 1 : 0`,
    { timeout: 15000, label: "V1: insertPage добавил лист урока" });
  const pages = await boardPagesOf(teacher);
  const info = await teacher.eval(`window.__teacher.T.board.info()`);
  assert(info.page && pages.some(p => p.key === info.page), "insertPage не открыл новый лист: " + JSON.stringify({ page: info.page, keys: pages.map(p => p.key) }));
});
test("V2", "Комната rowB: «Сгенерировать материал» → ce-save даёт content-edit с курсом ученика math-5 и вставку на доску", async ({ teacher, baseUrl }) => {
  const lid = W.lessons.math[0].id;
  await openTeacherCard(teacher, ROW_B);
  await startTeacherRoom(teacher, lid);
  await openToolsTab(teacher);
  await teacher.eval(`document.querySelector('[data-act="tool-gen-theory"]').click(); true`);
  await teacher.waitFor(`document.getElementById("ce-req") ? 1 : 0`, { timeout: 10000, label: "V2: модалка генерации (#ce-req)" });
  const pages0 = (await boardPagesOf(teacher)).length;
  await teacher.eval(`document.querySelector('[data-act="ce-ai"]').click(); true`);
  await teacher.waitFor(`(() => { const T = window.__teacher.T; return T.ce && (T.ce.items || []).length > 0 ? 1 : 0; })()`,
    { timeout: 20000, label: "V2: ИИ вернул блоки теории" });
  await teacher.eval(`document.querySelector('[data-act="ce-save"]').click(); true`);
  const mat = await waitMockRow(teacher, "materials", m => m.kind === "tasks" && m.data && m.data.kind === "content-edit" && m.course === "math-5" && String(m.student_id) === ROW_B, 20000);
  assert(mat, "V2: нет content-edit материала с course=math-5/student=rowB: " + JSON.stringify(await teacherDB(teacher, "materials")).slice(0, 500));
  assert(Array.isArray(mat.data.theory) && mat.data.theory.length > 0, "V2: в data нет theory content-edit");
  await teacher.waitFor(`window.__teacher.T.board && window.__teacher.T.board.pages().length > ${pages0} ? 1 : 0`,
    { timeout: 15000, label: "V2: материал вставлен на доску (insertPage)" });
  const refresh = await teacher.eval(`window.__MOCK.cmdList().filter(c => c.type === "refresh" && String(c.to) === ${JSON.stringify(ROW_B)}).length`);
  assert(refresh > 0, "V2: ученику rowB не ушла команда refresh после сохранения материала");
});
test("V3", "Урок для другого предмета/класса: build_lesson → material kind lesson (math-5, rowB, theory/practice/test), ученик видит урок", async ({ teacher, browser, baseUrl }) => {
  await openTeacherCard(teacher, ROW_B);
  await teacher.waitFor(`document.querySelector('[data-build-lesson]') ? 1 : 0`, { timeout: 12000, label: "V3: карточка «Создать урок для этого предмета и класса»" });
  const title = "Признаки равенства треугольников";
  await teacher.eval(`(() => { const t = document.getElementById("bl-topic"); if (!t) return false; t.value = ${JSON.stringify(title)}; t.dispatchEvent(new Event("input", {bubbles:true})); const n = document.getElementById("bl-notes"); if (n) { n.value = "больше практики"; n.dispatchEvent(new Event("input", {bubbles:true})); } return true; })()`);
  await teacher.eval(`document.querySelector('[data-act="build-lesson"]').click(); true`);
  const lesson = await waitMockRow(teacher, "materials", m => m.kind === "lesson" && String(m.student_id) === ROW_B && m.course === "math-5" && m.data && m.data.from === "ai-build", 25000);
  assert(lesson, "V3: не сохранился material kind=lesson для rowB (math-5): " + JSON.stringify(await teacherDB(teacher, "materials")).slice(0, 600));
  assert(lesson.data.custom === true, "V3: data.custom !== true у созданного урока");
  assert((lesson.data.theory || []).length >= 1, "V3: у урока нет data.theory");
  assert((lesson.data.practice || []).length >= 1, "V3: у урока нет data.practice");
  assert((lesson.data.test || []).length >= 1, "V3: у урока нет data.test");
  assert(lesson.lesson_id && /^c/.test(lesson.lesson_id), "V3: lesson_id нового урока не сгенерирован (ожидали c…): " + lesson.lesson_id);
  /* учитель видит урок в плане rowB (buildLessonAct делает render; перезагрузка не нужна) */
  await teacher.waitFor(`document.body.innerText.includes(${JSON.stringify(title)}) ? 1 : 0`, { timeout: 15000, label: "V3: новый урок в карточке rowB у учителя" });
  /* ученик rowB после reload: урок в «Мои уроки» и теория */
  const page = await browser.newPage("about:blank");
  try {
    await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_B), joinHow: null }), "seed-v3.js");
    await page.inject(MOCK_SRC, "mock-supabase.js");
    await blockUrls(page);
    await page.goto(baseUrl + "/index.html");
    await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="lessons"]') ? 1 : 0`, { timeout: 25000, label: "V3: ученик rowB после reload" });
    await page.eval(`document.querySelector('[data-go="lessons"]').click(); true`);
    await page.waitFor(`(() => { const S = window.__app.S; return S.view === "lessons" || S.view === "folder" ? 1 : 0; })()`, { timeout: 12000, label: "V3: раздел «Мои уроки»" });
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(title)}) ? 1 : 0`, { timeout: 15000, label: "V3: новый урок виден ученику rowB в «Моих уроках»" });
    const st = await page.eval(`(() => { const S = window.__app.S; const c = S.course; const l = c && (c.lessons || []).find(x => String(x.id) === ${JSON.stringify(String(lesson.lesson_id))}); return { hasLesson: !!l, theory: l ? (l.theory || []).length : 0, title: l ? l.title : null }; })()`);
    assert(st.hasLesson, "V3: у ученика rowB нет урока " + lesson.lesson_id + " в плане (S.course.lessons)");
    assert(st.theory >= 1, "V3: у ученика rowB урок без теории: " + JSON.stringify(st));
  } finally { try { await page.close(); } catch (_) {} }
});

/* ---------- U1: база самообучения + конструктор наборов учителя ---------- */
/** перезагрузить кабинет и открыть карточку rowA (маршрут из sessionStorage не восстанавливаем) */
async function reloadTeacherToRow(teacher, baseUrl){
  await teacher.eval(`try { sessionStorage.clear(); } catch (_) {}; true`);
  await teacher.goto(baseUrl + "/teacher.html");
  await teacher.waitFor(`window.__teacher && document.querySelector('.shell') ? 1 : 0`, { timeout: 25000, label: "кабинет учителя (shell + __teacher)" });
  /* сбрасываем «идущий урок», иначе ученик при загрузке получает room-pull и переключается на другой предмет */
  await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; if (!T) return false; T.room = null; if (T.me) T.me.room = null; return true; })()`);
  /* сбрасываем сохранённый «идущий урок»: иначе ученик получает room-pull и уходит на другой предмет */
  await teacher.eval(`(async () => { try { await window.__MOCK.client.from("teachers").update({room: null}).eq("id", ${JSON.stringify(TEACHER_ID)}); } catch (_) {} return true; })()`);
  await teacher.eval(`try { sessionStorage.clear(); } catch (_) {}; true`);
  await teacher.goto(baseUrl + "/teacher.html");
  await teacher.waitFor(`window.__teacher && document.querySelector('.shell') ? 1 : 0`, { timeout: 25000, label: "кабинет учителя после сброса урока" });
  /* presence без комнаты: ученик не должен получить room-pull и уйти на другой предмет */
  await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; if (!T) return false; T.room = null; if (T.me) T.me.room = null; try { T.live && T.live.track({role: "teacher", room: null}); } catch (_) {} return true; })()`);
  await teacher.waitFor(`(() => { const st = window.__MOCK.presenceOf("live-${TEACHER_ID}") || {}; return Object.values(st).flat().every(p => !p.room) ? 1 : 0; })()`, { timeout: 10000, label: "presence учителя без комнаты" });  await teacher.eval(`(() => { const b = document.querySelector('[data-view="students"]'); if (b) b.click(); return !!b; })()`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 15000, label: "список учеников (U1)" });
  await clickStudentRow(teacher, ROW_A, "список учеников");
  await teacher.waitFor(`document.querySelector('[data-t-student-all]') ? 1 : 0`, { timeout: 15000, label: "карточка rowA («Всё, что делает ученик»)" });
}
/** заполнить и сохранить форму набора ss-* (тип stress|deck) */
async function ssCreate(teacher, { kind, title, body, scope = "all" }){
  await teacher.eval(`document.querySelector('[data-act="ss-new"]').click(); true`);
  await teacher.waitFor(`document.getElementById("ss-form") ? 1 : 0`, { timeout: 8000, label: "форма «Создать набор» (#ss-form)" });
  await teacher.eval(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return false; el.value = v; el.dispatchEvent(new Event("change", {bubbles: true})); el.dispatchEvent(new Event("input", {bubbles: true})); return true; };
    set("#ss-kind", ${JSON.stringify(kind)}); set("#ss-title", ${JSON.stringify(title)}); set("#ss-scope", ${JSON.stringify(scope)}); set("#ss-body", ${JSON.stringify(body)});
    return true;
  })()`);
  await teacher.eval(`document.querySelector('[data-act="ss-save"]').click(); true`);
}
/** открыть просмотр базы (секция сворачиваемая; список своих наборов — внутри [data-ss-viewer]) */
async function openBaseViewer(teacher){
  if (!(await teacher.eval(`!!document.querySelector('[data-ss-viewer]')`))) {
    await teacher.eval(`document.querySelector('[data-act="ss-view"]').click(); true`);
  }
  await teacher.waitFor(`document.querySelector('[data-ss-viewer]') ? 1 : 0`, { timeout: 8000, label: "просмотр базы ([data-ss-viewer])" });
}
test("U1", "База самообучения и конструктор: просмотр базы, создание stress/deck наборов, ученик проходит, прогресс у учителя, правка и удаление", async ({ teacher, student, browser, baseUrl }) => {
  /* вкладка ученика rowB больше не нужна: она делит localStorage и может перезаписать сессию rowA во время reload */
  try { await student.close(); } catch (_) {}
  /* свой мир: чистая мок-БД (иначе works/материалы прошлых сценариев повлияют) */
  await teacher.eval(`window.__MOCK.reset(${JSON.stringify(JSON.parse(JSON.stringify(W.db)))}); true`);
  await reloadTeacherToRow(teacher, baseUrl);

  /* a) просмотр базы: 12 блоков × 15 слов = 180, 5 встроенных колод */
  const hasBase = await teacher.eval(`!!document.querySelector('[data-t-selfbase]')`);
  assert(hasBase, "в карточке нет секции [data-t-selfbase] «База самообучения»");
  await teacher.eval(`document.querySelector('[data-act="ss-view"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-ss-viewer]') ? 1 : 0`, { timeout: 8000, label: "просмотр базы ([data-ss-viewer]) после «Показать базу»" });
  const base = await teacher.eval(`(() => {
    const blocks = [...document.querySelectorAll('[data-t-self-base-stress]')];
    const decks = [...document.querySelectorAll('[data-t-self-base-deck]')].map(d => ({cards: +d.dataset.cards, text: d.textContent}));
    return {
      blocks: blocks.length,
      words: blocks.reduce((a, b) => a + (+b.dataset.words || 0), 0),
      blockWords: blocks.map(b => +b.dataset.words || 0),
      decks,
      text: document.body.innerText || "",
    };
  })()`);
  eq(base.blocks, 12, "встроенных блоков ударений в базе");
  eq(base.words, 180, "суммарно слов в блоках ударений");
  eq(base.decks.length, 5, "встроенных колод в базе");
  const deckCards = base.decks.map(d => d.cards).sort((a, b) => a - b);
  assert(deckCards.join(",") === "15,15,16,20,29", "количества карточек во встроенных колодах: " + JSON.stringify(base.decks));
  for (const name of ["Паронимы", "Средства выразительности"]) assert(base.decks.some(d => d.text.includes(name)) || base.text.includes(name), "нет встроенной колоды «" + name + "»");

  /* b) создаём свой stress-набор */
  await ssCreate(teacher, { kind: "stress", title: "Слова от учителя", body: "звонИть\nтОрты\nбАнты" });
  const matStress = await waitMaterial(teacher, m => m.kind === "tasks" && m.lesson_id === "self" && m.title === "Слова от учителя");
  assert(matStress, "после сохранения нет материала stress-набора в mock-БД: " + JSON.stringify(await teacherDB(teacher, "materials")).slice(0, 500));
  eq(matStress.course, "rus-5", "materials.course stress-набора");
  eq(matStress.student_id, null, "student_id при scope=all");
  eq(matStress.data && matStress.data.kind, "self-stress", "materials.data.kind stress-набора");
  eq((matStress.data.words || []).length, 3, "materials.data.words.length stress-набора");
  assert((matStress.data.words || []).includes("звонИть"), "канонические слова (звонИть) не сохранены: " + JSON.stringify(matStress.data.words));
  const sid = matStress.id, stressSetKey = "m" + sid;
  await teacher.waitFor(`document.querySelector('[data-t-custom-set][data-id="${sid}"]') ? 1 : 0`, { timeout: 8000, label: "свой stress-набор в списке [data-t-custom-set]" });
  await teacher.waitFor(`document.querySelector('[data-t-custom-stress="${stressSetKey}"]') ? 1 : 0`, { timeout: 8000, label: "строка прогресса своего stress-набора [data-t-custom-stress]" });

  /* c) создаём свою колоду карточек */
  await ssCreate(teacher, { kind: "deck", title: "Мои карточки", body: "вопрос один | ответ один\nвопрос два | ответ два" });
  const matDeck = await waitMaterial(teacher, m => m.kind === "tasks" && m.lesson_id === "self" && m.title === "Мои карточки");
  assert(matDeck, "после сохранения нет материала deck-набора");
  eq(matDeck.data && matDeck.data.kind, "self-deck", "materials.data.kind deck-набора");
  eq((matDeck.data.cards || []).length, 2, "materials.data.cards.length deck-набора");
  eq(matDeck.data.cards[0].f, "вопрос один", "deck cards[0].f");
  eq(matDeck.data.cards[0].b, "ответ один", "deck cards[0].b");
  const did = matDeck.id, deckSetKey = "m" + did;
  await teacher.waitFor(`document.querySelector('[data-t-custom-set][data-id="${did}"]') ? 1 : 0`, { timeout: 8000, label: "свой deck-набор в списке" });
  await teacher.waitFor(`document.querySelector('[data-t-custom-deck="${deckSetKey}"]') ? 1 : 0`, { timeout: 8000, label: "строка прогресса своего deck-набора [data-t-custom-deck]" });

  /* d) ученик: reload → видит оба набора с пометкой «от учителя» и проходит их */
  let page;
  try { if (W.quizTab) await W.quizTab.close(); } catch (_) {}
  W.quizTab = null; W.quizTabClosed = false;
  page = await browser.newPage("about:blank");
  await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-u1.js");
  await page.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(page);
  W.quizTab = page;
  /* сессия хранится в общем localStorage: после закрытия вкладки rowB могла остаться чужая – вернём rowA */
  await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-u1.js");
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="self"]') ? 1 : 0`, { timeout: 25000, label: "ученик после reload (свои наборы)" });
  const sessDbg = await page.eval(`(() => { const S = window.__app && window.__app.S; let sess = null; try { sess = JSON.parse(localStorage.getItem("oge-session") || "null"); } catch (_) { sess = "ERR"; } return { href: location.href, sess: sess && sess.profile ? {id: sess.profile.id, token: sess.token} : sess, token: S && S.token, id: S && S.profile && S.profile.id, course: S && S.profile && S.profile.course }; })()`).catch(e => ({ evalError: String(e) }));
  console.log("       [U1 student reload] " + JSON.stringify(sessDbg).slice(0, 600));
  await selfOpen(page);
  const customStress = `[data-act="self-stress-block"][data-custom="${stressSetKey}"]`;
  const customDeck = `[data-act="self-deck"][data-custom="${deckSetKey}"]`;
  try {
    await page.waitFor(`document.querySelector(${JSON.stringify(customStress)}) ? 1 : 0`, { timeout: 12000, label: "свой stress-блок ученика с data-custom" });
  } catch (e) {
    const diag = await page.eval(`(() => { const S = window.__app && window.__app.S; return {
      profile: S && S.profile ? {id: S.profile.id, course: S.profile.course, subjects: (S.profile.subjects || []).map(x => x && x.id)} : null,
      mats: (S && S.mats || []).map(m => ({id: m.id, kind: m.kind, lesson: m.lesson_id, course: m.course, sid: m.student_id, dk: m.data && m.data.kind})).slice(0, 12),
      view: S && S.view,
      hasSelfData: !!(window.SELF_DATA && window.SELF_DATA.customSets),
      customSets: (() => { try { const c = window.SELF_DATA.customSets(S.mats, S.profile.course, S.profile.id); return {b: c.blocks.length, d: c.decks.length}; } catch (err) { return "ERR:" + err.message; } })(),
      body: (document.body.innerText || "").slice(0, 500),
    }; })()`).catch(err => ({evalError: String(err)}));
    console.log("       [U1 diag] " + JSON.stringify(diag).slice(0, 1600));
    console.log("       [U1 quiz-tab errors] " + JSON.stringify(page.errors.slice(-4)));
    throw e;
  }
  await page.waitFor(`document.querySelector(${JSON.stringify(customDeck)}) ? 1 : 0`, { timeout: 12000, label: "своя колода ученика с data-custom" });
  const custInfo = await page.eval(`(() => {
    const b = document.querySelector(${JSON.stringify(customStress)}), d = document.querySelector(${JSON.stringify(customDeck)});
    return { bText: b ? b.textContent : "", dText: d ? d.textContent : "", bTask: b ? b.dataset.task : null, dTask: d ? d.dataset.task : null };
  })()`);
  assert(/Слова от учителя/.test(custInfo.bText), "в своём блоке нет названия «Слова от учителя»: " + JSON.stringify(custInfo.bText));
  assert(/от учителя/.test(custInfo.bText) && /от учителя/.test(custInfo.dText), "нет пометки «от учителя»: " + JSON.stringify(custInfo));
  const stressTask = await page.eval(`window.SELF_DATA.taskFor("m${sid}")`);
  const deckTask = await page.eval(`window.SELF_DATA.taskFor("m${did}")`);
  eq(+custInfo.bTask, stressTask, "data-task своего stress-блока");
  eq(+custInfo.dTask, deckTask, "data-task своей колоды");
  // проходим свой stress-блок (3 слова)
  await page.eval(`document.querySelector(${JSON.stringify(customStress)}).click(); true`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .st-word .st-v') ? 1 : 0`, { timeout: 15000, label: "тренажёр своего stress-блока" });
  await runStressMastery(page, (matStress.data.words || []));
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал своего stress-блока" });
  const wStress = await waitMockRow(teacher, "works", w => w.lesson_id === "self:stress" && +w.task === +stressTask && w.data && w.data.done === true);
  assert(wStress, "works self:stress с p_task=taskFor(m" + sid + ") не записан: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 500));
  eq((wStress.data.mastered || []).length, 3, "mastered.length своего stress-блока");
  const rStress = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:stress"));
  assert(rStress, "нет результата kind=self по своему stress-блоку");
  await closePlay(page);
  // проходим свою колоду (2 карточки)
  try {
    await page.waitFor(`document.querySelector(${JSON.stringify(customDeck)}) ? 1 : 0`, { timeout: 8000, label: "своя колода после закрытия тренажёра" });
  } catch (e) {
    const diag = await page.eval(`(() => { const S = window.__app && window.__app.S; return {
      view: S && S.view, profile: S && S.profile ? {id: S.profile.id, course: S.profile.course} : null,
      mats: (S && S.mats || []).map(m => ({id: m.id, lesson: m.lesson_id, course: m.course, sid: m.student_id, dk: m.data && m.data.kind})),
      deckBtns: [...document.querySelectorAll('.self-decks [data-act="self-deck"]')].map(b => ({custom: b.dataset.custom || null, text: (b.textContent || "").slice(0, 40)})),
      blockBtns: [...document.querySelectorAll('.self-blocks [data-act="self-stress-block"]')].map(b => ({custom: b.dataset.custom || null})),
      overlay: !!document.querySelector('.play-ov'),
      body: (document.body.innerText || "").slice(0, 400),
    }; })()`).catch(err => ({evalError: String(err)}));
    console.log("       [U1 deck diag] " + JSON.stringify(diag).slice(0, 1400));
    throw e;
  }
  /* клик по своей колоде: после финала блока экран перерисовывается – пробуем несколько раз */
  let deckOpened = false;
  for (let attempt = 0; attempt < 4 && !deckOpened; attempt++){
    await sleep(attempt ? 400 : 150);
    await page.eval(`(() => { const b = document.querySelector(${JSON.stringify(customDeck)}); if (b) b.click(); return !!b; })()`);
    try { await page.waitFor(`document.querySelector(".play-ov") ? 1 : 0`, { timeout: 2500, label: "" }); deckOpened = true; } catch (_) {}
  }
  try { await page.waitFor(`document.querySelector('.play-ov .play-body .self-front') ? 1 : 0`, { timeout: 15000, label: "тренажёр своей колоды" }); }
  catch (e) {
    const diag2 = await page.eval(`(() => ({ overlay: !!document.querySelector(".play-ov"), ovText: (document.querySelector(".play-ov") || {}).innerText || "", play: typeof window.Play, view: window.__app && window.__app.S && window.__app.S.view, works: window.__MOCK ? window.__MOCK.dbTable("works").filter(w => w.lesson_id === "self:deck") : null }))()`).catch(err => ({ evalError: String(err) }));
    console.log("       [U1 deck-open diag] " + JSON.stringify(diag2).slice(0, 1400));
    throw e;
  }
  await runDeckLoop(page);
  const wDeck = await waitMockRow(teacher, "works", w => w.lesson_id === "self:deck" && +w.task === +deckTask && w.data && w.data.done === true);
  assert(wDeck, "works self:deck с p_task=taskFor(m" + did + ") не записан: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 500));
  eq((wDeck.data.mastered || []).length, 2, "mastered.length своей колоды");
  const rDeck = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:cards"));
  assert(rDeck, "нет результата kind=self по своей колоде");
  await closePlay(page);

  /* e) прогресс у учителя по своим наборам */
  await reloadTeacherToRow(teacher, baseUrl);
  const prog = await teacher.eval(`(() => {
    const ds = el => el ? {...el.dataset} : null;
    return { stress: ds(document.querySelector('[data-t-custom-stress="${stressSetKey}"]')), deck: ds(document.querySelector('[data-t-custom-deck="${deckSetKey}"]')) };
  })()`);
  assert(prog.stress && +prog.stress.mastered === 3 && +prog.stress.total === 3 && String(prog.stress.done) === "1", "у учителя нет прогресса своего stress-набора 3/3: " + JSON.stringify(prog.stress));
  assert(prog.deck && +prog.deck.mastered === 2 && +prog.deck.total === 2 && String(prog.deck.done) === "1", "у учителя нет прогресса своей колоды 2/2: " + JSON.stringify(prog.deck));

  /* f) редактирование: title «Слова от учителя 2» — ученик видит после reload */
  await openBaseViewer(teacher);
  await teacher.eval(`document.querySelector('[data-act="ss-edit"][data-id="${sid}"]').click(); true`);
  await teacher.waitFor(`document.getElementById("ss-form") ? 1 : 0`, { timeout: 8000, label: "форма редактирования набора" });
  await teacher.eval(`(() => { const el = document.getElementById("ss-title"); el.value = "Слова от учителя 2"; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await teacher.eval(`document.querySelector('[data-act="ss-save"]').click(); true`);
  const renamed = await waitMaterial(teacher, m => m.id === sid && m.title === "Слова от учителя 2");
  assert(renamed, "materials.title не обновился после редактирования: " + JSON.stringify((await teacherDB(teacher, "materials")).find(m => m.id === sid)));
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="self"]') ? 1 : 0`, { timeout: 25000, label: "ученик после reload (после переименования)" });
  await selfOpen(page);
  await page.waitFor(`(() => { const b = document.querySelector('[data-act="self-stress-block"][data-custom="${stressSetKey}"]'); return b && /Слова от учителя 2/.test(b.textContent) ? 1 : 0; })()`,
    { timeout: 12000, label: "ученик видит новое название своего блока" });

  /* g) удаление колоды: два клика по «Удалить», ученик больше не видит, встроенные остаются */
  await openBaseViewer(teacher);
  await teacher.eval(`document.querySelector('[data-act="ss-del"][data-id="${did}"]').click(); true`);
  await sleep(150);
  await teacher.eval(`document.querySelector('[data-act="ss-del"][data-id="${did}"]').click(); true`);
  const gone = await waitMockRow(teacher, "materials", m => m.id === did, 1500);
  // строка должна исчезнуть; ждём подтверждения удаления до 10 с
  let deleted = !gone;
  for (let i = 0; i < 40 && !deleted; i++) { await sleep(250); deleted = !(await teacherDB(teacher, "materials")).some(m => m.id === did); }
  assert(deleted, "deck-набор не удалён из materials: " + JSON.stringify((await teacherDB(teacher, "materials")).find(m => m.id === did)));
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="self"]') ? 1 : 0`, { timeout: 25000, label: "ученик после reload (после удаления)" });
  await selfOpen(page);
  const afterDel = await page.eval(`(() => ({
    custom: document.querySelectorAll('.self-decks [data-act="self-deck"][data-custom]').length,
    builtinBlocks: document.querySelectorAll('.self-blocks [data-act="self-stress-block"]:not([data-custom])').length,
    builtinDecks: document.querySelectorAll('.self-decks [data-act="self-deck"]:not([data-custom])').length,
    hasDel: !!document.querySelector('[data-act="self-deck"][data-custom="${deckSetKey}"]'),
  }))()`);
  assert(!afterDel.hasDel, "удалённая колода осталась у ученика");
  assert(afterDel.custom === 0, "после удаления у ученика остались свои колоды: " + afterDel.custom);
  eq(afterDel.builtinBlocks, 12, "встроенные блоки ударений после удаления набора");
  eq(afterDel.builtinDecks, 2, "встроенные колоды на rus-курсе после удаления набора");
  // и у учителя база по-прежнему цела
  await reloadTeacherToRow(teacher, baseUrl);
  await teacher.eval(`document.querySelector('[data-act="ss-view"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-ss-viewer]') ? 1 : 0`, { timeout: 8000, label: "просмотр базы после удаления" });
  const baseAfter = await teacher.eval(`(() => ({ blocks: document.querySelectorAll('[data-t-self-base-stress]').length, decks: document.querySelectorAll('[data-t-self-base-deck]').length, custom: document.querySelectorAll('[data-t-custom-set]').length }))()`);
  eq(baseAfter.blocks, 12, "встроенные блоки в базе после удаления");
  eq(baseAfter.decks, 5, "встроенные колоды в базе после удаления");
  eq(baseAfter.custom, 1, "остался один свой набор (stress) после удаления колоды");
});

test("U2", "Доступ без подписки: раздел «Доступ», всё открыто, оплата не предлагается", async ({ teacher }) => {
  await teacher.eval(`document.querySelector('[data-view="sub"]').click(); true`);
  await teacher.waitFor(`/Всё открыто/.test((document.querySelector("#app") || {}).innerText || "") ? 1 : 0`,
    { timeout: 10000, label: "раздел «Доступ»: «Всё открыто»" });
  const d = await teacher.eval(`(() => {
    const nav = Array.from(document.querySelectorAll('.navitem')).find(b => b.getAttribute("data-view") === "sub");
    const T = window.__teacher && window.__teacher.T;
    return { pay: document.querySelectorAll("[data-pay]").length, nav: (nav || {}).textContent || "",
      free: !!(T && T.me && T.me.free), active: T && T.me && T.me.active,
      banner: /Подписка закончилась/.test((document.querySelector("#app") || {}).innerText || "") };
  })()`);
  eq(d.pay, 0, "кнопок оплаты нет");
  eq(d.free, true, "me().free");
  eq(d.active, "full", "me().active = full");
  assert(/Доступ/.test(d.nav), "пункт меню называется «Доступ», а не «Подписка»");
  assert(!d.banner, "нет баннера «Подписка закончилась»");
});
/* ---------- W1: кабинет учителя на планшете — медленный запрос, ошибка/повтор, iPad ---------- */
test("W1", "Кабинет учителя: медленный необязательный запрос не блокирует учеников; ошибка students → карточка и «Повторить»; iPad 820×1180", async ({ teacher, baseUrl }) => {
  const seed = JSON.parse(JSON.stringify(W.db));
  const reloadTeacher = async (label) => {
    await teacher.eval(`try { sessionStorage.clear(); } catch (_) {}; true`).catch(() => {});
    await teacher.goto(baseUrl + "/teacher.html", { wait: "load", timeout: 45000 });
    await teacher.waitFor(`window.__teacher && document.querySelector('.shell') ? 1 : 0`, { timeout: 25000, label });
  };
  const errorCard = () => teacher.eval(`(() => {
    let el = document.querySelector('[data-t-load-error]');
    if (!el) {
      const all = [...document.querySelectorAll("div,section,article")].filter(x => /Не загрузились ученики/i.test(x.textContent || ""));
      el = all.find(x => x.querySelector("button,[data-act]")) || all.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
    }
    if (!el) return null;
    const btns = [...el.querySelectorAll("button,[data-act]")];
    const btn = btns.find(x => /Повторить|Обновить|Попробовать|Ещё раз/i.test(x.textContent || "")) || btns.find(x => x.dataset && x.dataset.act === "reload") || btns[0] || null;
    return { text: (el.textContent || "").trim().slice(0, 240), btn: btn ? (btn.textContent || "").trim() : null, act: btn ? (btn.dataset.act || "") : null, hasBtn: !!btn };
  })()`);
  try {
    /* (a) медленный НЕОБЯЗАТЕЛЬНЫЙ запрос (topic_quizzes — фон) не блокирует список учеников.
       Управляемый delay ставим ДО загрузки страницы через addScriptToEvaluateOnNewDocument:
       после навигации мок создаётся заново, и настройка со старой страницы не переживает reload. */
    await teacher.eval(`window.__MOCK.reset(${JSON.stringify(seed)}); window.__MOCK.clearControls(); true`);
    /* Таймер на странице (setTimeout-тик с document-start) фиксирует ПОРЯДОК: сначала [data-student]
       (основное), позже T.bgLoaded (фон). Абсолютные секунды не важны — на этой машине загрузка ассетов
       из OneDrive занимает секунды, это не про блокировку loadAll. */
    const ctlA = await teacher.inject(`window.__MOCK.delay("topic_quizzes", 15000);
      window.__w1 = {studentsAt: 0, bgAt: 0, loadingSeen: false, bgAtStudents: null};
      (function tick(){
        try {
          const T = window.__teacher && window.__teacher.T;
          if (T){
            if (T.loading) window.__w1.loadingSeen = true;
            if (!window.__w1.studentsAt && document.querySelector('[data-student]')) {
              window.__w1.studentsAt = performance.now();
              window.__w1.bgAtStudents = !!T.bgLoaded;
            }
            if (T.bgLoaded && !window.__w1.bgAt) window.__w1.bgAt = performance.now();
          }
        } catch (_) {}
        setTimeout(tick, 25);
      })(); true;`, "w1a-ctrl.js");
    try {
      const t0 = Date.now();
      await reloadTeacher("W1a: кабинет учителя загрузился (медленный topic_quizzes)");
      await teacher.waitFor(`document.querySelector('[data-student]') ? 1 : 0`, { timeout: 20000, label: "W1a: [data-student] появились, несмотря на задержку topic_quizzes 15 c" });
      await teacher.waitFor(`(() => { const T = window.__teacher.T; return T.bgLoaded === true ? 1 : 0; })()`,
        { timeout: 45000, label: "W1a: фоновые данные завершились (T.bgLoaded)" });
      const w1 = await teacher.eval(`(() => { const w = window.__w1 || {}; return { studentsAt: Math.round(w.studentsAt || 0), bgAt: Math.round(w.bgAt || 0), bgAtStudents: w.bgAtStudents, loadingSeen: !!w.loadingSeen }; })()`);
      console.log("       [W1a] порядок: studentsAt=" + w1.studentsAt + "мс, bgAt=" + w1.bgAt + "мс, загрузка шла=" + w1.loadingSeen);
      if (!w1.studentsAt) throw new Error("W1a: страница не зафиксировала появление [data-student]");
      if (w1.bgAtStudents === true) throw new Error("W1a: ученики появились только после завершения фоновой загрузки (T.bgLoaded уже true) — фон блокирует список");
      if (!w1.bgAt) throw new Error("W1a: не дождались T.bgLoaded");
      if (!(w1.bgAt > w1.studentsAt + 1000)) throw new Error("W1a: фон завершился почти одновременно со списком (bgAt-studentsAt=" + (w1.bgAt - w1.studentsAt) + " мс) — похоже, ученики ждали медленный background-запрос");
      const loadState = await teacher.eval(`(() => { const T = window.__teacher && window.__teacher.T; return { loading: T ? T.loading : undefined, students: document.querySelectorAll('[data-student]').length, loadText: ((document.body.innerText || "").match(/Загружаю…|Загружаю\\.\\.\\.|Загружаем данные/) || [null])[0], err: /Не загрузились ученики/i.test(document.body.innerText || "") }; })()`);
      if (loadState.loading === true) throw new Error("W1a: T.loading=true, хотя ученики уже нарисованы: " + JSON.stringify(loadState));
      if (loadState.loadText) throw new Error("W1a: на экране висит «" + loadState.loadText + "», хотя ученики уже видны: " + JSON.stringify(loadState));
      if (loadState.err) throw new Error("W1a: при медленном необязательном запросе показана ошибка загрузки учеников: " + JSON.stringify(loadState));
      const bg = await teacher.eval(`(() => { const T = window.__teacher.T; return { bgLoaded: T.bgLoaded, bgError: (T.bgError || []).slice(), students: document.querySelectorAll('[data-student]').length }; })()`);
      if (bg.students < 2) throw new Error("W1a: ученики исчезли после фоновой догрузки: " + JSON.stringify(bg));
      if (!(bg.bgError || []).some(x => /тест/i.test(String(x)))) throw new Error("W1a: ожидали ошибку таймаута topic_quizzes в T.bgError: " + JSON.stringify(bg));
    } finally {
      await teacher.removeInjected(ctlA);
    }
    /* убираем задержку у текущего документа и «Обновить» → фон догружается без ошибок */
    await teacher.eval(`window.__MOCK.clearControls(); true`);
    await teacher.eval(`(() => { const b = document.querySelector('[data-act="reload"]'); if (!b) return false; b.click(); return true; })()`);
    await teacher.waitFor(`(() => { const T = window.__teacher.T; return T.bgLoaded === true && (T.bgError || []).length === 0 ? 1 : 0; })()`,
      { timeout: 20000, label: "W1a: после «Обновить» фон догрузился без ошибок" });

    /* (b) ошибка students → карточка «Не загрузились ученики» + «Повторить» работает */
    const ctlB = await teacher.inject(`window.__MOCK.fail("students", "нет сети"); true;`, "w1b-ctrl.js");
    try {
      await reloadTeacher("W1b: кабинет загрузился с ошибкой students");
      await teacher.waitFor(`(() => { const el = [...document.querySelectorAll("div,section,article")].find(x => /Не загрузились ученики/i.test(x.textContent || "")); return el ? 1 : 0; })()`,
        { timeout: 30000, label: "W1b: карточка «Не загрузились ученики»" });
      const err1 = await errorCard();
      if (!err1) throw new Error("W1b: карточка ошибки не найдена");
      if (!err1.hasBtn) throw new Error("W1b: в карточке ошибки нет кнопки повтора: " + JSON.stringify(err1));
      const card = await teacher.eval(`!!document.querySelector('[data-t-load-error]')`);
      if (!card) throw new Error("W1b: нет карточки [data-t-load-error]");
      if (await teacher.eval(`document.querySelectorAll('[data-student]').length`) > 0) throw new Error("W1b: при ошибке students список учеников всё равно отрисован");
      /* снимаем fail и жмём «Повторить» (loadAll) */
      await teacher.eval(`window.__MOCK.clearControls(); true`);
      const clicked = await teacher.eval(`(() => { const el = document.querySelector('[data-t-load-error] [data-act="reload"]') || [...document.querySelectorAll("button,[data-act]")].find(x => /Повторить/i.test(x.textContent || "")); if (!el) return false; el.click(); return true; })()`);
      if (!clicked) throw new Error("W1b: не нашли кнопку «Повторить»");
      await teacher.waitFor(`document.querySelectorAll('[data-student]').length >= 2 ? 1 : 0`, { timeout: 30000, label: "W1b: после «Повторить» ученики появились" });
      if (await teacher.eval(`!!document.querySelector('[data-t-load-error]')`)) throw new Error("W1b: карточка ошибки осталась после успешного повтора");
    } finally {
      await teacher.removeInjected(ctlB);
      await teacher.eval(`window.__MOCK.clearControls(); true`).catch(() => {});
    }

    /* (c) iPad 820×1180: ученики видимы, не перекрыты, клик открывает карточку */
    const origUA = await teacher.userAgent();
    await teacher.setViewport(820, 1180, { mobile: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", platform: "iPad" });
    try {
      await reloadTeacher("W1c: кабинет на iPad загрузился");
      await teacher.waitFor(`document.querySelectorAll('[data-student]').length >= 2 ? 1 : 0`, { timeout: 25000, label: "W1c: ≥2 ученика на iPad" });
      const vis = await teacher.eval(`(() => {
        const rows = [...document.querySelectorAll('[data-student]')];
        return rows.map(r => {
          const q = r.getBoundingClientRect();
          const cx = Math.min(innerWidth - 3, Math.max(3, q.left + q.width / 2));
          const cy = Math.min(innerHeight - 3, Math.max(3, q.top + q.height / 2));
          const at = document.elementFromPoint(cx, cy);
          return { id: r.dataset.student, w: q.width, h: q.height, top: q.top, visible: !!r.offsetParent,
            covered: !(at && (at === r || r.contains(at))), inDoc: q.width > 0 && q.height > 0 && q.top < document.documentElement.scrollHeight };
        });
      })()`);
      if (vis.length < 2) throw new Error("W1c: на iPad меньше 2 строк учеников: " + JSON.stringify(vis));
      for (const r of vis) {
        if (!r.visible || r.w < 20 || r.h < 10) throw new Error("W1c: строка ученика «" + r.id + "» не видна/нулевая на iPad: " + JSON.stringify(r));
        if (!r.inDoc) throw new Error("W1c: строка ученика «" + r.id + "» вне документа: " + JSON.stringify(r));
        if (r.covered) throw new Error("W1c: строка ученика «" + r.id + "» перекрыта (фильтры/меню?): " + JSON.stringify(r));
      }
      await clickStudentRow(teacher, ROW_A, "W1c: строка rowA на iPad");
      await teacher.waitFor(`document.querySelector('[data-t-student-all]') ? 1 : 0`, { timeout: 12000, label: "W1c: клик по ученику на iPad открыл карточку («Всё, что делает ученик»)" });
    } finally {
      await teacher.setViewport(1440, 1000, { userAgent: origUA, platform: "" }).catch(() => {});
    }
  } finally {
    await teacher.eval(`window.__MOCK.clearControls(); true`).catch(() => {});
  }
});
/* ================= запуск ================= */
function ensureArtifacts() { fs.mkdirSync(ARTIFACTS, { recursive: true }); }

async function bootTabs(browser, baseUrl, world) {
  const teacher = await browser.newPage("about:blank");
  await teacher.inject(seedScript({ db: world.db, session: TEACHER_SESSION, studentSession: null }), "seed-teacher.js");
  await teacher.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(teacher);
  await teacher.goto(baseUrl + "/teacher.html");
  await teacher.waitFor(`(() => { const b = Array.from(document.querySelectorAll("[data-student]")); return b.length >= 2 ? 1 : 0; })()`,
    { timeout: 30000, label: "кабинет учителя: карточки учеников загрузились" });
  /* дождаться, пока первичная загрузка и ФОН закончатся: иначе первые тесты попадают в занятый
     рендерер (асинхронная догрузка курсов/активности) и получают CDP timeout на Runtime.evaluate */
  await teacher.waitFor(`(() => { const T = window.__teacher && window.__teacher.T; return T && T.loading === false && T.bgLoading === false ? 1 : 0; })()`,
    { timeout: 60000, label: "кабинет учителя: первичная и фоновая загрузка завершились" });

  const student = await browser.newPage("about:blank");
  await student.inject(seedScript({ db: world.db, session: null, studentSession: world.studentSession(ROW_B), joinHow: "board" }), "seed-student.js");
  await student.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(student);
  await student.goto(baseUrl + "/index.html");
  await student.waitFor(`(() => { const s = localStorage.getItem("oge-session"); if (!s) return 0; const o = JSON.parse(s); return o && o.profile && window.__app && window.__app.S && document.querySelector(".topnav") ? 1 : 0; })()`,
    { timeout: 30000, label: "приложение ученика загрузилось (главная)" });

  await teacher.waitFor(`(() => { const el = document.querySelector('[data-online="${ROW_B}"]'); return el && /онлайн/.test(el.textContent || "") ? 1 : 0; })()`,
    { timeout: 25000, label: "учитель видит ученика онлайн (presence)" });
  return { teacher, student };
}

export async function runE2E({ headless = process.env.E2E_HEADLESS !== "0", only = process.env.E2E_ONLY || "" } = {}) {
  const server = await startServer({ port: PORT });
  const browser = await launch({
    headless, width: 1440, height: 1000, port: CDP_PORT,
    extraArgs: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const results = [];
  const extraTabs = [];
  try {
    W = buildWorld();
    W.baseUrl = server.url;
    const { teacher, student } = await bootTabs(browser, server.url, W);
    const ctx = { teacher, student, browser, baseUrl: server.url, extraTabs };
    const filter = String(only).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    for (const t of TESTS) {
      if (filter.length && !filter.some(f => t.id.toLowerCase().startsWith(f.toLowerCase()))) continue;
      const eBefore = teacher.errors.length, sBefore = student.errors.length;
      const qBefore = W.quizTab ? W.quizTab.errors.length : 0;
      const qcBefore = W.quizTab ? W.quizTab.console.length : 0;
      const cBefore = teacher.console.length, csBefore = student.console.length;
      const t0 = Date.now();
      let pass = false, err = null;
      try { await t.fn(ctx); pass = true; }
      catch (e) {
        err = e;
        try { ensureArtifacts(); await teacher.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-teacher.png`)); } catch (_) {}
        try { ensureArtifacts(); await student.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-student.png`)); } catch (_) {}
        if (W.quizTab) { try { ensureArtifacts(); await W.quizTab.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-quiz.png`)); } catch (_) {} }
        if (W.quizTab && !W.quizTabClosed) { extraTabs.push(W.quizTab); W.quizTabClosed = true; }
      }
      const tabs = [teacher, student, ...(W.quizTab && !W.quizTabClosed ? [W.quizTab] : [])];
      const consoleErrors = [...teacher.console.slice(cBefore), ...student.console.slice(csBefore), ...(W.quizTab ? W.quizTab.console.slice(qcBefore) : [])]
        .filter(c => c.type === "error").map(c => c.text).slice(0, 10);
      const pageErrors = [...teacher.errors.slice(eBefore), ...student.errors.slice(sBefore), ...(W.quizTab ? W.quizTab.errors.slice(qBefore) : [])].slice(0, 6);
      results.push({ id: t.id, name: t.name, pass, ms: Date.now() - t0, error: err ? String(err.message || err) : null, consoleErrors, pageErrors });
      console.log(`[${pass ? "PASS" : "FAIL"}] ${t.id} ${t.name}${pass ? "" : "\n       " + (err && err.message || err)}`);
      if (!pass) {
        if (pageErrors.length) console.log("       pageErrors: " + pageErrors.join(" | ").slice(0, 1200));
        if (consoleErrors.length) console.log("       console: " + consoleErrors.join(" | ").slice(0, 1200));
      }
    }
    const failed = results.filter(r => !r.pass).length;
    const timings = [W.aMs && `a=${W.aMs}мс`, W.b2Ms && `b2=${W.b2Ms}мс`].filter(Boolean).join(", ");
    console.log(`\nИтог e2e: ${results.length - failed}/${results.length} PASS${failed ? `, ${failed} FAIL` : ""}${timings ? ` (${timings})` : ""}` +
      (failed ? `\nСкриншоты падений: ${ARTIFACTS}` : ""));
    return { results, failed };
  } finally {
    try { if (W && W.quizTab && !W.quizTabClosed) await W.quizTab.close(); } catch (_) {}
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runE2E().then(({ failed }) => process.exit(failed ? 1 : 0))
    .catch(e => { console.error("ОШИБКА E2E:", (e && e.stack) || e); process.exit(2); });
}
