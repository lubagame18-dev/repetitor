/* Самопроверка мока Supabase без браузера: две «вкладки» в vm с общими localStorage/BroadcastChannel.
   Проверяет auth/rpc/from/channel/broadcast/presence/board_* — то, на чём стоят e2e-сценарии.
   Запуск: node _test/mock-selftest.mjs (быстро, Chrome не нужен). */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SRC = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const TEACHER_ID = "t-1001";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeShared() {
  const store = new Map();
  const listeners = new Set();
  const instances = [];
  const local = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  class BroadcastChannel {
    constructor(name) { this.name = name; this.onmessage = null; instances.push(this); }
    postMessage(msg) {
      const data = JSON.parse(JSON.stringify(msg));
      setTimeout(() => {
        instances.forEach(b => {
          if (b !== this && b.name === this.name && typeof b.onmessage === "function") {
            try { b.onmessage({ data }); } catch (e) { console.error("bc handler", e); }
          }
        });
      }, 0);
    }
    close() { const i = instances.indexOf(this); if (i >= 0) instances.splice(i, 1); }
  }
  return { local, BroadcastChannel };
}
function makeTab(shared, cfg) {
  const win = { localStorage: shared.local, BroadcastChannel: shared.BroadcastChannel, __MOCK_CFG: cfg, console };
  const box = {
    window: win, localStorage: shared.local, BroadcastChannel: shared.BroadcastChannel,
    console, JSON, Date, Math, Promise, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    __MOCK_CFG: cfg,
  };
  vm.createContext(box);
  vm.runInContext(MOCK_SRC, box, { filename: "mock-supabase.js" });
  const client = win.supabase.createClient();
  return { win, client };
}
let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log("[PASS] " + name); }
  else { failed++; console.log("[FAIL] " + name + (extra ? " — " + JSON.stringify(extra) : "")); }
}

const ROW_A = 501, ROW_B = 502, TOKEN_B = "TOKEN-STUDENT-B";
const course = key => ({ course: "Курс " + key, tag: "", goal: "Школа", grade: 5, blocks: { own: { name: "Уроки", color: "#888" } }, lessons: [{ id: key + "-1", title: "Урок 1", theory: [{ h: "Правило", t: "Текст" }], practice: [], test: [], hwtest: [] }], texts: {}, izl: {}, criteria: { errors: [], essay: [], izl: [] }, methodology: [] });
/* Тест по темам: учитель собрал его для строки B; RPC ниже проверяются как в schema.sql. */
const QZ_ID = "qzmock01";
const QZ_TOPIC = { id: "math-5-1", title: "Урок 1" };
const QZ_DATA = {
  title: "Тест по темам: Урок 1", subject: "math", grade: 5, topics: [QZ_TOPIC],
  questions: [
    { q: "Сколько будет 1+1?", o: ["1", "2", "3", "4"], a: 1, e: "Один плюс один – два.", topic: QZ_TOPIC.title, topicId: QZ_TOPIC.id },
    { q: "Сколько будет 2+2?", o: ["3", "4", "5", "6"], a: 1, e: "Два плюс два – четыре.", topic: QZ_TOPIC.title, topicId: QZ_TOPIC.id },
  ],
};
const QUIZZES = [{ id: QZ_ID, teacher_id: TEACHER_ID, student_id: ROW_B, title: QZ_DATA.title, course: "math-5", data: QZ_DATA, created_at: "2026-11-04T10:00:00.000Z" }];
const db = {
  seq: 5000,
  tokens: { [TOKEN_B]: ROW_B, "TOKEN-STUDENT-A": ROW_A },
  tables: {
    students: [
      { id: ROW_A, teacher_id: TEACHER_ID, name: "Аня", course: "rus-5", subject: "ru", grade: 5, person_id: 900, code: "A", dates: {}, unlocked: [], invite_token: "", start_date: null },
      { id: ROW_B, teacher_id: TEACHER_ID, name: "Аня", course: "math-5", subject: "math", grade: 5, person_id: 900, code: "B", dates: {}, unlocked: [], invite_token: "", start_date: null },
    ],
    teachers: [{ id: TEACHER_ID, name: "Учитель", base: true, base_access: [], role: "teacher" }],
    materials: [], course_data: [{ key: "rus-5", data: course("rus-5") }, { key: "math-5", data: course("math-5") }],
    board_items: [], app_settings: [], results: [], homework: [], writings: [], sheets: [], activity: [], ai_reports: [], works: [],
    topic_quizzes: QUIZZES, topic_quiz_results: [],
  },
};
const shared = makeShared();
const teacher = makeTab(shared, { session: { access_token: "x", user: { id: TEACHER_ID, email: "t@t" } }, reset: true, db });
const student = makeTab(shared, { session: null, reset: false, db });

const t0 = Date.now();

// 1. auth / me / students / course_data
const me = await teacher.client.rpc("me");
ok(me.data && me.data.id === TEACHER_ID, "rpc me возвращает учителя", me);
const st = await teacher.client.from("students").select("id,name").order("created_at");
ok(st.data && st.data.length === 2 && !st.error, "from students: две строки ученика", st);
const cd = await teacher.client.from("course_data").select("key,data,keys").in("key", ["rus-5", "math-5"]);
ok(cd.data && cd.data.length === 2 && cd.data.some(r => r.key === "rus-5" && r.data.lessons.length), "from course_data по .in(key)", cd.data && cd.data.map(r => r.key));

// 2. student_state / student_switch
const stB = await student.client.rpc("student_state", { p_code: TOKEN_B });
ok(stB.data && stB.data.profile.id === ROW_B && stB.data.profile.subject === "math" && stB.data.course_data, "student_state: профиль B и course_data", stB.data && { id: stB.data.profile.id, subj: stB.data.profile.subject, cd: !!stB.data.course_data });
ok(stB.data.profile.subjects.length === 2 && stB.data.profile.subjects.some(s => s.subject === "ru"), "student_state: subjects содержит оба предмета");
const wrong = await student.client.rpc("student_state", { p_code: "BAD-TOKEN" });
ok(wrong.data === null && !wrong.error, "student_state по неизвестному токену → null");
const sw = await student.client.rpc("student_switch", { p_code: TOKEN_B, p_target: ROW_A });
ok(sw.data && sw.data.token && sw.data.profile.id === ROW_A && sw.data.profile.subject === "ru", "student_switch на строку A", sw.data && sw.data.profile);
const stA = await student.client.rpc("student_state", { p_code: sw.data.token });
ok(stA.data && stA.data.profile.course === "rus-5", "student_state по новому токену (курс A)");

// 3. каналы: presence и broadcast между вкладками
let presenceEvents = 0, gotCmd = null;
const teacherCh = teacher.client.channel("live-" + TEACHER_ID, { config: { broadcast: { self: false }, presence: { key: "t-" + TEACHER_ID } } });
teacherCh.on("presence", { event: "sync" }, () => { presenceEvents++; });
teacherCh.on("broadcast", { event: "cmd" }, ({ payload }) => { gotCmd = payload; });
teacherCh.subscribe(() => {});
const studentCh = student.client.channel("live-" + TEACHER_ID, { config: { broadcast: { self: false }, presence: { key: "s-" + ROW_B } } });
studentCh.on("broadcast", { event: "cmd" }, ({ payload }) => { gotCmd = payload; });
studentCh.subscribe(() => {});
studentCh.track({ role: "student", id: ROW_B, person: 900, ids: [ROW_A, ROW_B], subj: "math", name: "Аня", where: "на главной" });
await sleep(120);
const pres = teacherCh.presenceState();
const flat = Object.values(pres).flat();
ok(flat.some(p => p.role === "student" && p.ids && p.ids.includes(ROW_A)), "presence: учитель видит ids ученика (обе строки)", pres);
ok(presenceEvents > 0, "presence: событие sync дошло до учителя", presenceEvents);
teacherCh.send({ type: "broadcast", event: "cmd", payload: { cmd: true, to: ROW_B, type: "lesson", subj: "math", course: "math-5", lesson: "math-5-1", title: "Урок 1" } });
await sleep(80);
ok(gotCmd && gotCmd.cmd && gotCmd.to === ROW_B && gotCmd.subj === "math", "broadcast cmd: ученик получил команду урока", gotCmd);

// 4. доска: insert/select/single у учителя и rpc board_load/add/remove у ученика
const ins = await teacher.client.from("board_items")
  .insert({ student_id: ROW_A, lesson_id: "rus-5-1:practice", item: { t: "s", p: [[1, 2]] }, author: "teacher" })
  .select("id").single();
ok(ins.data && ins.data.id, "from board_items insert().select('id').single()", ins);
const teacherLoad = await teacher.client.from("board_items").select("id,item").eq("student_id", ROW_A).eq("lesson_id", "rus-5-1:practice").order("id");
ok(teacherLoad.data.length === 1 && teacherLoad.data[0].item.t === "s", "from board_items select с фильтрами", teacherLoad.data);
const studentLoad = await student.client.rpc("board_load", { p_code: sw.data.token, p_lesson: "rus-5-1:practice" });
ok(studentLoad.data && studentLoad.data.length === 1 && studentLoad.data[0].item.t === "s", "board_load ученика по токену строки A", studentLoad);
const add = await student.client.rpc("board_add", { p_code: sw.data.token, p_lesson: "rus-5-1:practice", p_item: { t: "t", s: "привет" } });
ok(add.data && add.data !== ins.data.id, "board_add ученика", add);
const after = await teacher.client.from("board_items").select("id").eq("student_id", ROW_A).order("id");
ok(after.data.length === 2, "учитель видит объект ученика (общая таблица)", after.data);
const rm = await student.client.rpc("board_remove", { p_code: sw.data.token, p_lesson: "rus-5-1:practice", p_ids: [add.data] });
ok(rm.data === true, "board_remove ученика");
const after2 = await teacher.client.from("board_items").select("id").eq("student_id", ROW_A).order("id");
ok(after2.data.length === 1, "после board_remove остался один объект", { after: after2.data, rm, addedId: add.data, token: sw.data.token, tokens: student.win.__MOCK.tokens(), studentDb: student.win.__MOCK.dbTable("board_items"), ls: (shared.local.getItem("mock-db-v1") || "").slice(0, 260) });

// 4b. карточка учителя «доска ученика»: board_items читаются по student_id и группируются по lesson_id,
//     личная доска ("free:p1") — отдельно от уроков; чужие строки не попадают; works по student_id (прогресс self).
await teacher.client.from("board_items").insert({ student_id: ROW_A, lesson_id: "free:p1", item: { t: "s", p: [[3, 4]] }, author: "student" }).select("id").single();
await teacher.client.from("board_items").insert({ student_id: ROW_B, lesson_id: "math-5-1:practice", item: { t: "s", p: [[5, 6]] }, author: "student" }).select("id").single();
const boardA = await teacher.client.from("board_items").select("lesson_id,item").eq("student_id", ROW_A).order("lesson_id");
const lessonKeysA = [...new Set((boardA.data || []).map(r => r.lesson_id))].sort();
ok(lessonKeysA.length === 2 && lessonKeysA.includes("free:p1") && lessonKeysA.includes("rus-5-1:practice"), "board_items по student_id: строки rowA по двум листам (урок + личная доска), чужие не попали", lessonKeysA);
const onlyFree = await teacher.client.from("board_items").select("lesson_id").eq("student_id", ROW_A).in("lesson_id", ["free:p1"]);
ok(onlyFree.data && onlyFree.data.length === 1 && onlyFree.data[0].lesson_id === "free:p1", "board_items .in(lesson_id) для строки доски", onlyFree.data);
await student.client.rpc("student_save_work", { p_code: sw.data.token, p_lesson: "self:stress", p_task: 0, p_data: { mastered: ["аэропорты"], done: false, total: 15, errors: {} } });
const selfWorks = await teacher.client.from("works").select("lesson_id,task,data").eq("student_id", ROW_A).order("task");
ok(selfWorks.data && selfWorks.data.length >= 1 && selfWorks.data.some(w => w.lesson_id === "self:stress" && +w.task === 0 && w.data && w.data.total === 15), "works по student_id: учитель видит прогресс самообучения ученика", selfWorks.data);
const limitedItems = await teacher.client.from("board_items").select("id").eq("student_id", ROW_A).order("id").limit(1);
ok(limitedItems.data && limitedItems.data.length === 1, "board_items .order().limit() как в реальном from()", limitedItems.data);

// 5. update/upsert/delete через from
const upd = await teacher.client.from("students").update({ call_url: "https://call" }).eq("id", ROW_A);
ok(!upd.error, "from students update");
const updCheck = await teacher.client.from("students").select("id,call_url").eq("id", ROW_A).single();
ok(updCheck.data && updCheck.data.call_url === "https://call", "students update сохранил call_url", updCheck.data);
const ups = await teacher.client.from("sheets").upsert({ teacher_id: TEACHER_ID, course: "rus-5", lesson_id: "rus-5-1", name: "Лист", url: "u" }, { onConflict: "teacher_id,course,lesson_id" });
ok(!ups.error, "from sheets upsert");
const del = await teacher.client.from("board_items").delete().eq("student_id", ROW_A);
const delLeft = (await teacher.client.from("board_items").select("id").eq("student_id", ROW_A)).data || [];
ok(!del.error && delLeft.length === 0, "from board_items delete с фильтром");

// 6. shared DB: ученик видит то, что записал учитель
const shared2 = await student.client.rpc("board_load", { p_code: sw.data.token, p_lesson: "rus-5-1:practice" });
ok(shared2.data && shared2.data.length === 0, "ученик видит удаление, сделанное учителем (общая база)");

// 7. AI generate_tasks: детерминированные вопросы с объяснением и темой (форма data у teacher.ai())
const aiRes = await teacher.client.functions.invoke("ai", { body: { action: "generate_tasks", topic: "Урок 1", count: 2, grade: 5 } });
const aiTest = aiRes.data && aiRes.data.test;
ok(!aiRes.error && Array.isArray(aiTest) && aiTest.length === 2 && aiTest.every(q => q.q && Array.isArray(q.o) && q.o.length === 4 && Number.isInteger(q.a) && q.e && q.tag), "functions.invoke ai generate_tasks → data.test (2 вопроса с o/a/e/tag)", aiRes.data);
ok(aiTest && aiTest.every(q => q.tag === "Урок 1"), "у вопросов ИИ tag = тема", aiTest && aiTest.map(q => q.tag));
const ai3 = await teacher.client.functions.invoke("ai", { body: { action: "generate_tasks", topic: "Тема", count: 9 } });
ok(ai3.data.test.length === 3, "мок ИИ отдаёт не больше 3 вопросов", ai3.data.test.length);
/* build_lesson (task-24/25): полноценный урок для любого предмета/класса */
const aiLesson = await teacher.client.functions.invoke("ai", { body: { action: "build_lesson", subject: "hist", grade: 6, topic: "Древняя Русь" } });
const L = aiLesson.data || {};
ok(!aiLesson.error && L.title && Array.isArray(L.theory) && L.theory.length === 2 && L.theory.every(x => x.h && x.t)
  && Array.isArray(L.practice) && L.practice.length === 2 && Array.isArray(L.test) && L.test.length === 2 && L.method,
  "functions.invoke ai build_lesson → {title,theory[2],practice[2],test[2],method}",
  { title: L.title, theory: (L.theory || []).length, practice: (L.practice || []).length, test: (L.test || []).length, method: !!L.method });
/* generate_theory/generate_content — для кнопки «Сгенерировать материал» в панели учителя */
const aiTheory = await teacher.client.functions.invoke("ai", { body: { action: "generate_theory", topic: "Спряжение", subject: "rus", grade: 5 } });
ok(aiTheory.data && Array.isArray(aiTheory.data.theory) && aiTheory.data.theory.length >= 1 && Array.isArray(aiTheory.data.test),
  "functions.invoke ai generate_theory → theory + test (для «Сгенерировать материал»)", aiTheory.data && { theory: (aiTheory.data.theory || []).length, test: (aiTheory.data.test || []).length });

// 8. quiz_get / student_quizzes: контракт schema.sql
const qg = await student.client.rpc("quiz_get", { p_token: QZ_ID });
ok(qg.data && qg.data.id === QZ_ID && qg.data.data.questions.length === 2 && qg.data.data.topics.length === 1, "quiz_get по токену отдаёт data теста", qg.data && { id: qg.data.id, q: qg.data.data.questions.length });
const qgBad = await student.client.rpc("quiz_get", { p_token: "нет-такого" });
ok(qgBad.data === null && !qgBad.error, "quiz_get по неизвестному токену → null");
const qgShort = await student.client.rpc("quiz_get", { p_token: "abc" });
ok(qgShort.data === null, "quiz_get по слишком короткому токену → null");
const sq0 = await student.client.rpc("student_quizzes", { p_code: TOKEN_B });
ok(sq0.data && Array.isArray(sq0.data.quizzes) && sq0.data.quizzes.length === 1 && sq0.data.quizzes[0].id === QZ_ID && sq0.data.quizzes[0].questions === 2 && sq0.data.quizzes[0].last === null, "student_quizzes: список тестов ученика (last=null до попытки)", sq0.data && sq0.data.quizzes);

// 9. quiz_submit: результат, needs_work, детали тем + валидации как в schema.sql
const DETAILS = {
  questions: [
    { i: 0, topic: QZ_TOPIC.title, topicId: QZ_TOPIC.id, first: false, attempts: 2, ok: false, picked: 0 },
    { i: 1, topic: QZ_TOPIC.title, topicId: QZ_TOPIC.id, first: false, attempts: 2, ok: true, picked: 1 },
  ],
  topics: [{ id: QZ_TOPIC.id, title: QZ_TOPIC.title, total: 2, ok: 1, first: 0, needsWork: true }],
};
const sub = await student.client.rpc("quiz_submit", { p_code: TOKEN_B, p_token: QZ_ID, p_score: 1, p_total: 2, p_details: DETAILS, p_needs_work: [QZ_TOPIC.title] });
ok(!sub.error && sub.data === null, "quiz_submit принят (returns void → data null)", sub);
const rows = student.win.__MOCK.dbTable("topic_quiz_results");
ok(rows.length === 1 && rows[0].quiz_id === QZ_ID && rows[0].student_id === ROW_B && rows[0].score === 1 && rows[0].total === 2 && Array.isArray(rows[0].needs_work) && rows[0].needs_work[0] === QZ_TOPIC.title && rows[0].details.topics[0].needsWork === true, "quiz_submit записал результат (score/total/details/needs_work)", rows[0]);
const sq1 = await student.client.rpc("student_quizzes", { p_code: TOKEN_B });
ok(sq1.data && sq1.data.results.length === 1 && sq1.data.results[0].score === 1 && sq1.data.results[0].details.topics.length === 1 && sq1.data.results[0].needs_work[0] === QZ_TOPIC.title, "student_quizzes: result с details.topics и needs_work", sq1.data && sq1.data.results[0]);
ok(sq1.data && sq1.data.quizzes[0].last && sq1.data.quizzes[0].last.score === 1 && sq1.data.quizzes[0].last.total === 2, "student_quizzes: last = последняя попытка", sq1.data && sq1.data.quizzes[0].last);

const badCode = await student.client.rpc("quiz_submit", { p_code: "BAD-CODE", p_token: QZ_ID, p_score: 1, p_total: 2 });
ok(!!badCode.error, "quiz_submit неизвестный код → error (unknown code)", badCode.error);
const badScore = await student.client.rpc("quiz_submit", { p_code: TOKEN_B, p_token: QZ_ID, p_score: 3, p_total: 2 });
ok(!!badScore.error, "quiz_submit score > total → error (bad score)", badScore.error);
const badQuiz = await student.client.rpc("quiz_submit", { p_code: TOKEN_B, p_token: "нет-такого", p_score: 0, p_total: 2 });
ok(!!badQuiz.error, "quiz_submit неизвестный тест → error (quiz not found)", badQuiz.error);
const foreign = await student.client.rpc("quiz_submit", { p_code: "TOKEN-STUDENT-A", p_token: QZ_ID, p_score: 0, p_total: 2 });
ok(!!foreign.error, "quiz_submit чужой тест (student_id другой строки) → error", foreign.error);

// 10. ручное «пройдено»: covered + covered_manual отдельно от results (from students update)
const covUpd = await teacher.client.from("students").update({ covered: { "math-5-1": "2026-11-04" }, covered_manual: { "math-5-1": "2026-11-04" } }).eq("id", ROW_B);
ok(!covUpd.error, "from students update covered/covered_manual");
const covRow = await teacher.client.from("students").select("id,covered,covered_manual").eq("id", ROW_B).single();
ok(covRow.data && covRow.data.covered["math-5-1"] === "2026-11-04" && covRow.data.covered_manual["math-5-1"] === "2026-11-04", "у ученика записаны covered и covered_manual", covRow.data);

// 11. НАШИ таблицы переименованы в topic_quizzes/topic_quiz_results (v57, чтобы не задеть legacy «Учу по ФРП»):
//     учитель читает их через from(), insert проставляет teacher_id = auth.uid(), как default в schema.sql.
const tqSel = await teacher.client.from("topic_quizzes").select("*").order("created_at", { ascending: false });
ok(!tqSel.error && Array.isArray(tqSel.data) && tqSel.data.length === 1 && tqSel.data[0].id === QZ_ID, "from topic_quizzes: учитель видит свои тесты", tqSel.data && tqSel.data.map(q => q.id));
const tqrSel = await teacher.client.from("topic_quiz_results").select("*").order("created_at", { ascending: false });
ok(!tqrSel.error && Array.isArray(tqrSel.data) && tqrSel.data.length === 1 && tqrSel.data[0].quiz_id === QZ_ID, "from topic_quiz_results: попытки тестов", tqrSel.data && tqrSel.data.length);
const tqIns = await teacher.client.from("topic_quizzes").insert({ id: "qzmock02", student_id: ROW_B, title: "Тест 2", course: "math-5", data: QZ_DATA }).select().single();
ok(tqIns.data && tqIns.data.id === "qzmock02" && tqIns.data.teacher_id === TEACHER_ID, "insert topic_quizzes: id сохранён, teacher_id = auth.uid()", tqIns.data && { id: tqIns.data.id, teacher_id: tqIns.data.teacher_id });
const legacyQuizzes = await teacher.client.from("quizzes").select("*");
ok(!legacyQuizzes.error && Array.isArray(legacyQuizzes.data) && legacyQuizzes.data.length === 0, "legacy-таблица quizzes мок-БД не затрагивается (пустая)", legacyQuizzes.data);

// 12. самообучение: student_save_work (works upsert) и student_submit_result (kind self), как в schema.sql
const STRESS_DATA = { done: true, mastered: ["аэропОрты", "бАнты"], errors: { "дОговор": 2 }, at: "2026-11-04T20:00:00.000Z" };
const sw1 = await student.client.rpc("student_save_work", { p_code: TOKEN_B, p_lesson: "self:stress", p_task: 0, p_data: STRESS_DATA });
ok(!sw1.error && sw1.data === null, "student_save_work self:stress принят (void)", sw1);
/* строк в works может быть больше (например, прогресс rowA из проверки карточки учителя) — проверяем строку именно rowB */
const worksB = () => student.win.__MOCK.dbTable("works").filter(w => String(w.student_id) === String(ROW_B) && w.lesson_id === "self:stress");
const worksRows = worksB();
ok(worksRows.length === 1 && +worksRows[0].task === 0 && worksRows[0].data.done === true && worksRows[0].data.mastered.length === 2, "student_save_work записал works self:stress", student.win.__MOCK.dbTable("works"));
const sw2 = await student.client.rpc("student_save_work", { p_code: TOKEN_B, p_lesson: "self:stress", p_task: 0, p_data: { ...STRESS_DATA, done: false } });
const worksB2 = worksB();
ok(!sw2.error && worksB2.length === 1 && worksB2[0].data.done === false, "повторный student_save_work обновляет ту же строку (upsert)", sw2.error);
const stSelf = await student.client.rpc("student_state", { p_code: TOKEN_B });
const savedWork = stSelf.data && (stSelf.data.works || []).find(w => w.lesson_id === "self:stress" && +w.task === 0);
ok(savedWork && savedWork.data && Array.isArray(savedWork.data.mastered), "student_state.works возвращает прогресс самообучения", savedWork);
const sr = await student.client.rpc("student_submit_result", { p_code: TOKEN_B, p_lesson: "self:stress:0", p_score: 15, p_total: 15, p_wrong: ["дОговор"], p_kind: "self" });
ok(!sr.error && sr.data === null, "student_submit_result kind self принят (void)", sr);
const resRows = student.win.__MOCK.dbTable("results");
ok(resRows.length === 1 && resRows[0].lesson_id === "self:stress:0" && resRows[0].kind === "self" && resRows[0].score === 15 && resRows[0].total === 15 && resRows[0].wrong[0] === "дОговор", "result kind self записан в results", resRows);
const stSelf2 = await student.client.rpc("student_state", { p_code: TOKEN_B });
ok(stSelf2.data && stSelf2.data.results.some(r => r.kind === "self" && r.lesson_id === "self:stress:0" && r.score === 15), "student_state.results содержит результат self", stSelf2.data && stSelf2.data.results);
const tRes = await teacher.client.from("results").select("*").eq("student_id", ROW_B).eq("kind", "self");
ok(tRes.data && tRes.data.length === 1 && tRes.data[0].lesson_id === "self:stress:0", "учитель видит self-результат через from(results)", tRes.data);
const swBad = await student.client.rpc("student_save_work", { p_code: TOKEN_B, p_lesson: "self:stress", p_task: 1, p_data: { big: "x".repeat(51000) } });
ok(!!swBad.error, "student_save_work слишком большие data → error (too big)", swBad.error);
const srBad = await student.client.rpc("student_submit_result", { p_code: TOKEN_B, p_lesson: "self:stress:0", p_score: 5, p_total: 3, p_kind: "self" });
ok(!!srBad.error, "student_submit_result score > total → error (bad score)", srBad.error);

// 13. свои наборы учителя (конструктор самообучения): materials kind "tasks"/lesson_id "self",
//     учитель создаёт/правит/удаляет, ученик получает их в student_state.materials
const setIns = await teacher.client.from("materials")
  .insert({ kind: "tasks", lesson_id: "self", course: "math-5", title: "Слова от учителя",
    data: { kind: "self-stress", words: ["звонИть", "тОрты", "бАнты"] }, shared: false, student_id: null })
  .select().single();
ok(setIns.data && setIns.data.id && setIns.data.teacher_id === TEACHER_ID && setIns.data.data.kind === "self-stress" && setIns.data.data.words.length === 3, "materials insert: свой stress-набор (kind=tasks, lesson_id=self, teacher_id)", setIns.data);
const setsList = await teacher.client.from("materials").select("*").eq("kind", "tasks").eq("lesson_id", "self").eq("course", "math-5");
ok(setsList.data && setsList.data.length === 1 && setsList.data[0].title === "Слова от учителя", "materials select: учитель видит свои наборы (kind+lesson_id+course)", setsList.data && setsList.data.map(m => m.title));
const stMats = await student.client.rpc("student_state", { p_code: TOKEN_B });
ok(stMats.data && (stMats.data.materials || []).some(m => m.id === setIns.data.id && m.data && m.data.kind === "self-stress"), "student_state.materials: ученик получает свой набор учителя", stMats.data && (stMats.data.materials || []).slice(-2));
const setUpd = await teacher.client.from("materials").update({ title: "Слова от учителя 2" }).eq("id", setIns.data.id);
const stMats2 = await student.client.rpc("student_state", { p_code: TOKEN_B });
ok(!setUpd.error && (stMats2.data.materials || []).some(m => m.id === setIns.data.id && m.title === "Слова от учителя 2"), "materials update: новое название видно ученику", stMats2.data && (stMats2.data.materials || []).find(m => m.id === setIns.data.id));
const setDel = await teacher.client.from("materials").delete().eq("id", setIns.data.id);
const leftSets = await teacher.client.from("materials").select("id").eq("kind", "tasks").eq("lesson_id", "self");
ok(!setDel.error && (leftSets.data || []).length === 0, "materials delete: свой набор удалён", leftSets.data);

// 14. формы для графика динамики (Trend.pointsFromRows/pointsFromQuizzes): results и topic_quiz_results
//     должны отдавать created_at/kind/score/total (и сортироваться по created_at)
await teacher.client.from("results").insert([
  { id: 9501, student_id: ROW_B, lesson_id: "math-5-1", kind: "lesson", score: 5, total: 10, wrong: [], created_at: "2026-10-01T10:00:00.000Z" },
  { id: 9502, student_id: ROW_B, lesson_id: "math-5-1", kind: "self", score: 9, total: 10, wrong: [], created_at: "2026-10-02T10:00:00.000Z" },
]).select("id");
const trendR = await teacher.client.from("results").select("created_at,kind,score,total").eq("student_id", ROW_B).order("created_at");
ok(Array.isArray(trendR.data) && trendR.data.length >= 2 && trendR.data[0].created_at < trendR.data[trendR.data.length - 1].created_at
  && trendR.data.every(r => r.created_at && typeof r.kind === "string" && +r.total > 0 && +r.score >= 0),
  "results: поля и порядок created_at для графика динамики", trendR.data && trendR.data.slice(-3));
const trendQ = await teacher.client.from("topic_quiz_results").select("created_at,score,total,quiz_id").eq("student_id", ROW_B).order("created_at");
ok(Array.isArray(trendQ.data) && trendQ.data.length >= 1
  && trendQ.data.every(r => r.created_at && +r.total > 0 && r.quiz_id),
  "topic_quiz_results: created_at/score/total/quiz_id для графика", trendQ.data);

// 15. управляемые задержки/ошибки мока (W1: кабинет учителя на планшете): по умолчанию без эффекта
const ctrlDefault = await teacher.client.from("students").select("id");
ok(Array.isArray(ctrlDefault.data) && !ctrlDefault.error, "mock controls: по умолчанию from(students) без ошибок/задержек", ctrlDefault.error);
teacher.win.__MOCK.fail("students", "нет сети");
const ctrlFail = await teacher.client.from("students").select("id");
ok(ctrlFail.data === null && ctrlFail.error && /нет сети/.test(ctrlFail.error.message),
  "mock fail(table): from(students).select → {data:null,error:{message}}", ctrlFail.error);
teacher.win.__MOCK.clearControls();
teacher.win.__MOCK.delay("topic_quizzes", 80);
const tDelay = Date.now();
const ctrlDelayed = await teacher.client.from("topic_quizzes").select("id");
const dDelay = Date.now() - tDelay;
teacher.win.__MOCK.clearControls();
ok(!ctrlDelayed.error && dDelay >= 60, "mock delay(table): select ждёт ≥60 мс и возвращает данные", { ms: dDelay, error: ctrlDelayed.error });
teacher.win.__MOCK.failRpc("me", "rpc нет сети");
const ctrlRpc = await teacher.client.rpc("me", {});
teacher.win.__MOCK.clearControls();
ok(ctrlRpc.data === null && ctrlRpc.error && /нет сети/.test(ctrlRpc.error.message),
  "mock failRpc(me): rpc → {data:null,error}", ctrlRpc.error);

console.log(`\nИтог self-test мока: ${passed}/${passed + failed} PASS, ${Date.now() - t0} мс`);
process.exit(failed ? 1 : 0);
