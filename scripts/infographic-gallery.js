'use strict';
/**
 * Infographic showroom: one slide per component, rendered in the chosen themes.
 *   node scripts/infographic-gallery.js [outDir] [mood,mood,...]
 * Writes slide PNGs per theme + the in-page design QA report (overflow / overlap / tiny text).
 * Needs Chrome for puppeteer (PUPPETEER_EXECUTABLE_PATH works).
 */
const fs = require('fs');
const path = require('path');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
const { renderHtmlToPngs } = require('../products/presentation/renderer');

const SAMPLES = [
  { title: 'Интернетті қолдану мақсаттары', subtitle: 'Қазақстан тұрғындары, 2023 жыл', infographic: { kind: 'bar', unit: '%', source: 'Дереккөз: ҚР Ұлттық статистика бюросы', items: [{ label: 'Әлеуметтік желілер', value: '82%' }, { label: 'Онлайн төлемдер', value: '74%' }, { label: 'Мемлекеттік қызметтер', value: '61%' }, { label: 'Онлайн оқу', value: '38%' }, { label: 'Онлайн сауда', value: '35%' }] } },
  { title: 'ЖІӨ өсімі жылдар бойынша', subtitle: 'Нақты өсу қарқыны, пайызбен', infographic: { kind: 'column', unit: '%', items: [{ label: '2018', value: '4,1' }, { label: '2019', value: '4,5' }, { label: '2020', value: '2,5' }, { label: '2021', value: '4,3' }, { label: '2022', value: '3,2' }, { label: '2023', value: '5,1' }], highlight: 5 } },
  { title: 'Халық санының динамикасы', subtitle: 'Миллион адам', infographic: { kind: 'line', unit: 'млн', items: [{ label: '1999', value: 14.9 }, { label: '2004', value: 15.0 }, { label: '2009', value: 16.0 }, { label: '2014', value: 17.4 }, { label: '2019', value: 18.5 }, { label: '2024', value: 20.0 }] } },
  { title: 'Электр энергиясының көздері', subtitle: 'Өндіріс құрылымы', infographic: { kind: 'donut', center: 'көмір', items: [{ label: 'Көмір', value: '66%' }, { label: 'Газ', value: '20%' }, { label: 'Гидроэнергия', value: '9%' }, { label: 'Жел мен күн', value: '5%' }] } },
  { title: 'Қала мен ауыл: интернет', subtitle: 'Үй шаруашылықтарының қосылуы', infographic: { kind: 'compare', items: [{ label: 'Қала', value: '92%', detail: 'Жылдам кең жолақты байланыс' }, { label: 'Ауыл', value: '71%', detail: 'Мобильді интернет басым' }] } },
  { title: 'Жастардың цифрлық дағдысы', subtitle: '18–29 жас аралығы', infographic: { kind: 'pictogram', items: [{ label: 'жастар күн сайын онлайн оқиды', value: '70%', detail: 'Әр онның жетеуі білім алу үшін интернетті пайдаланады.' }] } },
  { title: 'Судың табиғаттағы айналымы', subtitle: 'Тұйық цикл: су жоғалмайды, тек күйін өзгертеді', infographic: { kind: 'cycle', center: 'Су айналымы', items: [{ label: 'Булану', detail: 'Күн жылуымен су буға айналады', icon: 'sun' }, { label: 'Конденсация', detail: 'Бу салқындап, бұлт түзеді', icon: 'cloud' }, { label: 'Жауын-шашын', detail: 'Жаңбыр мен қар жерге түседі', icon: 'droplets' }, { label: 'Жиналу', detail: 'Су өзен мен теңізге құяды', icon: 'waves' }] } },
  { title: 'Сатып алушы жолы', subtitle: 'Онлайн дүкендегі конверсия', infographic: { kind: 'funnel', items: [{ label: 'Сайтқа кірді', value: '10 000' }, { label: 'Тауарды қарады', value: '4 200' }, { label: 'Себетке салды', value: '1 300' }, { label: 'Сатып алды', value: '480' }] } },
  { title: 'Маслоу қажеттіліктер пирамидасы', subtitle: 'Төменгі деңгей қанағаттанбай, жоғарғысы оянбайды', infographic: { kind: 'pyramid', items: [{ label: 'Өзін-өзі жүзеге асыру', detail: 'Шығармашылық, мақсат' }, { label: 'Құрмет', detail: 'Мойындалу, жетістік' }, { label: 'Тиесілік', detail: 'Отбасы, достық' }, { label: 'Қауіпсіздік', detail: 'Тұрақтылық, қорғаныс' }, { label: 'Физиологиялық', detail: 'Тамақ, су, ұйқы' }] } },
  { title: 'Тұрақты даму қағидаты', subtitle: 'Үш бағыттың тоғысуы', infographic: { kind: 'venn', center: 'Тұрақты даму', items: [{ label: 'Экономика', detail: 'Өсу мен табыс' }, { label: 'Қоғам', detail: 'Әділдік пен білім' }, { label: 'Экология', detail: 'Табиғатты сақтау' }] } },
  { title: 'Компанияның SWOT талдауы', subtitle: 'Ішкі және сыртқы факторлар', infographic: { kind: 'matrix', items: [{ label: 'Күшті жақтары', detail: 'Тәжірибелі команда, тұрақты клиенттер базасы, танымал бренд', icon: 'trophy' }, { label: 'Әлсіз жақтары', detail: 'Цифрлық арналардың аздығы, жоғары шығын', icon: 'triangle-alert' }, { label: 'Мүмкіндіктер', detail: 'Онлайн сауда, жаңа өңірлерге шығу', icon: 'rocket' }, { label: 'Қауіптер', detail: 'Бәсекелестердің көбеюі, валюта тербелісі', icon: 'shield' }] } },
  { title: 'Қашықтан оқыту', subtitle: 'Екі жағын салыстыру', infographic: { kind: 'prosCons', items: [{ label: 'Уақытты үнемдеу', group: 'pro' }, { label: 'Кез келген жерден оқу', group: 'pro' }, { label: 'Жеке қарқын', group: 'pro' }, { label: 'Тікелей қарым-қатынас аз', group: 'con' }, { label: 'Өзін-өзі ұйымдастыру қажет', group: 'con' }, { label: 'Интернетке тәуелділік', group: 'con' }] } },
  { title: 'Жобаның даму жоспары', subtitle: '2024–2026 жылдардағы негізгі кезеңдер', infographic: { kind: 'roadmap', items: [{ label: 'Зерттеу', value: '2024 Q1', detail: 'Нарық пен қажеттілікті талдау' }, { label: 'Прототип', value: '2024 Q3', detail: 'Алғашқы нұсқаны сынау' }, { label: 'Іске қосу', value: '2025 Q1', detail: 'Алғашқы 1000 қолданушы' }, { label: 'Өсу', value: '2025 Q4', detail: 'Жаңа өңірлерге шығу' }, { label: 'Масштаб', value: '2026', detail: 'Халықаралық нарық' }] } },
  { title: 'Цифрлық экономиканың тірегі', subtitle: 'Төрт негізгі бағыт', infographic: { kind: 'iconGrid', items: [{ label: 'Білім', detail: 'IT мамандарын даярлау және цифрлық сауаттылық', icon: 'graduation-cap' }, { label: 'Инфрақұрылым', detail: 'Барлық елді мекенге жылдам интернет', icon: 'wifi' }, { label: 'Мемлекеттік қызмет', detail: 'eGov арқылы қағазсыз қызмет', icon: 'landmark' }, { label: 'Инновация', detail: 'Стартаптар мен технопарктерді қолдау', icon: 'lightbulb' }] } },
];

async function main() {
  const outDir = process.argv[2] || path.join(process.cwd(), 'out-gallery');
  const moods = String(process.argv[3] || 'midnight,blush').split(',');
  fs.mkdirSync(outDir, { recursive: true });
  for (const mood of moods) {
    const deck = [{ title: 'Инфографика кітапханасы', subtitle: 'DeadLine', composition: { mood } }]
      .concat(SAMPLES.map((s) => Object.assign({}, s, { composition: { mood } })));
    const html = build3DPresentationHTML(deck, 'Инфографика', { style: 'academic' });
    const htmlPath = path.join(outDir, 'gallery-' + mood + '.html');
    fs.writeFileSync(htmlPath, html);
    const r = await renderHtmlToPngs(htmlPath);
    r.pngPaths.forEach((p, i) => fs.copyFileSync(p, path.join(outDir, mood + '-' + String(i + 1).padStart(2, '0') + '.png')));
    console.log(mood + ': ' + r.pngPaths.length + ' slides' + (r.overflowWarnings.length ? ' · QA: ' + r.overflowWarnings.join(' | ') : ' · QA ok'));
    fs.rmSync(r.tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { SAMPLES };
