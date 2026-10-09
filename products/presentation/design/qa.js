'use strict';
/**
 * VISUAL QUALITY CHECK + ITERATION.
 *  • QA_SCRIPT runs INSIDE the generated HTML (so the .html download and the PPTX PNGs are identical):
 *    measures every slide, detects overflow / overlap / safe-area violations / tiny text /
 *    overcrowding / emptiness, then REVISES the slide (scale type, drop the weakest item) and
 *    re-measures until the slide passes. Results are published in window.__designReport.
 *  • reviewDeckPlan() is the Node-side deck-level review (rhythm, monotony).
 */
const { GRID } = require('./tokens');

const QA_SCRIPT = `
(function(){'use strict';
var MX=${GRID.marginX},MT=${GRID.marginTop},MB=${GRID.marginBottom},W=${GRID.W},H=${GRID.H},TOL=6,MIN_FONT=20;
var stage=document.getElementById('stage');
function k(){return parseFloat(getComputedStyle(stage).getPropertyValue('--fit'))||1;}
function rect(el,sr,kk){var r=el.getBoundingClientRect();return{x:(r.left-sr.left)/kk,y:(r.top-sr.top)/kk,w:r.width/kk,h:r.height/kk};}
function contains(a,b){return a.contains(b)||b.contains(a);}
function textNodesMinFont(slide,fs){
  var min=999,w=document.createTreeWalker(slide,NodeFilter.SHOW_TEXT,null),n,seen=0;
  while((n=w.nextNode())){
    if(!n.nodeValue.trim())continue; var p=n.parentElement; if(!p||p.closest('.folio'))continue;
    var cs=getComputedStyle(p); if(cs.display==='none'||p.closest('[data-dropped]'))continue;
    var f=parseFloat(cs.fontSize); if(f<min)min=f; seen++;
  }
  return seen?min:null;
}
function measure(slide){
  var kk=k(),sr=slide.getBoundingClientRect(),issues=[];
  var cs0=getComputedStyle(slide);
  function iv(n,d){var x=parseFloat(cs0.getPropertyValue(n));return isNaN(x)?d:Math.min(d,x);}
  var mL=iv('--cl',MX),mR=iv('--cr',MX),mT=iv('--ct',MT),mB=iv('--cb',MB);
  var els=[].slice.call(slide.querySelectorAll('[data-role]')).filter(function(e){return e.getAttribute('data-role')!=='folio'&&e.offsetWidth>0;});
  var rects=els.map(function(e){return rect(e,sr,kk);});
  var area=0;
  els.forEach(function(e,i){
    var r=rects[i],role=e.getAttribute('data-role'),bleed=e.hasAttribute('data-bleed');
    if(!bleed&&(r.x<mL-TOL||r.x+r.w>W-mR+TOL||r.y<mT-TOL||r.y+r.h>H-mB+TOL))issues.push({type:'safe-area',hard:true,detail:role+' '+Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.w)+'x'+Math.round(r.h)});
    
    if(!bleed&&role!=='photo')area+=r.w*r.h;
  });
  [].forEach.call(slide.querySelectorAll('.title,.qtext,.row-l,.concept-l,.st-l,.hn-l'),function(e){if(e.offsetWidth>0&&e.scrollWidth>e.clientWidth+2)issues.push({type:'word-overflow',hard:true,detail:e.className+' '+(e.textContent||'').slice(0,24)});});
  [].forEach.call(slide.querySelectorAll('.stat-v,.mega,.tl-date,.numeral-xl,.st-n'),function(e){var box=e.parentElement;if(e.scrollWidth>e.clientWidth+3||(box&&e.offsetWidth>box.clientWidth+3))issues.push({type:'h-overflow',hard:true,detail:e.className});});
  for(var i=0;i<els.length;i++)for(var j=i+1;j<els.length;j++){
    if(contains(els[i],els[j]))continue;
    var a=rects[i],b=rects[j],ix=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),iy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    if(ix>4&&iy>4&&ix*iy>60)issues.push({type:'overlap',hard:true,detail:els[i].getAttribute('data-role')+'×'+els[j].getAttribute('data-role')});
  }
  var contentArea=(W-2*MX)*(H-MT-MB),density=area/contentArea;
  var mf=textNodesMinFont(slide,1);
  if(mf!=null&&mf<MIN_FONT)issues.push({type:'small-text',hard:false,detail:Math.round(mf)+'px'});
  if(density>0.9)issues.push({type:'crowded',hard:false,detail:density.toFixed(2)});
  if(density<0.08&&!slide.querySelector('.full,.bleed'))issues.push({type:'sparse',hard:false,detail:density.toFixed(2)});
  var t=slide.querySelector('.title,.qtext'),body=slide.querySelector('.para,.prose p,.lead,.row-l');
  if(t&&body){var tf=parseFloat(getComputedStyle(t).fontSize),bf=parseFloat(getComputedStyle(body).fontSize);if(tf<bf*1.25)issues.push({type:'weak-hierarchy',hard:false,detail:Math.round(tf)+'/'+Math.round(bf)});}
  return {issues:issues,density:density,minFont:mf};
}
function revise(slide){
  var steps=[1,.95,.9],drops=0,fs=1,res,idx=0,report={fs:1,dropped:0,iterations:0};
  function set(v){fs=v;slide.style.setProperty('--fs',String(v));}
  set(1);res=measure(slide);
  function hard(r){return r.issues.filter(function(i){return i.hard;});}
  var plan=[.95,.9,'drop','photo',.95,.9,'drop','note',.86,.82,.78,.74,.68,.62];
  for(var p=0;p<plan.length&&hard(res).length;p++){
    var step=plan[p];report.iterations++;
    if(step==='photo'){
      var ph=slide.querySelector('.cell-photo:not([data-dropped])');
      if(ph){ph.setAttribute('data-dropped','1');ph.style.display='none';drops++;set(1);}
    } else if(step==='note'){
      var ns=slide.querySelectorAll('.notes li:not([data-dropped])');
      if(ns.length>=2){var last=ns[ns.length-1];last.setAttribute('data-dropped','1');last.style.display='none';drops++;set(1);}
    } else if(step==='drop'){
      var items=slide.querySelectorAll('.drop:not([data-dropped])');
      if(items.length>=3){items[items.length-1].setAttribute('data-dropped','1');items[items.length-1].style.display='none';drops++;set(1);}
    } else set(step);
    res=measure(slide);
  }
  report.fs=fs;report.dropped=drops;report.issues=res.issues;report.density=+res.density.toFixed(3);report.minFont=res.minFont?Math.round(res.minFont):null;
  report.hard=hard(res).length>0;
  return report;
}
function run(){
  stage.classList.add('measuring');
  var out=[];
  [].forEach.call(document.querySelectorAll('.slide'),function(s,i){
    var r=revise(s);r.index=i+1;r.layout=s.getAttribute('data-layout');out.push(r);
  });
  stage.classList.remove('measuring');
  window.__designReport=out;
  return out;
}
var fontsReady=new Promise(function(res){
  try{document.fonts.forEach(function(f){f.load().catch(function(){});});}catch(e){}
  (document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){res();});
});
window.__qaDone=fontsReady.then(function(){return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r(run());});});});});
window.__runDesignQA=run;
})();
`;

/** Deck-level review on the plan: flags monotony and weak rhythm (used for logging / tests). */
function reviewDeckPlan(plan) {
  const warnings = [];
  const layouts = plan.map((p) => p.layout);
  for (let i = 2; i < layouts.length; i++) {
    if (layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2]) warnings.push('monotony: ' + layouts[i] + ' ×3 at slide ' + (i + 1));
  }
  const counts = {};
  layouts.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (layouts.length >= 6 && top && top[1] / layouts.length > 0.5) warnings.push('dominant layout: ' + top[0] + ' (' + top[1] + '/' + layouts.length + ')');
  return warnings;
}

module.exports = { QA_SCRIPT, reviewDeckPlan };
