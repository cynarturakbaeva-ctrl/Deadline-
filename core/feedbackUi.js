'use strict';
/**
 * Клиент бағасы (1–5 жұлдыз) мен пікірі: бот хабарламаларының ортақ бөліктері.
 * Пікір «Reply» арқылы жазылады; жұмыс нөмірі хабарлама мәтінінде (#j…) тұрады, сондықтан бот қайта іске
 * қосылса да пікір дұрыс жұмысқа байланады.
 */
const JOB_TAG_RE = /#(j[0-9a-z]{6,20})\b/;

function ratingKeyboard(jobId, selected = 0) {
  return {
    inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({
      text: n <= selected ? '⭐' : '☆',
      callback_data: `fb:${jobId}:${n}`,
    }))],
  };
}

const ratePromptText = (jobId, kind = 'presentation') =>
  `${kind === 'referat' ? '📄 Реферат' : '📊 Презентация'} ұнады ма? Жұлдызша қойыңыз:\n#${jobId}`;

const commentPromptText = (jobId, rating) =>
  `${'⭐'.repeat(rating)} Рахмет! Пікір қалдырғыңыз келсе, осы хабарламаға жауап (Reply) ретінде жазыңыз — міндетті емес.\n#${jobId}`;

function parseFeedbackCallback(data) {
  const m = String(data || '').match(/^fb:(j[0-9a-z]{6,20}):([1-5])$/);
  return m ? { jobId: m[1], rating: +m[2] } : null;
}

function jobTagOf(text) {
  const m = String(text || '').match(JOB_TAG_RE);
  return m ? m[1] : null;
}

/**
 * Баға сұрауының уақыты: нәтиже жеткеннен кейін delayMin минут (клиент файлды қарап үлгерсін).
 * Түнгі уақытқа (quietFrom–quietTo, клиенттің жергілікті уақыты) түссе — келесі таңғы morningHour-ға ауысады.
 */
function rateDueAt(doneAt, { delayMin = 60, tzOffsetMin = 300, quietFrom = 23, quietTo = 8, morningHour = 10 } = {}) {
  const due = Number(doneAt) + delayMin * 60000;
  const local = new Date(due + tzOffsetMin * 60000); // UTC өрістері = жергілікті уақыт
  const h = local.getUTCHours();
  const quiet = quietFrom > quietTo ? (h >= quietFrom || h < quietTo) : (h >= quietFrom && h < quietTo);
  if (!quiet) return due;
  const morning = new Date(local);
  if (h >= quietFrom) morning.setUTCDate(morning.getUTCDate() + 1);
  morning.setUTCHours(morningHour, 0, 0, 0);
  return morning.getTime() - tzOffsetMin * 60000;
}

module.exports = { rateDueAt, ratingKeyboard, ratePromptText, commentPromptText, parseFeedbackCallback, jobTagOf };
