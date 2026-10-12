"""Готовую озвучку одним дублем (ElevenLabs и т.п.) режет по фразам и ставит на нужные секунды видео.
python3 marketing/place_vo.py [--audio vo/ru-elevenlabs.mp3] [--video out/deadline-promo-ru.mp4] [--out deadline-promo-ru-elevenlabs.mp4]
Границы фраз найдены по паузам (ffmpeg silencedetect) и сверены с распознаванием по словам.
"""
import argparse, os, subprocess
here = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--audio', default=os.path.join(here, 'vo', 'ru-elevenlabs.mp3'))
ap.add_argument('--video', default=os.path.join(here, 'out', 'deadline-promo-ru.mp4'))
ap.add_argument('--music', default=os.path.join(here, 'out', 'music.wav'))
ap.add_argument('--out', default='deadline-promo-ru-elevenlabs.mp4')
a = ap.parse_args()
# (из дубля: начало, конец, с) -> (в видео, с)   сцены: 3 отсчёт, 6 логотип, 9 демо, 17 фичи, 22 CTA
CUTS = [
 (0.00, 2.64, 0.25),   # Завтра дедлайн. А презентации нет?
 (3.00, 4.89, 3.15),   # Опять сидишь над слайдами всю ночь.
 (5.28, 6.09, 5.95),   # DeadLine.            — на удар логотипа (6.0)
 (6.40, 8.67, 6.95),   # Пишешь тему, получаешь презентацию.
 (8.88, 11.30, 9.35),  # Вводишь тему, жмёшь «Создать». — «Создать» на нажатии кнопки (~11.5)
 (11.50, 14.85, 13.70),# Минута — и слайды, графики и дизайн готовы. — слайды вылетают с 14.05
 (14.88, 18.56, 17.25),# Всё редактируется в PowerPoint, а текст доклада уже внутри.
 (18.78, 22.12, 22.10),# Первая презентация бесплатно. Жми и пробуй.
]
for i in range(len(CUTS) - 1):
    s, e, d = CUTS[i]; assert d + (e - s) <= CUTS[i + 1][2] + 0.01, f'фраза {i} наезжает на {i+1}'
flt = []
for i, (s, e, d) in enumerate(CUTS):
    ms = int(d * 1000); n = e - s
    flt.append(f'[2:a]atrim={s}:{e},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={n-0.03:.3f}:d=0.03,aresample=44100,adelay={ms}|{ms}[v{i}]')
flt.append(''.join(f'[v{i}]' for i in range(len(CUTS))) + f'amix=inputs={len(CUTS)}:normalize=0,highpass=f=80,acompressor=threshold=0.12:ratio=2.5:attack=5:release=120,volume=1.8,asplit=2[vo][sc]')
flt.append('[1:a]volume=0.7[bg]')
flt.append('[bg][sc]sidechaincompress=threshold=0.05:ratio=3:attack=10:release=200[duck]')
flt.append('[duck][vo]amix=inputs=2:normalize=0:duration=first,apad=pad_dur=1,loudnorm=I=-14:TP=-1.2:LRA=9,aresample=44100[aout]')
dst = os.path.join(here, 'out', a.out)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a.video, '-i', a.music, '-i', a.audio,
  '-filter_complex', ';'.join(flt), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-t', '26', '-movflags', '+faststart', dst], check=True)
print('done ->', dst)
