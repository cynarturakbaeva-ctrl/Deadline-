"""Озвучка: Piper (офлайн TTS) -> фразы на сменах сцен (120 BPM) -> музыка приглушается под голос -> mp4.
python3 marketing/voice.py --lang ru --model ru_RU-dmitri-medium.onnx [--speed 0.9] [--out имя.mp4]
python3 marketing/voice.py --lang kk --model kk_KZ-issai-high.onnx --speaker 1
Голоса: https://huggingface.co/rhasspy/piper-voices (ru: dmitri, ruslan, denis, irina; kk: issai-high 0-5).  pip install piper-tts
Видео берётся из out/deadline-promo-<lang>.mp4 (render.js), музыка из out/music.wav (music.py).
"""
import argparse, subprocess, os, sys
ap = argparse.ArgumentParser()
ap.add_argument('--lang', default='ru')
ap.add_argument('--model', default=os.environ.get('PIPER_MODEL'))
ap.add_argument('--speaker', type=int)
ap.add_argument('--speed', type=float, default=0.9, help='length_scale: меньше = быстрее')
ap.add_argument('--out')
a = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, 'out'); tmp = os.path.join(out, 'vo'); os.makedirs(tmp, exist_ok=True)
# (старт, с; максимум, с; текст). Сцены меняются на 3, 6, 9, 17, 22 с.
LINES = {
 'ru': [
  (0.25, 2.6, "Завтра дедлайн, а презентации нет?"),
  (3.1, 2.8, "Опять сидишь над слайдами всю ночь?"),
  (6.15, 2.75, "Дэдлайн. Напиши тему — получи презентацию."),
  (9.25, 4.4, "Вводишь тему и жмёшь «Создать»."),
  (13.95, 3.4, "Минута — и слайды, графики и дизайн готовы."),
  (17.4, 4.6, "Редактируешь в Пауэрпойнте, а текст доклада уже готов."),
  (22.15, 3.6, "Первая презентация — бесплатно. Открывай в Телеграме!"),
 ],
 'kk': [
  (0.25, 2.6, "Ертең дедлайн, ал презентация жоқ?"),
  (3.1, 2.8, "Түнімен слайд жасап отырмай-ақ қой."),
  (6.15, 2.75, "Дедлайн: тақырып жаз, презентация дайын."),
  (9.25, 4.4, "Тақырыпты жазып, «Жасау» батырмасын бас."),
  (13.95, 3.4, "Бір минутта слайдтар мен дизайн дайын."),
  (17.4, 4.6, "Өзің өңдейсің, баяндама мәтіні бар, өз шаблоның да болады."),
  (22.15, 3.6, "Бірінші презентация тегін! Телеграмнан тауып ал!"),
 ],
}[a.lang]
def dur(p): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]).decode())
def synth(text, path, ls):
    cmd=[sys.executable,'-m','piper','-m',a.model,'--length-scale',f'{ls:.3f}','-f',path]
    if a.speaker is not None: cmd+=['--speaker',str(a.speaker)]
    subprocess.run(cmd,input=text.encode(),check=True,capture_output=True)
files=[]
for i,(st,mx,txt) in enumerate(LINES):
    p=os.path.join(tmp,f'{a.lang}{i}.wav'); ls=a.speed; synth(txt,p,ls); d=dur(p)
    if d>mx: ls=max(a.speed*0.88,ls*mx/d*0.97); synth(txt,p,ls); d=dur(p)
    print(f'{i}: {st:5.2f}s  {d:4.2f}s / {mx}s  length_scale={ls:.2f}  {"OK" if d<=mx+.1 else "ДЛИННО"}')
    files.append((st,p))
inputs=[]; flt=[]
for i,(st,p) in enumerate(files):
    inputs+=['-i',p]; ms=int(st*1000)
    flt.append(f'[{i+2}:a]aresample=44100,highpass=f=90,acompressor=threshold=0.1:ratio=3:attack=5:release=80,adelay={ms}|{ms},volume=2.2[v{i}]')
mix=''.join(f'[v{i}]' for i in range(len(files)))
flt.append(f'{mix}amix=inputs={len(files)}:normalize=0,asplit=2[vo][sc]')
flt.append('[1:a]volume=0.75[bg]')
flt.append('[bg][sc]sidechaincompress=threshold=0.05:ratio=3:attack=10:release=200[duck]')
flt.append('[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.2:LRA=9,aresample=44100[aout]')
dst=os.path.join(out,a.out or f'deadline-promo-{a.lang}-voice.mp4')
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',os.path.join(out,f'deadline-promo-{a.lang}.mp4'),'-i',os.path.join(out,'music.wav'),*inputs,
  '-filter_complex',';'.join(flt),'-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',dst],check=True)
print('done ->',dst)
