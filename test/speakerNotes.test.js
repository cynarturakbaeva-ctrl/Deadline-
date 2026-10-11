'use strict';
const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { generateSpeakerNotes, applySpeakerNotes, speakingMinutes } = require('../products/presentation/speakerNotes');
const { buildSpeechDocx } = require('../products/presentation/speechDoc');

const slides = [
  { title: 'Цифрлық экономика', subtitle: 'Болашақтың кілті', bullets: ['Орындаған: Асан'] },
  { title: 'Негізгі ұғымдар', bullets: ['Блокчейн: үлестірілген тізілім', 'Бұлт: қашықтағы есептеу'] },
  { title: 'Сандар', stats: [{ value: '72%', label: 'интернет қолданушылар' }] },
  { title: 'Қорытынды', bullets: ['Цифрландыру — басымдық'] },
];
const speech = (n) => `Құрметті тыңдаушылар, ${n}-слайдта біз маңызды мәселені талқылаймыз. Бұл ұғымды қарапайым мысалмен түсіндірейін: күнделікті өмірде біз оны жиі кездестіреміз, бірақ мәнін ойламаймыз. Келесі бөлімде мұны тереңірек қарастырамыз.`;

function fakeLlm(calls) {
  return async (system, user, label) => {
    calls.push({ label, user });
    if (label === 'studyGuide') {
      return { glossary: [{ term: 'Блокчейн', meaning: 'Деректерді көп компьютерде бірдей сақтайтын тізілім.' }], questions: [{ q: 'Неге цифрландыру маңызды?', a: 'Ол уақыт пен шығынды азайтады.' }] };
    }
    const ns = JSON.parse(user.slice(user.indexOf('Slides:') + 7, user.lastIndexOf('Return')).trim()).map((f) => f.n);
    return { notes: ns.map((n) => ({ n, point: `**Басты ой ${n}**`, speech: speech(n) })) };
  };
}

test('notes for every slide + study guide; prompt carries the slide facts and the speaker name', async () => {
  const calls = [];
  const r = await generateSpeakerNotes({ slides, title: 'Цифрлық экономика', topic: 'Цифрлық экономика', language: 'Kazakh', coverMeta: { performedBy: 'Асан' }, llm: fakeLlm(calls) });
  assert.strictEqual(r.ok, 4);
  assert.strictEqual(r.notes[1].point, 'Басты ой 2', 'markdown stripped');
  assert.ok(r.study.glossary.length === 1 && r.study.questions.length === 1);
  const nCall = calls.find((c) => c.label.startsWith('speakerNotes'));
  assert.ok(/Асан/.test(nCall.user) && /72%/.test(nCall.user) && /Kazakh/.test(nCall.user));
  assert.strictEqual(applySpeakerNotes(slides.map((s) => ({ ...s })), r.notes), 4);
  assert.ok(speakingMinutes(r.notes) >= 1);
});

test('a failing or short answer never breaks the deck', async () => {
  const bad = await generateSpeakerNotes({ slides, title: 'T', llm: async () => { throw new Error('down'); } });
  assert.strictEqual(bad.ok, 0); assert.strictEqual(bad.study, null);
  assert.deepStrictEqual(bad.notes, [null, null, null, null]);
  const short = await generateSpeakerNotes({ slides, title: 'T', llm: async (s, u, label) => (label === 'studyGuide' ? {} : { notes: [{ n: 1, speech: 'тым қысқа' }] }) });
  assert.strictEqual(short.ok, 0);
});

test('slides get PPTX notes text with the key idea first', () => {
  const sl = [{ title: 'A' }, { title: 'B' }];
  applySpeakerNotes(sl, [{ point: 'Басты ой', speech: speech(1) }, null]);
  assert.ok(sl[0].speakerNotes.startsWith('► Басты ой\n\n'));
  assert.strictEqual(sl[1].speakerNotes, undefined);
});

test('speech .docx: per-slide script, glossary and teacher questions', async () => {
  const r = await generateSpeakerNotes({ slides, title: 'Цифрлық экономика', language: 'Kazakh', llm: fakeLlm([]) });
  const buf = buildSpeechDocx({ title: 'Цифрлық экономика', slides, notes: r.notes, study: r.study, language: 'Kazakh', coverMeta: { performedBy: 'Асан', group: 'ТК-21' } });
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  for (const s of ['БАЯНДАМА МӘТІНІ', 'Слайд 2. Негізгі ұғымдар', '► Басты ой 3', 'Негізгі терминдер', 'Мұғалім қоюы мүмкін сұрақтар', 'Баяндамашы: Асан', 'Блокчейн']) {
    assert.ok(xml.includes(s), s);
  }
  const ru = await JSZip.loadAsync(buildSpeechDocx({ title: 'Экономика', slides, notes: r.notes, study: null, language: 'Russian' }));
  assert.ok((await ru.file('word/document.xml').async('string')).includes('ТЕКСТ ДОКЛАДА'));
});
