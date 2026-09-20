'use strict';

/**
 * Презентацияның ЖАЛҒЫЗ шындық көзі — осы HTML файл.
 *
 * Әр слайд htmlBuilder.buildSlideHTML() қайтарған 1280×720 толық HTML.
 * Біз оны өзгертпей <iframe srcdoc> ішіне саламыз, сондықтан:
 *   • слайдтардың CSS-і бір-біріне әсер етпейді;
 *   • PPTX үшін сол iframe-ді скриншоттағанда, көрінетін сурет
 *     браузерде көрінетінмен БІРДЕЙ болады.
 *
 * Слайдтар `?slide=N` (1-ден) параметрі арқылы бір-бірлеп көрсетіледі —
 * renderer.js осыны пайдаланып әр слайдты бөлек скриншоттайды.
 */

const SLIDE_W = 1280;
const SLIDE_H = 720;

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildPresentationHTML(slideHtmlList, title) {
  const list = Array.isArray(slideHtmlList) ? slideHtmlList : [];
  const safeTitle = escapeText(title || 'Presentation');

  const slides = list
    .map((html, i) =>
      '<section class="slide' + (i === 0 ? ' is-active' : '') + '" data-index="' + i + '">' +
      '<iframe class="frame" scrolling="no" tabindex="-1" srcdoc="' + escapeAttr(html) + '"></iframe>' +
      '</section>'
    )
    .join('');

  const css = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
#viewport{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
#stage{position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;transform-origin:center center;flex:none}
.slide{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .45s ease}
.slide.is-active{opacity:1;visibility:visible}
.frame{width:${SLIDE_W}px;height:${SLIDE_H}px;border:0;display:block;background:#000}
#ui{position:fixed;left:0;right:0;bottom:0;z-index:10;display:flex;align-items:center;justify-content:center;gap:14px;padding:14px;color:#fff;opacity:.0;transition:opacity .25s}
body:hover #ui,body.show-ui #ui{opacity:1}
#ui button{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.55);color:#fff;font-size:18px;cursor:pointer}
#ui button:hover{background:rgba(255,255,255,.18)}
#counter{min-width:64px;text-align:center;font-size:13px;letter-spacing:.08em;opacity:.8}
#progress{position:fixed;left:0;bottom:0;height:3px;width:0;background:#fff;opacity:.7;z-index:11;transition:width .35s ease}
body.export #ui,body.export #progress{display:none}
`;

  const js = `
(function(){
  var W=${SLIDE_W}, H=${SLIDE_H};
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var n=slides.length, cur=0;
  var stage=document.getElementById('stage');
  var counter=document.getElementById('counter');
  var progress=document.getElementById('progress');
  var params=new URLSearchParams(location.search);
  var exportMode=params.has('slide');
  if(exportMode) document.body.classList.add('export');

  function fit(){
    var s=Math.min(window.innerWidth/W, window.innerHeight/H);
    stage.style.transform='scale('+s+')';
  }
  function show(i){
    if(!n) return;
    cur=Math.max(0,Math.min(n-1,i));
    slides.forEach(function(el,j){el.classList.toggle('is-active',j===cur);});
    counter.textContent=(cur+1)+' / '+n;
    progress.style.width=((cur+1)/n*100)+'%';
  }
  function next(){show(cur+1);}
  function prev(){show(cur-1);}

  window.addEventListener('resize',fit);
  window.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();next();}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();prev();}
    else if(e.key==='Home'){show(0);}
    else if(e.key==='End'){show(n-1);}
    else if(e.key==='f'||e.key==='F'){toggleFull();}
  });
  document.getElementById('prev').onclick=prev;
  document.getElementById('next').onclick=next;
  document.getElementById('full').onclick=toggleFull;
  function toggleFull(){
    if(!document.fullscreenElement) document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen().catch(function(){});
    else document.exitFullscreen&&document.exitFullscreen().catch(function(){});
  }

  var tx=null;
  window.addEventListener('touchstart',function(e){tx=e.changedTouches[0].clientX;},{passive:true});
  window.addEventListener('touchend',function(e){
    if(tx==null) return;
    var dx=tx-e.changedTouches[0].clientX;
    if(Math.abs(dx)>45) (dx>0?next:prev)();
    tx=null;
  },{passive:true});

  fit();
  if(exportMode){
    // Экспорт режимі: масштаб 1:1, тек сұралған слайд, анимациясыз.
    stage.style.transform='none';
    document.getElementById('viewport').style.alignItems='flex-start';
    document.getElementById('viewport').style.justifyContent='flex-start';
    document.querySelectorAll('.slide').forEach(function(el){el.style.transition='none';});
    show((parseInt(params.get('slide'),10)||1)-1);
  } else {
    show(0);
  }
  window.__slideCount=n;
  window.__ready=true;
})();
`;

  return '<!DOCTYPE html><html lang="kk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + safeTitle + '</title><style>' + css + '</style></head><body>' +
    '<div id="viewport"><div id="stage">' + slides + '</div></div>' +
    '<div id="ui"><button id="prev" type="button" aria-label="Алдыңғы">‹</button>' +
    '<span id="counter">1 / ' + Math.max(list.length, 1) + '</span>' +
    '<button id="next" type="button" aria-label="Келесі">›</button>' +
    '<button id="full" type="button" aria-label="Толық экран">⛶</button></div>' +
    '<div id="progress"></div>' +
    '<script>' + js + '</script></body></html>';
}

module.exports = { buildPresentationHTML, SLIDE_W, SLIDE_H };
    
