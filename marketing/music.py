"""Бит 120 BPM под монтаж промо (26 с). Сцены: 0 хук, 3 отсчёт, 6 логотип (дроп), 9 демо, 17 фичи, 22 CTA.
python3 marketing/music.py  ->  marketing/out/music.wav"""
import numpy as np, os, wave
from scipy.signal import butter, lfilter
SR=44100; BPM=120; B=60/BPM; DUR=26.0; N=int(SR*DUR)
rng=np.random.default_rng(7)
L=np.zeros(N); R=np.zeros(N)
def add(sig,t,g=1.0,pan=0.0):
    i=int(t*SR); s=sig[:max(0,N-i)]*g
    L[i:i+len(s)]+=s*(1-pan)/1.0 if pan>0 else s; R[i:i+len(s)]+=s*(1+pan) if pan<0 else s
def env(n,a=0.002,d=0.2):
    t=np.arange(n)/SR; e=np.exp(-t/d); k=int(a*SR)
    if k: e[:k]*=np.linspace(0,1,k)
    return e
def flt(x,f,kind='low',o=2):
    b,a=butter(o,np.clip(np.array(f)/(SR/2),1e-4,.999),btype=kind); return lfilter(b,a,x)
def kick(g=1):
    n=int(.45*SR); t=np.arange(n)/SR; f=45+110*np.exp(-t/.035)
    return np.tanh(2.2*np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,.001,.16))*g
def clap():
    n=int(.25*SR); x=flt(rng.standard_normal(n),[900,4000],'band')
    e=env(n,.001,.07); e[:int(.03*SR)]*=1+.6*np.sin(np.arange(int(.03*SR))/SR*2*np.pi*90)
    return x*e*1.4
def hat(d=.03): n=int(.12*SR); return flt(rng.standard_normal(n),7000,'high')*env(n,.0005,d)
def tick(): n=int(.05*SR); t=np.arange(n)/SR; return np.sin(2*np.pi*2400*t)*env(n,.0005,.008)
def saw(f,n,det=(0,)):
    t=np.arange(n)/SR; return sum(2*((t*f*(1+d))%1)-1 for d in det)/len(det)
def bass(f,dur):
    n=int(dur*SR); x=.6*saw(f,n)+.5*np.sin(2*np.pi*f*np.arange(n)/SR)
    return np.tanh(1.5*flt(x,380))*env(n,.004,dur*.9)
def pad(fs,dur,cut=2200):
    n=int(dur*SR); x=sum(saw(f,n,(-.006,0,.007)) for f in fs)/len(fs)
    e=np.minimum(1,np.arange(n)/(.03*SR))*np.minimum(1,(n-np.arange(n))/(.08*SR))
    return flt(x,cut)*e
def pluck(f,dur=.22): n=int(dur*SR); return flt(saw(f,n,(-.004,.004)),3200)*env(n,.002,.09)
def riser(dur):
    n=int(dur*SR); t=np.arange(n)/SR; x=flt(rng.standard_normal(n),[1500,9000],'band')
    sw=np.sin(2*np.pi*np.cumsum(200+1800*(t/dur)**2)/SR)*.25
    return (x*.7+sw)*(t/dur)**2
def impact():
    n=int(1.6*SR); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(38+60*np.exp(-t/.08))/SR)*env(n,.001,.5)
    return np.tanh(1.6*boom)+flt(rng.standard_normal(n),3000)*env(n,.001,.25)*.5
hz=lambda m:440*2**((m-69)/12)
# Am – F – C – G, по такту (2 c)
PROG=[(45,[57,60,64]),(41,[57,60,65]),(48,[55,60,64]),(43,[55,59,62])]
def section(t0,t1,full=True,hats8=True,clp=True,bss=True,pd=True,plk=False):
    t=t0
    while t<t1-1e-6:
        beat=int(round(t/B)); bar=beat//4; root,ch=PROG[bar%4]
        add(kick(),t,.72)
        if clp and beat%4 in (1,3): add(clap(),t,.55)
        if hats8:
            add(hat(),t+B/2,.22,.3)
            if full: add(hat(.015),t+B*.75,.12,-.3)
        if bss:
            for k in (0,.5): add(bass(hz(root+(12 if k and beat%2 else 0)),B*.45),t+k*B,.5)
        if pd and beat%4==0: add(pad([hz(m) for m in ch],min(4*B,t1-t)),t,.16)
        if plk and full:
            arp=[ch[0]+12,ch[1]+12,ch[2]+12,ch[1]+12]
            add(pluck(hz(arp[beat%4])),t+B/2,.16,(-.4 if beat%2 else .4))
        t+=B
# 0–3: напряжение — бочка, тиканье, низкий дрон
for i in range(6): add(kick(),i*B,.75); add(tick(),i*B+B/2,.25)
add(pad([hz(45),hz(52)],3.0,700),0,.25)
# 3–6: отсчёт — тиканье 16-ми, бочка, райзер в дроп
t=3.0
while t<6-1e-6:
    add(kick(),t,.8); [add(tick(),t+k*B/4,.18+.06*k) for k in range(1,4)]; t+=B
add(pad([hz(45),hz(57),hz(60)],3.0,600),3.0,.22)
add(riser(2.0),4.0,.45)
# 6: дроп на логотипе
add(impact(),6.0,.75)
section(6.0,9.0,full=False,plk=False)
section(9.0,17.0,full=True,plk=True)
add(riser(1.0),16.0,.3); add(impact(),17.0,.45)
section(17.0,22.0,full=True,plk=True)
add(riser(1.0),21.0,.3); add(impact(),22.0,.6)
section(22.0,25.0,full=True,plk=True)
add(impact(),25.0,.7); add(pad([hz(m) for m in (45,57,60,64)],1.0,1500),25.0,.2)
# мастер
mix=np.stack([L,R],1)
mix=np.tanh(mix*1.1)/np.tanh(1.1)
fade=np.ones(N); k=int(.6*SR); fade[-k:]=np.linspace(1,0,k); mix*=fade[:,None]
mix/=np.max(np.abs(mix))/0.89
os.makedirs(os.path.join(os.path.dirname(__file__),'out'),exist_ok=True)
with wave.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'out','music.wav'),'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype('<i2').tobytes())
print('music.wav ok')
