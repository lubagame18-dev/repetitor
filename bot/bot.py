"""Бот «Уроки русского языка. Подготовка к ОГЭ».

Напоминает ученику о занятиях по четвергам, о домашнем задании и о тесте
после занятия. Расписание берётся из plan.json (лежит рядом с ботом).

Запуск:
    pip install "python-telegram-bot[job-queue]==21.6"
    BOT_TOKEN=... APP_URL=https://claude.ai/artifact/... python bot.py
"""
import json
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CommandHandler, ContextTypes

# ---------- настройки ----------
TOKEN = os.environ["BOT_TOKEN"]                       # токен от @BotFather
APP_URL = os.environ.get("APP_URL", "")               # ссылка на приложение с папками
TUTOR_ID = int(os.environ.get("TUTOR_ID", "0"))       # ваш Telegram id (узнать: /id)
TZ = ZoneInfo(os.environ.get("TZ_NAME", "Asia/Yekaterinburg"))
LESSON_START = time(int(os.environ.get("LESSON_HOUR", "17")), int(os.environ.get("LESSON_MIN", "0")), tzinfo=TZ)
LESSON_LEN_MIN = int(os.environ.get("LESSON_LEN", "60"))
EVE_REMINDER = time(19, 0, tzinfo=TZ)                 # среда вечером: «завтра занятие»

HERE = Path(__file__).parent
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))
LESSONS = PLAN["lessons"]
BLOCKS = PLAN["blocks"]
SUBS = HERE / "subscribers.json"

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]


def d(iso: str) -> date:
    return date.fromisoformat(iso)


def human(iso: str) -> str:
    x = d(iso)
    return f"{x.day} {MONTHS[x.month - 1]}"


def today() -> date:
    return datetime.now(TZ).date()


def next_lesson():
    return next((l for l in LESSONS if d(l["date"]) >= today()), None)


def prev_of(lesson):
    i = LESSONS.index(lesson)
    return LESSONS[i - 1] if i > 0 else None


def lesson_on(day: date):
    return next((l for l in LESSONS if d(l["date"]) == day), None)


def num(lesson) -> int:
    return LESSONS.index(lesson) + 1


def app_button():
    if not APP_URL:
        return None
    return InlineKeyboardMarkup([[InlineKeyboardButton("Открыть папки занятий", url=APP_URL)]])


def load_subs() -> set[int]:
    try:
        return set(json.loads(SUBS.read_text()))
    except Exception:
        return set()


def save_subs(s: set[int]) -> None:
    SUBS.write_text(json.dumps(sorted(s)))


def lesson_card(l) -> str:
    return (f"Занятие № {num(l)} – {human(l['date'])}, четверг\n"
            f"{l['oge']} · {l['title']}\n"
            f"Блок: {BLOCKS[l['block']]['name']}")


# ---------- команды ----------
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    subs = load_subs()
    subs.add(update.effective_chat.id)
    save_subs(subs)
    await update.message.reply_text(
        "Привет! Это бот «Уроки русского языка. Подготовка к ОГЭ».\n\n"
        "Я напомню о занятии накануне, о домашнем задании и о тесте после занятия.\n\n"
        "Команды:\n/next – ближайшее занятие\n/dz – какое ДЗ сдать\n/plan – план на месяц\n/app – папки занятий",
        reply_markup=app_button())


async def cmd_next(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    l = next_lesson()
    await update.message.reply_text(lesson_card(l) if l else "Занятия закончились. Удачи на экзамене!",
                                    reply_markup=app_button())


async def cmd_dz(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    l = next_lesson()
    p = prev_of(l) if l else None
    if not p:
        await update.message.reply_text("Домашнего задания пока нет.")
        return
    await update.message.reply_text(
        f"Сдать на занятии {human(l['date'])}:\n\n{p['hw']}\n\n"
        "Когда сделаешь – отметь «Я сделал ДЗ» в папке занятия.",
        reply_markup=app_button())


async def cmd_plan(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    t = today()
    rows = [l for l in LESSONS if t <= d(l["date"]) <= t + timedelta(days=31)]
    text = "\n".join(f"{human(l['date'])} – {l['oge']}: {l['title']}" for l in rows) or "В ближайший месяц занятий нет."
    await update.message.reply_text("План на месяц:\n\n" + text, reply_markup=app_button())


async def cmd_app(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(APP_URL or "Ссылку на приложение пришлёт репетитор.")


async def cmd_id(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"Ваш id: {update.effective_chat.id}")


async def cmd_say(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/say текст – репетитор рассылает сообщение всем подписчикам."""
    if update.effective_chat.id != TUTOR_ID:
        return
    text = update.message.text.partition(" ")[2].strip()
    if not text:
        await update.message.reply_text("Напишите: /say текст сообщения")
        return
    for chat in load_subs():
        if chat != TUTOR_ID:
            await ctx.bot.send_message(chat, text, reply_markup=app_button())
    await update.message.reply_text("Отправлено.")


# ---------- ежедневные проверки ----------
async def broadcast(ctx: ContextTypes.DEFAULT_TYPE, text: str):
    for chat in load_subs():
        try:
            await ctx.bot.send_message(chat, text, reply_markup=app_button())
        except Exception:
            pass


async def evening_check(ctx: ContextTypes.DEFAULT_TYPE):
    """Каждый вечер: если завтра занятие – напомнить о нём и о ДЗ."""
    l = lesson_on(today() + timedelta(days=1))
    if not l:
        return
    p = prev_of(l)
    hw = f"\n\nНе забудь ДЗ:\n{p['hw']}\n\nОтметь в папке «Я сделал ДЗ»." if p else ""
    await broadcast(ctx, "Завтра занятие!\n\n" + lesson_card(l) + hw)


async def lesson_morning(ctx: ContextTypes.DEFAULT_TYPE):
    l = lesson_on(today())
    if l:
        await broadcast(ctx, f"Сегодня в {LESSON_START.strftime('%H:%M')} занятие: {l['title']}. Подготовь тетрадь и ДЗ.")


async def after_lesson(ctx: ContextTypes.DEFAULT_TYPE):
    l = lesson_on(today())
    if l:
        await broadcast(ctx, f"Занятие закончилось. Пройди, пожалуйста, тест в папке № {num(l)} «{l['title']}» – "
                             "результат попадёт на карту успеха.\n\n"
                             f"Домашнее задание до {human(LESSONS[num(l)]['date']) if num(l) < len(LESSONS) else 'экзамена'}:\n{l['hw']}")


async def event_check(ctx: ContextTypes.DEFAULT_TYPE):
    for e in PLAN["events"]:
        if d(e["date"]) - today() == timedelta(days=1):
            await broadcast(ctx, f"Завтра: {e['title']}.")


def main():
    app = Application.builder().token(TOKEN).build()
    for name, fn in [("start", start), ("next", cmd_next), ("dz", cmd_dz), ("plan", cmd_plan),
                     ("app", cmd_app), ("id", cmd_id), ("say", cmd_say)]:
        app.add_handler(CommandHandler(name, fn))

    jq = app.job_queue
    jq.run_daily(evening_check, EVE_REMINDER)
    jq.run_daily(event_check, time(18, 0, tzinfo=TZ))
    morning = (datetime.combine(date.today(), LESSON_START) - timedelta(hours=3)).timetz()
    end = (datetime.combine(date.today(), LESSON_START) + timedelta(minutes=LESSON_LEN_MIN + 5)).timetz()
    jq.run_daily(lesson_morning, morning)
    jq.run_daily(after_lesson, end)
    app.run_polling()


if __name__ == "__main__":
    main()
