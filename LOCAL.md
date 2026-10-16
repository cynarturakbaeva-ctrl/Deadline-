# DeadLine — жергілікті іске қосу (PostgreSQL-сіз)

Керегі: **Node.js 18+**. Дерекқор — жергілікті JSON файл (`data/db.json`), `DATABASE_URL` бермесеңіз автоматты түрде сол қолданылады.

## 1. Орнату
```bash
npm install          # Chrome (puppeteer) өзі жүктеледі
```

## 2. Кілтсіз демо (ең жылдам тексеру)
```bash
node scripts/local-demo.js local-demo
```
`local-demo/index.html` файлын браузерде ашыңыз: 6 дизайн жүйесі және бір студенттің 5 презентациясы (әрқайсысы басқа дизайн).

## 3. Тесттер
```bash
npm test
```

## 4. Толық бот (презентация жасау)
```bash
cp .env.example .env     # TELEGRAM_BOT_TOKEN (тест бот), DEEPSEEK_API_KEY, қаласаңыз PEXELS/GOOGLE кілттерін толтырыңыз
npm start
```
Ескерту: жұмыс істеп тұрған ботпен бір токенді қатар қоспаңыз — тест үшін @BotFather-да бөлек бот ашыңыз.
Кілттер `.env` файлында ғана сақталады, оны ешкімге жібермеңіз.
