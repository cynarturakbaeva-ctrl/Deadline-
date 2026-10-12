"""Озвучка: Piper (офлайн қазақ TTS) -> сценаларға уақыттап -> музыкамен араластырып mp4-ке қосады.
python3 marketing/voice.py [--speaker 1] [--model /path/kk_KZ-issai-high.onnx]
Дауыс (issai-high): 0 M2, 1 M1 Iseke, 2 F3, 3 F1 Raya, 4 F1, 5 F2.  pip install piper-tts
"""
import argparse, subprocess, os, sys
ap = argparse.ArgumentParser()
ap.add_argument('--speaker', type=int, default=1)
ap.add_argument('--model', default=os.environ.get('PIPER_MODEL', 'kk_KZ-issai-high.onnx'))
ap.add_argument('--out', default='deadline-promo-voice.mp4')
a = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, 'out'); tmp = os.path.join(out, 'vo'); os.makedirs(tmp, exist_ok=True)
# (басталуы с, ең көп ұзақтығы с, мәтін)
LINES = [
 (0.3, 2.9, "Ертең дедлайн, ал презентация жоқ?"),
 (3.5, 2.9, "Түнімен слайд жасап отырмай-ақ қой."),
 (6.6, 3.0, "Дедлайн: тақырып жаз, презентация дайын."),
 (10.0, 7.0, "Тақырыпты енгіз, бір минутта слайдтар, диаграммалар және дизайн дайын болады."),
 (17.5, 4.6, "Өзің өңдейсің, баяндама мәтіні бар, өз шаблоның да болады."),
 (22.1, 3.6, "Бірінші презентация тегін! Телеграмнан тауып ал!"),
]
def dur(p): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]).decode())
def synth(text, path, ls):
    subprocess.run([sys.executable,'-m','piper','-m',a.model,'--speaker',str(a.speaker),'--length-scale',f'{ls:.3f}','-f',path],input=text.encode(),check=True,capture_output=True)
files=[]
for i,(st,mx,txt) in enumerate(LINES):
    p=os.path.join(tmp,f'l{i}.wav'); ls=1.0; synth(txt,p,ls); d=dur(p)
    if d>mx: ls=max(0.85,mx/d*0.97); synth(txt,p,ls); d=dur(p)
    print(f'{i}: {st:5.1f}s  {d:4.2f}s / {mx}s  length_scale={ls:.2f}  {"OK" if d<=mx+.05 else "ТЫМ ҰЗЫН"}')
    files.append((st,p))
inputs=[]; flt=[]
for i,(st,p) in enumerate(files):
    inputs+=['-i',p]; flt.append(f'[{i+2}:a]aresample=44100,adelay={int(st*1000)}|{int(st*1000)},volume=1.6[v{i}]')
mix=''.join(f'[v{i}]' for i in range(len(files)))
flt.append(f'{mix}amix=inputs={len(files)}:normalize=0[vo]')
flt.append('[1:a]volume=0.28[bg]')
flt.append('[bg][vo]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]')
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',os.path.join(out,'deadline-promo.mp4'),'-i',os.path.join(out,'music.wav'),*inputs,
  '-filter_complex',';'.join(flt),'-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',os.path.join(out,a.out)],check=True)
print('done ->',os.path.join(out,a.out))
