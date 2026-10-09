'use strict';
const { makeZip } = require('./zipmin');

const TEXT_W = 9638; // 170 мм (twips) — оң жақ табуляция
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML-де жарамсыз басқару таңбалары
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function run(text, o = {}) {
  const rpr = [
    o.bold ? '<w:b/>' : '',
    o.italic ? '<w:i/>' : '',
    o.caps ? '<w:caps/>' : '',
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : '',
  ].join('');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(inner, o = {}) {
  const p = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.tabs ? `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${o.tabs}"/></w:tabs>` : '',
    (o.before != null || o.after != null || o.line != null)
      ? `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ''}${o.after != null ? ` w:after="${o.after}"` : ''}${o.line != null ? ` w:line="${o.line}" w:lineRule="${o.rule || 'auto'}"` : ''}/>` : '',
    (o.left != null || o.firstLine != null || o.hanging != null)
      ? `<w:ind${o.left != null ? ` w:left="${o.left}"` : ''}${o.firstLine != null ? ` w:firstLine="${o.firstLine}"` : ''}${o.hanging != null ? ` w:hanging="${o.hanging}"` : ''}/>` : '',
    o.jc ? `<w:jc w:val="${o.jc}"/>` : '',
  ].join('');
  return `<w:p>${p ? `<w:pPr>${p}</w:pPr>` : ''}${inner}</w:p>`;
}

const L10N = {
  kk: { toc: 'МАЗМҰНЫ', referat: 'РЕФЕРАТ', topic: 'Тақырыбы', performed: 'Орындаған', checked: 'Тексерген', group: 'Топ', faculty: 'Факультет', department: 'Кафедра' },
  ru: { toc: 'СОДЕРЖАНИЕ', referat: 'РЕФЕРАТ', topic: 'Тема', performed: 'Выполнил(а)', checked: 'Проверил(а)', group: 'Группа', faculty: 'Факультет', department: 'Кафедра' },
  en: { toc: 'CONTENTS', referat: 'ESSAY', topic: 'Topic', performed: 'Prepared by', checked: 'Reviewed by', group: 'Group', faculty: 'Faculty', department: 'Department' },
};

function titlePage(lang, title, meta) {
  const t = L10N[lang] || L10N.kk;
  const out = [];
  const C = (text, o = {}) => para(run(text, o), { jc: 'center', line: 276, before: o.before || 0, after: o.after || 0 });
  if (meta.university) out.push(C(meta.university, { bold: true, caps: true, after: 120 }));
  if (meta.faculty) out.push(C(`${t.faculty}: ${meta.faculty}`, { after: 60 }));
  if (meta.department) out.push(C(`${t.department}: ${meta.department}`, { after: 60 }));
  const gapTop = (meta.university || meta.faculty || meta.department) ? 2600 : 3200;
  out.push(C(t.referat, { bold: true, size: 36, before: gapTop, after: 360 }));
  out.push(C(`${t.topic}: «${title}»`, { bold: true, size: 30, after: 0 }));

  const right = [];
  if (meta.performedBy) right.push(`${t.performed}: ${meta.performedBy}`);
  if (meta.group) right.push(`${t.group}: ${meta.group}`);
  if (meta.checkedBy) right.push(`${t.checked}: ${meta.checkedBy}`);
  right.forEach((line, i) => {
    out.push(para(run(line), { left: 4500, jc: 'left', line: 276, before: i === 0 ? 2400 : 120, after: 0 }));
  });
  const foot = [meta.city, meta.year].filter(Boolean).join(' – ');
  if (foot) out.push(C(foot, { before: right.length ? 2200 : 4200 }));
  return out.join('');
}

function tocPage(lang, entries) {
  const t = L10N[lang] || L10N.kk;
  const out = [];
  out.push(para(run(t.toc, { bold: true }), { jc: 'center', pageBreakBefore: true, after: 240, line: 480, rule: 'exact', firstLine: 0 }));
  entries.forEach((e, i) => {
    const first = i === 0;
    const last = i === entries.length - 1;
    const fld = (type) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
    const pre = first ? fld('begin') + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>' + fld('separate') : '';
    const post = last ? fld('end') : '';
    const inner = pre + run(e.text) + '<w:r><w:tab/></w:r>' + run(String(e.page)) + post;
    out.push(para(inner, {
      tabs: TEXT_W, jc: 'left', firstLine: 0, left: e.level === 2 ? 454 : 0, line: 420, rule: 'exact', after: 0, before: 0,
    }));
  });
  return out.join('');
}

/**
 * opts: { lang, title, meta, blocks:[{type,text}], tocEntries:[{level,text,page}] }
 * blocks.type: 'h1' | 'h2' | 'p' | 'ref'
 */
function buildDocx(opts) {
  const { lang, title, meta = {}, blocks, tocEntries } = opts;
  const body = [];
  body.push(titlePage(lang, title, meta));
  body.push(tocPage(lang, tocEntries));
  let firstH1 = true;
  for (const b of blocks) {
    if (b.type === 'h1') {
      body.push(para(run(b.text), { style: 'Heading1', pageBreakBefore: firstH1 || !!b.forceBreak }));
      firstH1 = false;
    } else if (b.type === 'h2') {
      body.push(para(run(b.text), { style: 'Heading2', pageBreakBefore: !!b.forceBreak }));
    } else if (b.type === 'ref') {
      body.push(para(run(b.text), { firstLine: 709 }));
    } else {
      body.push(para(run(b.text)));
    }
  }
  const sect = '<w:sectPr>'
    + '<w:footerReference w:type="default" r:id="rIdF1"/><w:footerReference w:type="first" r:id="rIdF2"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="567" w:bottom="1134" w:left="1701" w:header="709" w:footer="567" w:gutter="0"/>'
    + '<w:titlePg/></w:sectPr>';

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="${lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : 'kk-KZ'}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="480" w:lineRule="exact"/><w:ind w:firstLine="709"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="240" w:line="480" w:lineRule="exact"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:caps/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="120" w:line="480" w:lineRule="exact"/><w:ind w:firstLine="709"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="709"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const footer1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>2</w:t></w:r><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const footer2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:p></w:ftr>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdF2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>DeadLine</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;

  return makeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/settings.xml', data: settingsXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/footer1.xml', data: footer1 },
    { name: 'word/footer2.xml', data: footer2 },
    { name: 'docProps/core.xml', data: core },
  ]);
}

module.exports = { buildDocx, L10N };
