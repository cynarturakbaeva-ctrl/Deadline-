// node marketing/render.js [--cta "@bot_username"] [--fps 30]
const fs=require('fs'),path=require('path'),{spawn,execFileSync}=require('child_process');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d};
const CTA=arg('--cta','Telegram: DeadLine'),FPS=+arg('--fps',30);
const out=path.join(__dirname,'out');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'promo.html'),'utf8').replace('__CTA__',CTA);
 const tmp=path.join(__dirname,'.promo.tmp.html');fs.writeFileSync(tmp,html);
 const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium'});
 const p=await b.newPage({viewport:{width:1080,height:1920}});
 await p.goto('file://'+tmp);await p.evaluate(()=>document.fonts.ready);
 const dur=await p.evaluate(()=>DUR),N=Math.round(dur*FPS);
 const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-i',path.join(out,'music.wav'),
  '-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',path.join(out,'deadline-promo.mp4')],{stdio:['pipe','inherit','inherit']});
 for(let i=0;i<N;i++){
  await p.evaluate(t=>seek(t),i/FPS);
  const buf=await p.screenshot({type:'jpeg',quality:95});
  if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));
 }
 ff.stdin.end();await new Promise(r=>ff.on('close',r));
 await b.close();fs.unlinkSync(tmp);console.log('done',N,'frames');
})();
