/* Простой запуск проверок доски v55.
   Использование: node _test/run.mjs   (то же, что node _test/board.mjs)
   Пробрасывает BOARD_ONLY/BOARD_HEADLESS/PORT/CDP_PORT из окружения. */
import { runBoardStandalone } from "./board.mjs";

runBoardStandalone()
  .then(({ failed }) => process.exit(failed ? 1 : 0))
  .catch(e => { console.error("ОШИБКА СТЕНДА:", (e && e.stack) || e); process.exit(2); });
