'use strict';
/**
 * "Баяндама мәтіні" — a Word file the student reads from (phone or print) and learns from:
 * per slide the key idea + the spoken text, then the glossary and the likely teacher questions with answers.
 */
const { packDocx, para, run } = require('../referat/docx');
const { speakingMinutes } = require('./speakerNotes');

const L10N = {
  kk: {
    doc: 'БАЯНДАМА МӘТІНІ', topic: 'Тақырыбы', speaker: 'Баяндамашы', group: 'Топ',
    time: (m, n) => `Сөйлеу уақыты: шамамен ${m} мин · ${n} слайд`,
    how: '► — слайдтың басты ойы. Мәтінді жаттап алмаңыз: басты ойды есте сақтап, өз сөзіңізбен айтыңыз.',
    slide: 'Слайд', glossary: 'Негізгі терминдер', questions: 'Мұғалім қоюы мүмкін сұрақтар', answer: 'Жауап',
  },
  ru: {
    doc: 'ТЕКСТ ДОКЛАДА', topic: 'Тема', speaker: 'Докладчик', group: 'Группа',
    time: (m, n) => `Время выступления: около ${m} мин · ${n} слайдов`,
    how: '► — главная мысль слайда. Не заучивайте текст: запомните главную мысль и говорите своими словами.',
    slide: 'Слайд', glossary: 'Ключевые термины', questions: 'Возможные вопросы преподавателя', answer: 'Ответ',
  },
  en: {
    doc: 'SPEAKER SCRIPT', topic: 'Topic', speaker: 'Speaker', group: 'Group',
    time: (m, n) => `Speaking time: about ${m} min · ${n} slides`,
    how: '► — the key idea of the slide. Do not memorise the text: remember the idea and say it in your own words.',
    slide: 'Slide', glossary: 'Key terms', questions: 'Questions a teacher may ask', answer: 'Answer',
  },
};

function langCode(language) {
  const l = String(language || '').toLowerCase();
  if (/rus|рус|орыс/.test(l)) return 'ru';
  if (/eng|анг|ағыл/.test(l)) return 'en';
  return 'kk';
}

/** Detect from the text when the deck language was not given explicitly. */
function guessLang(slides) {
  const t = (slides || []).map((s) => (s && s.title) || '').join(' ');
  if (/[әғқңөұүһі]/i.test(t)) return 'kk';
  if (/[а-яё]/i.test(t)) return 'ru';
  return /[a-z]/i.test(t) ? 'en' : 'kk';
}

/**
 * @param {{ title: string, slides: object[], notes: ({point,speech}|null)[], study?: object|null, language?: string|null, coverMeta?: object }} o
 * @returns {Buffer} .docx
 */
function buildSpeechDocx(o) {
  const slides = Array.isArray(o.slides) ? o.slides : [];
  const notes = Array.isArray(o.notes) ? o.notes : [];
  const lang = o.language ? langCode(o.language) : guessLang(slides);
  const t = L10N[lang];
  const meta = o.coverMeta || {};
  const C = (text, ro = {}, po = {}) => para(run(text, ro), Object.assign({ jc: 'center', firstLine: 0, line: 300 }, po));
  const P = (text, ro = {}, po = {}) => para(run(text, ro), Object.assign({ line: 360, firstLine: 709, after: 120 }, po));
  const body = [];

  body.push(C(t.doc, { bold: true, size: 32 }, { after: 240 }));
  body.push(C(`${t.topic}: «${o.title || ''}»`, { bold: true, size: 28 }, { after: 120 }));
  const who = [meta.performedBy ? `${t.speaker}: ${meta.performedBy}` : '', meta.group ? `${t.group}: ${meta.group}` : ''].filter(Boolean).join(' · ');
  if (who) body.push(C(who, {}, { after: 60 }));
  body.push(C(t.time(speakingMinutes(notes), slides.length), { italic: true, size: 24 }, { after: 240 }));
  body.push(P(t.how, { italic: true, size: 24 }, { firstLine: 0, after: 240 }));

  slides.forEach((s, i) => {
    const n = notes[i];
    if (!n) return;
    const title = String((s && s.title) || '').trim();
    body.push(para(run(`${t.slide} ${i + 1}. ${title}`), { style: 'Heading2', firstLine: 0, before: 240 }));
    if (n.point) body.push(P('► ' + n.point, { bold: true }, { firstLine: 0 }));
    body.push(P(n.speech));
  });

  const study = o.study || null;
  if (study && study.glossary && study.glossary.length) {
    body.push(para(run(t.glossary), { style: 'Heading1', pageBreakBefore: true }));
    study.glossary.forEach((g) => {
      body.push(para(run(g.term, { bold: true }) + run(' — ' + g.meaning), { line: 360, firstLine: 0, after: 120 }));
    });
  }
  if (study && study.questions && study.questions.length) {
    body.push(para(run(t.questions), { style: 'Heading1', pageBreakBefore: !(study.glossary && study.glossary.length) }));
    study.questions.forEach((q, k) => {
      body.push(para(run(`${k + 1}. ${q.q}`, { bold: true }), { line: 360, firstLine: 0, before: 120, after: 60, keepNext: true }));
      body.push(para(run(t.answer + ': ', { italic: true }) + run(q.a), { line: 360, firstLine: 0, after: 120 }));
    });
  }
  return packDocx(lang, o.title || t.doc, body.join(''));
}

module.exports = { buildSpeechDocx, langCode };
