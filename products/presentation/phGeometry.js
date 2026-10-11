'use strict';
/**
 * PowerPoint placeholder-лері (<p:ph>) көбіне өз координатасы мен кегльін слайдта жазбайды —
 * олар slideLayout → slideMaster-ден мұраланады. Сыйғызу қозғалтқышы мен тексеруші қораптың
 * өлшемін білмесе, мәтінді өлшей алмайды (ұзын мәтін қораптан асып кетеді).
 *
 * materializePlaceholders: мұраланған <a:xfrm> және бірінші деңгей кегльін (sz) слайдтағы
 * placeholder-ге НАҚТЫ жазады. Мәндер мұраланғанмен бірдей — көрініс өзгермейді (OOXML стандарты:
 * слайдтағы мән мұраланғаннан басым).
 */
const { tagBlocks } = require('../../design-dna/structure');

const relTarget = (files, partPath, typeRe) => {
  const relsPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = files.get(relsPath);
  if (typeof rels !== 'string') return null;
  for (const m of rels.matchAll(/<Relationship [^>]*>/g)) {
    const type = (m[0].match(/Type="([^"]+)"/) || [])[1] || '';
    const tg = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (tg && typeRe.test(type)) {
      if (tg.startsWith('/')) return tg.slice(1);
      const base = partPath.split('/').slice(0, -1);
      for (const seg of tg.split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
      return base.join('/');
    }
  }
  return null;
};

const phOf = (block) => {
  const m = block.match(/<p:ph\b[^>]*\/?>/);
  if (!m) return null;
  return { type: (m[0].match(/ type="([^"]+)"/) || [])[1] || 'body', idx: (m[0].match(/ idx="([^"]+)"/) || [])[1] || null };
};
const xfrmIn = (block) => {
  const m = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
};
const lvl1Sz = (block) => {
  const m = block.match(/<a:lvl1pPr[^>]*>[\s\S]*?<a:defRPr[^>]*? sz="(\d+)"/);
  if (m) return +m[1];
  const r = block.match(/<a:(?:rPr|endParaRPr)[^>]*? sz="(\d+)"/);
  return r ? +r[1] : null;
};
const normType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t === 'obj' ? 'body' : t);

function placeholdersOf(xml) {
  const out = [];
  for (const sp of tagBlocks(String(xml || ''), 'p:sp')) {
    const ph = phOf(sp);
    if (ph) out.push({ ph, box: xfrmIn(sp), sz: lvl1Sz(sp) });
  }
  return out;
}

function masterSz(masterXml, type) {
  const tag = normType(type) === 'title' ? 'p:titleStyle' : 'p:bodyStyle';
  const m = String(masterXml || '').match(new RegExp(`<${tag}>[\\s\\S]*?<a:lvl1pPr[^>]*>[\\s\\S]*?<a:defRPr[^>]*? sz="(\\d+)"`));
  return m ? +m[1] : null;
}

function findIn(list, ph) {
  if (!list) return null;
  if (ph.idx != null) { const byIdx = list.find((p) => p.ph.idx === ph.idx); if (byIdx) return byIdx; }
  return list.find((p) => p.ph.type === ph.type) || list.find((p) => normType(p.ph.type) === normType(ph.type)) || null;
}

/** Слайдтың placeholder-леріне мұраланған геометрия мен кегльді жазады. */
const runSz = (nb, sz) => nb
  .replace(/<a:r>(\s*)<a:t>/g, `<a:r>$1<a:rPr lang="kk-KZ" sz="${sz}"/><a:t>`)
  .replace(/<a:rPr(\s[^>]*?)?(\/?)>/g, (m, a = '', sl) => (/ sz="/.test(a) ? m : `<a:rPr${a} sz="${sz}"${sl}>`));

/** Placeholder ЕМЕС мәтін қораптары: кегль жоқ болса — presentation.xml defaultTextStyle (әйтпесе 18pt). */
function materializeTextBoxes(files, xml) {
  const pres = String(files.get('ppt/presentation.xml') || '');
  const def = (pres.match(/<p:defaultTextStyle>[\s\S]*?<a:lvl1pPr[^>]*>[\s\S]*?<a:defRPr[^>]*? sz="(\d+)"/) || [])[1];
  const sz = def ? +def : 1800;
  let out = xml;
  for (const sp of tagBlocks(xml, 'p:sp')) {
    if (/<p:ph\b/.test(sp) || !/<p:txBody>/.test(sp) || !/<a:t>[^<]*\S/.test(sp)) continue;
    if (/<a:(?:rPr|endParaRPr|defRPr)[^>]*? sz="/.test(sp)) continue;
    const nb = runSz(sp, sz);
    if (nb !== sp) out = out.replace(sp, () => nb);
  }
  return out;
}

function materializePlaceholders(files, slidePath, xml) {
  xml = materializeTextBoxes(files, xml);
  if (!/<p:ph\b/.test(xml)) return xml;
  const layoutPath = relTarget(files, slidePath, /\/slideLayout$/);
  const layoutXml = layoutPath ? files.get(layoutPath) : null;
  const masterPath = layoutPath ? relTarget(files, layoutPath, /\/slideMaster$/) : null;
  const masterXml = masterPath ? files.get(masterPath) : null;
  const L = placeholdersOf(layoutXml); const M = placeholdersOf(masterXml);
  let out = xml;
  for (const sp of tagBlocks(xml, 'p:sp')) {
    const ph = phOf(sp);
    if (!ph) continue;
    let nb = sp;
    if (!xfrmIn(sp)) {
      const src = findIn(L, ph); const srcM = findIn(M, ph);
      const box = (src && src.box) || (srcM && srcM.box);
      if (box) {
        const xf = `<a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm>`;
        if (/<p:spPr\s*\/>/.test(nb)) nb = nb.replace(/<p:spPr\s*\/>/, `<p:spPr>${xf}</p:spPr>`);
        else nb = nb.replace(/<p:spPr(\s[^>]*)?>/, (m) => m + xf);
      }
    }
    // кегль: runs-та sz жоқ болса — мұраланғанын (layout → master) нақты жазамыз
    if (/<p:txBody>/.test(nb) && !/<a:(?:rPr|endParaRPr)[^>]*? sz="/.test(nb)) {
      const src = findIn(L, ph);
      const sz = (src && src.sz) || (findIn(M, ph) || {}).sz || masterSz(masterXml, ph.type);
      // rPr жоқ run-дарға rPr қосамыз (<a:r><a:t> → <a:r><a:rPr sz/><a:t>)
      if (sz) nb = nb.replace(/<a:r>(\s*)<a:t>/g, `<a:r>$1<a:rPr lang="kk-KZ" sz="${sz}"/><a:t>`);
      if (sz) nb = nb.replace(/<a:rPr(\s[^>]*?)?(\/?)>/g, (m, a = '', sl) => (/ sz="/.test(a) ? m : `<a:rPr${a} sz="${sz}"${sl}>`))
        .replace(/<a:endParaRPr(\s[^>]*?)?(\/?)>/g, (m, a = '', sl) => (/ sz="/.test(a) ? m : `<a:endParaRPr${a} sz="${sz}"${sl}>`));
      // бірде-бір run жоқ (бос placeholder) — бірінші абзацқа endParaRPr
      if (sz && !/<a:(?:rPr|endParaRPr)/.test(nb)) nb = nb.replace(/<\/a:p>/, `<a:endParaRPr lang="kk-KZ" sz="${sz}"/></a:p>`);
    }
    if (nb !== sp) out = out.replace(sp, () => nb);
  }
  return out;
}

module.exports = { materializePlaceholders };
