// Серверная функция «ai»: нейросеть для платформы репетитора + загрузка фото работ учеников.
// Ключи нейросети хранятся в таблице app_secrets (их вводит разработчик в кабинете разработчика) –
// на сайт они не попадают. Функция читает их служебным ключом, который Supabase даёт ей сам.
//
// Действия (поле action в теле запроса):
//   check_essay      – учитель: черновая оценка сочинения/изложения по критериям ОГЭ (учитель потом утверждает)
//   analyze_student  – учитель: разбор результатов ученика и предложения к плану
//   generate_tasks   – учитель: мини-практика и тест по теме урока
//   upload_work      – ученик: фото рукописной работы (по личному ключу ученика)
//   ocr_work         – учитель: распознать текст с фото рукописной работы (модель с поддержкой изображений)
//   edit_lesson      – учитель: дописать или исправить блок теории / задания практики по запросу
//   test_key         – разработчик: проверить, что ключ работает
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Провайдеры с OpenAI-совместимым API
const PROVIDERS: Record<string, { url: string; model: string }> = {
  deepseek:   { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat" },
  aitunnel:   { url: "https://api.aitunnel.ru/v1/chat/completions", model: "deepseek-chat" },
  openai:     { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function secrets() {
  const { data } = await admin.from("app_secrets").select("key,value");
  return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

async function ask(system: string, user: string, maxTokens = 1800) {
  const s = await secrets();
  const prov = s.ai_provider || "deepseek";
  const p = PROVIDERS[prov] || PROVIDERS.deepseek;
  const key = s[`key_${prov}`];
  if (!key) throw new Error(`Нет ключа для «${prov}». Его вводит разработчик в кабинете разработчика.`);
  const r = await fetch(s.ai_url || p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: s.ai_model || p.model, temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Нейросеть ответила ошибкой ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const out = await r.json();
  const txt: string = out.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); }
  catch { return { raw: txt }; }
}

// Распознавание фото: нужна модель, которая понимает изображения (у DeepSeek такой нет – берём другой ключ, если он есть)
const VISION: Record<string, string> = { openai: "gpt-4o-mini", openrouter: "openai/gpt-4o-mini", aitunnel: "gpt-4o-mini" };
async function askVision(system: string, text: string, images: string[], maxTokens = 3000) {
  const s = await secrets();
  const order = [s.ai_provider, "openrouter", "aitunnel", "openai"].filter((p, i, a) => p && VISION[p] && a.indexOf(p) === i);
  const prov = order.find((p) => s[`key_${p}`]);
  if (!prov) throw new Error("Для распознавания фото нужен ключ OpenRouter, AITunnel или OpenAI (DeepSeek не читает изображения). Его вводит разработчик.");
  const r = await fetch(PROVIDERS[prov].url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s[`key_${prov}`]}` },
    body: JSON.stringify({
      model: s.ai_vision_model || VISION[prov], temperature: 0, max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text }, ...images.slice(0, 6).map((url) => ({ type: "image_url", image_url: { url } }))] }],
    }),
  });
  if (!r.ok) throw new Error(`Нейросеть ответила ошибкой ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const out = await r.json();
  return String(out.choices?.[0]?.message?.content || "").trim();
}

const RULES_OGE = `Ты – опытный эксперт ОГЭ по русскому языку (критерии 2027 года). Пиши по-русски, коротко и доброжелательно, обращайся к ученику на «ты» в поле comment.
Сочинение 13.1/13.2/13.3: СК1 (0–1) – ответ на вопрос/тезис; СК2 (0–4) – два примера из текста с пояснениями и указанием их смысловой связи (примеры только из текста, у каждого – пояснение; без пояснения пример не засчитывается); СК3 (0–2) – логичность; СК4 (0–1) – композиционная стройность. Если менее 70 слов – 0 баллов за всё.
Сжатое изложение: ИК1 (0–2) – все микротемы; ИК2 (0–3) – приёмы сжатия; ИК3 (0–2) – смысловая цельность, связность, абзацы.
Грамотность считай отдельно: число орфографических (orf), пунктуационных (punct), грамматических (gram) и речевых (speech) ошибок, и фактических (fact).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const action = body.action as string;

    // ---------- ученик: фото работы ----------
    if (action === "upload_work") {
      if (String(body.code || "").length < 32) return json({ error: "Вход устарел" }, 401);
      const { data: srow } = await admin.from("students").select("id").eq("access_token", body.code).maybeSingle();
      const sid = srow?.id;
      if (!sid) return json({ error: "Вход устарел" }, 401);
      const b64 = String(body.data || "").replace(/^data:image\/\w+;base64,/, "");
      if (b64.length > 7_000_000) return json({ error: "Фото слишком большое" }, 400);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `${sid}/${String(body.lesson).replace(/[^\w-]/g, "")}-${Date.now()}.jpg`;
      const { error } = await admin.storage.from("works").upload(path, bytes, { contentType: "image/jpeg" });
      if (error) throw error;
      return json({ url: admin.storage.from("works").getPublicUrl(path).data.publicUrl });
    }

    // ---------- дальше – только вошедший учитель ----------
    const auth = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Нужно войти как учитель" }, 401);
    const uid = u.user.id;
    const { data: me } = await admin.from("teachers").select("role").eq("id", uid).single();
    if (!me) return json({ error: "Нет профиля учителя" }, 403);
    // тарифы: анализ и план – от 300 ₽ (materials), проверка сочинений и задания – 500 ₽ (full)
    const { data: plan } = await admin.rpc("plan_active", { uid });
    const need: Record<string, string[]> = { analyze_student: ["materials", "full"], check_essay: ["full"], ocr_work: ["full"], edit_lesson: ["full"], generate_tasks: ["full"], build_lesson: ["full"], test_key: ["full"] };
    if (need[action] && !need[action].includes(plan as string))
      return json({ error: plan ? "Эта функция нейросети входит в тариф " + (need[action][0] === "full" ? "«Полный» (500 ₽ в месяц)" : "от 300 ₽ в месяц") + "." : "Подписка закончилась – продлите её в разделе «Подписка»." }, 402);
    const own = async (sid: string) => {
      const { data } = await admin.from("students").select("*").eq("id", sid).single();
      if (!data) throw new Error("Это не ваш ученик");
      if (data.teacher_id !== uid) throw new Error("Это не ваш ученик");
      return data;
    };
    /* предмет может быть любой: русский, математика, история… (учитель передаёт subject) */
    const SUBJ = String(body.subject || body.subj || "русский язык").slice(0, 60);

    if (action === "test_key") {
      if (me.role !== "developer") return json({ error: "Только разработчик" }, 403);
      const r = await ask("Ответь JSON.", 'Верни {"ok":true,"hello":"Привет"}', 50);
      return json(r);
    }

    if (action === "check_essay") {
      const st = await own(body.student_id);
      const { data: w } = await admin.from("writings").select("*").eq("student_id", st.id).eq("lesson_id", body.lesson_id).single();
      if (!w) return json({ error: "Работа не найдена" }, 404);
      const isIzl = w.kind === "izl";
      const res = await ask(RULES_OGE + `\nВерни строго JSON: {"scores":{${isIzl ? '"ИК1":0,"ИК2":0,"ИК3":0' : '"СК1":0,"СК2":0,"СК3":0,"СК4":0'}},"errors":{"orf":0,"punct":0,"gram":0,"speech":0,"fact":0},"found":[{"fragment":"…","type":"orf|punct|gram|speech|fact|logic","fix":"…"}],"strengths":"…","comment":"2–4 предложения ученику: что получилось и что исправить"}`,
        `Тип работы: ${w.kind}. ${body.topic ? "Тема: " + body.topic : ""}\n${body.source ? "Исходный текст:\n" + String(body.source).slice(0, 6000) + "\n" : ""}\nРабота ученика (${w.words || "?"} слов):\n${String(w.body || "").slice(0, 8000)}`);
      await admin.from("writings").update({ ai: res }).eq("student_id", st.id).eq("lesson_id", body.lesson_id);
      return json(res);
    }

    if (action === "ocr_work") {
      const st = await own(body.student_id);
      const { data: w } = await admin.from("writings").select("*").eq("student_id", st.id).eq("lesson_id", body.lesson_id).single();
      if (!w?.photos?.length) return json({ error: "У работы нет фото" }, 404);
      const text = await askVision("Ты распознаёшь рукописные работы школьников на русском языке. Перепиши текст с фото дословно, сохраняя ВСЕ ошибки ученика (орфографию, пунктуацию, слова) и деление на абзацы. Ничего не исправляй и не комментируй. Неразборчивое слово пиши в квадратных скобках со знаком вопроса: [слово?]. Страницы идут по порядку.",
        "Перепиши текст работы ученика с фотографий.", w.photos);
      const words = (text.match(/[A-Za-zА-Яа-яЁё0-9]+(?:-[A-Za-zА-Яа-яЁё0-9]+)*/g) || []).length;
      await admin.from("writings").update({ body: text, words }).eq("student_id", st.id).eq("lesson_id", body.lesson_id);
      return json({ text, words });
    }

    if (action === "edit_lesson") {
      // kind: "theory" – блок теории {h,t,list,ex,mini:[{q,a}]}; "practice" – задания [{t,key,items?}]
      const isTh = body.kind === "theory";
      const r = await ask(`Ты – методист и учитель ${SUBJ}. Пиши по-русски, грамотно, для ${body.grade || 9} класса${body.exam ? ", с прицелом на " + body.exam : ""}. Примеры – свои, без копирования сборников. Тире – среднее (–). Не смешивай правила других тем.
${isTh ? 'Верни строго JSON: {"blocks":[{"h":"заголовок","t":"объяснение 1–3 предложения","list":["пункт правила"],"ex":["пример"],"mini":[{"q":"короткий вопрос","a":"ответ|вариант ответа"}]}]}. В каждом блоке 2–4 пункта list, 2–3 примера, 1–2 вопроса mini.'
        : 'Верни строго JSON: {"tasks":[{"t":"формулировка задания (если ученик пишет ответ – «Запишите в поле»)","key":"ключ – полный ответ с пояснением","items":["предложение или слово для работы на листе (необязательно)"]}]}. В items — материал для работы на листе (предложения, слова, выражения, даты); если это русский язык, пропуски букв обозначай «..», а знаки, которые ставит ученик, не пиши.'}`,
        `Урок: «${body.title || ""}». ${body.current ? "Сейчас в уроке:\n" + String(body.current).slice(0, 5000) + "\n" : ""}Запрос учителя: ${String(body.request || "").slice(0, 1500)}. Количество: ${Math.min(Math.max(+body.count || 1, 1), 8)}.`, 2600);
      return json(r);
    }

    if (action === "analyze_student") {
      const st = await own(body.student_id);
      const [{ data: res }, { data: wr }, { data: act }, { data: hw }, { data: qz }] = await Promise.all([
        admin.from("results").select("lesson_id,kind,score,total,wrong,duration_sec,created_at").eq("student_id", st.id).order("created_at"),
        admin.from("writings").select("lesson_id,kind,total,max,errors,status").eq("student_id", st.id),
        admin.from("activity").select("lesson_id,day,seconds").eq("student_id", st.id),
        admin.from("homework").select("lesson_id,status").eq("student_id", st.id),
        admin.from("topic_quiz_results").select("score,total,details,created_at").eq("student_id", st.id).order("created_at", { ascending: false }).limit(12),
      ]);
      /* тесты по темам: по каждой теме – процент верных с первой попытки в каждой попытке, от новых к старым */
      const byTopic: Record<string, number[]> = {};
      for (const q of qz || []) for (const t of (q.details?.topics || [])) {
        if (!t?.title || !t.total) continue;
        (byTopic[t.title] = byTopic[t.title] || []).push(Math.round((+t.first || 0) / +t.total * 100));
      }
      const r = await ask(`Ты – методист-репетитор по предмету «${SUBJ}». Проанализируй успехи ученика для учителя. Пиши КОРОТКО и по делу: учитель читает за полминуты.
Данные: результаты уроков и ДЗ, тесты по темам (тесты_по_темам: тема → проценты верных с первой попытки, первый элемент – самый свежий), письменные работы, время.
Верни строго JSON: {"summary":"ОДНО предложение, до 160 знаков: общий вывод","strengths":["до 3 тем, 1–3 слова каждая"],"weak":[{"topic":"тема","why":"до 10 слов: процент или динамика, например «45%, было 60%»"}],"time":"до 12 слов или пустая строка","plan":[{"title":"что повторить, до 6 слов","why":"до 12 слов","tasks":["до 3 коротких пунктов"]}],"essay":"до 12 слов или пустая строка"}.
Правила: weak – не больше 4 самых слабых тем, сначала самая слабая; plan – не больше 3 пунктов; никаких вступлений, оценок и пересказа данных; не повторяй одно и то же в разных полях; если данных нет – верни пустые списки и пустые строки.`,
        JSON.stringify({ ученик: { класс: st.grade, цели: st.goals, курс: st.course }, план_уроков: body.lessons || [], результаты: res, тесты_по_темам: byTopic, письменные: wr, время: act, дз: hw, входной_тест_слабые_темы: body.entry_weak || [] }).slice(0, 24000), 900);
      await admin.from("ai_reports").insert({ teacher_id: uid, student_id: st.id, kind: "analysis", body: r });
      return json(r);
    }

    if (action === "generate_tasks") {
      const n = Math.min(Math.max(+body.count || 5, 2), 12);
      const r = await ask(`Ты – учитель ${SUBJ}. Составь задания строго по теме, на уровне ${body.grade || 9} класса${body.exam ? ", в духе заданий " + body.exam : ""}. Примеры – свои, не копируй задания из сборников.
Мини-практика – короткие вопросы с коротким ответом (варианты верного ответа через «|»). Тест – 4 варианта, один верный, a – индекс верного (0–3), e – короткое объяснение, tag – тема.
Верни строго JSON: {"title":"…","mini":[{"q":"…","a":"…"}],"test":[{"q":"…","o":["…","…","…","…"],"a":0,"e":"…","tag":"…"}]}`,
        `Предмет: ${SUBJ}. Тема: ${body.topic}. ${body.notes ? "Пожелания: " + body.notes : ""} Мини-практика: ${n} заданий. Тест: ${n} вопросов.`, 2600);
      return json(r);
    }

    /* полноценный урок для любого предмета и класса: теория блоками, практика, тест */
    if (action === "build_lesson") {
      const grade = +body.grade || 9, subj = SUBJ;
      const r = await ask(`Ты – методист и учитель ${subj}. Сделай полноценный урок для ${grade} класса${body.exam ? " с прицелом на " + body.exam : ""}, как в хорошем учебнике: короткая теория блоками, примеры, мини-практика сразу после блока, задания и тест. Пиши по-русски, грамотно, примеры свои.
Верни строго JSON: {"title":"название урока","learn":["что ученик узнает"],"theory":[{"h":"заголовок блока","t":"объяснение 1–3 предложения","list":["пункт правила/факт"],"ex":["пример"],"mini":[{"q":"вопрос","a":"ответ|вариант"}]}],"practice":[{"t":"формулировка задания","key":"ключ – полный ответ с пояснением","items":["предложение/слово для работы (необязательно)"]}],"test":[{"q":"вопрос","o":["…","…","…","…"],"a":0,"e":"объяснение","tag":"тема"}],"method":{"focus":"главное на уроке"}}.
Теория: 2–3 блока, практика: 3–5 заданий, тест: 4–6 вопросов.`,
        `Предмет: ${subj}. Класс: ${grade}. Тема/раздел: ${body.topic || body.title || ""}. ${body.notes ? "Пожелания: " + String(body.notes).slice(0, 1200) : ""}`, 3600);
      return json(r);
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
