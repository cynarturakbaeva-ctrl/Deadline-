# DeadLine v3 — AI Presentation Studio (Telegram Mini App)

Telegram **Mini App** + бот: тақырып/материал/шаблон → кәсіби PPTX + HTML презентация.

## Режимдер

Mini App-та презентация үшін екі режим (және реферат) бар:

| Режим | Не береді | Нәтиже |
|-------|-----------|--------|
| **✨ AI Presentation** | Тек тақырып немесе қысқа тапсырма | AI құрылым, мәтін, визуал, layout-ты өзі шешеді |
| **🎨 Template → Content** | Дайын шаблон (.pptx) + жаңа тақырып | Шаблонның дизайны (түс, шрифт, макет, құрылым) сақталып, ішіне жаңа мазмұн жазылады |

### Template → Content
- Референс PPTX толық талданады: Design DNA (түс/шрифт/тығыздық) + құрылым (рөлдер, макеттер, тор, қайталанатын элементтер).
- Жаңа контент шаблонның слайд қаңқасы бойынша жазылады; дизайн себепсіз өзгертілмейді.
- **Рендер жоқ**: клиенттің .pptx файлының XML-інде тек мәтін ауыстырылады, сондықтан қораптарды клиент кейін еркін өзгерте алады. Толтыру сәтсіз болса, сурет-слайдқа түспейді — қате қайтарылып, кредит қайтарылады.
- **Мәтін сыйғызу (templateLayout.js)**: мәтін қорапқа сыймаса, бот сатылап әрекет етеді — 1) қорапты бос орынға (төмен/оңға) үлкейтеді; 2) кедергі жасаған элементті (сурет, сызық, сәнді пішін) кішкене (≤0.8″) жылжытады; 3) қаріпті кішірейтеді; 4) ең соңында ғана мәтінді қысқартады. Мәтін мағынасыз қысқармайды.
- Аударудың керегі жоқ: тіл таңдау жасырылған, модель тақырыппен бірдей тілде жазады; міндетті «Кіріспе» слайды қосылмайды.
- Дайын презентацияға `templateQa.js` арқылы Template QA жүргізіледі: слайд саны, рөл реті, макет сәйкестігі, тығыздық, тема — `Template compliance: 6/6 ✓`.

## Файлдарды талдау (толық, filename-ға қарамай)

`POST /api/material` — PDF, DOC/DOCX, PPT/PPTX, TXT, сурет/screenshot (әрқайсысы 30 МБ-қа дейін, бірнеше файл). Мазмұны серверде толық оқылады, preview қайтарылады. Бірнеше файл бір тапсырма контексті ретінде қарастырылады.

## Не жаңа (v3)

- **Telegram Mini App** — стиль, тіл, слайд саны, аудитория, нақты уақыт прогресс, тарих, жүктеу
- **HTTP API** — job queue, auth via Telegram `initData` (HMAC)
- **Тарих** — соңғы презентациялар
- **Бот** — төлем (Kaspi PDF), реферал, хабарламалар, Mini App deep-link
- Бұрынғы сапа пайплайны сақталған (QC → Vision Critic → quality gate)

## Папка құрылымы (v4)

```
core/                ортақ: cost, tmpFiles, receipt, pricing
products/
  presentation/      слайд пайплайны (index.js = generatePresentation, design/, assets/)
  referat/           реферат пайплайны (index.js = generateReferat, docx, layout, font, zipmin)
requirements/        промттағы талаптар → RequirementSet → тексеру → есеп (schema, baseline, checkers, judge, report)
design-dna/          PPTX-референс толық талдау: DNA (pptxDna.js) + құрылым/рөл/макет/қайталанатын элементтер (structure.js), index.js = analyzeReference
server.js, bot.js    тек тіркеу және тасымалдау
```

Ескі көпір-файлдар (`index.js`, `pricing.js`, `pipeline/*`) өшірілді — тек жаңа жолдар қолданылады.

## Архитектура

```
Пайдаланушы
    │
    ├─► Telegram Bot (төлем / реферал / хабар)
    │
    └─► Mini App (webapp/) ──► Express API (server.js)
                                    │
                                    ▼
                              Job queue + DB (JSON)
                                    │
                                    ▼
                         generatePresentation (index.js)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
         DeepSeek content      Images/SVG            HTML (source of truth)
              │                     │                     │
              └─────────────────────┴──► Puppeteer PNG ──► PPTX
```

## Pipeline (сапа)

`Тақырып → мазмұн → QC → quality loop → narrative → composition → sources → images → visual SVG → HTML → render QA → Vision Critic → redesign → PPTX`

Сапа қақпасы: overflow/бос слайд табылса — толық қайта генерация (1 рет). Екінші сәтсіздік — кредит қайтарылады.

## Іске қосу

```bash
cp .env.example .env   # мәндерді толтырыңыз
npm install
npm start              # server.js — API + Mini App + Bot
```

Тек бот (ескі режим): `npm run bot-only`

### Міндетті env

| Айнымалы | Сипаттама |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | Бот токені |
| `DEEPSEEK_API_KEY` | Мазмұн генерациясы |
| `ADMIN_CHAT_ID` | Чек растау |
| `BOT_USERNAME` | @сыз username |
| `WEBAPP_URL` | HTTPS URL Mini App үшін (мыс. `https://your.domain`) |
| `PORT` | Әдепкі 3000 |

### Қосымша

`UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `VISUAL_*`, `ANTHROPIC_API_KEY`, `DB_FILE`, `MAX_CONCURRENT_GENERATIONS`, `WEBAPP_DEV=1` (локал тест)

### Telegram-да Mini App баптау

1. @BotFather → `/newapp` немесе `/setmenubutton`
2. Web App URL: `https://YOUR_DOMAIN/webapp/`
3. HTTPS міндетті (Telegram талап етеді)
4. Серверді reverse proxy (nginx/caddy) арқылы қосыңыз

## API (қысқаша)

- `GET /api/me` — пайдаланушы + кредит
- `POST /api/material` — материал жүктеу (PDF/DOC(X)/PPT(X)/TXT/сурет) → `{ materialId, kind, preview }`
- `POST /api/reference` — шаблон PPTX жүктеу → `{ refId, lines, slides }`
- `POST /api/generate` — `{ topic, mode: 'presentation'|'template'|'referat', materialIds?, refId?, requirements?, ... }` → `{ jobId }`
- `GET /api/job/:id` — статус / прогресс / `requirementsReport` / `templateReport`
- `GET /api/job/:id/download/pptx|html|docx`
- `GET /api/history`
- Auth: header `X-Telegram-Init-Data`

## База

Локалды JSON (`./data/db.json`): users, jobs, history. Backup `.bak`.

## Тест

```bash
npm test
```

## Нұсқа

- **2.2** — quality pipeline, Vision Critic, Inter font embed
- **3.0** — Mini App + full service API + job history

## Дизайн жүйесі (v3.1)

`products/presentation/html3DBuilder.js` енді жұқа оркестратор; барлық шешім `products/presentation/design/` ішінде:

| Қабат | Файл | Міндеті |
|-------|------|---------|
| CONTENT | `analyze.js` | слайд мазмұнын талдау → слайд түрін жіктеу (cover, section, statement, split, imageFocus, editorial, points, stats, number, timeline, process, hierarchy, table, diagram, quote, closing, references) → колода ырғағы (қатар бір композиция қайталанбайды, сурет жағы ауысады) |
| LAYOUT | `layouts.js` | әр түрге жеке композиция, 12 бағандық тор бойынша |
| STYLE | `tokens.js`, `typography.js`, `style.js` | spacing/radius/shadow/grid/type scale/палитра токендері; мәтін өлшемі ұзындығы мен баған енінен есептеледі |
| ASSETS | `imagery.js`, `assets/` | фокус нүктесі, кроп, ракурсқа сай панель, scrim; ендірілген қаріптер (Inter, Lora) |
| RENDER | `html3DBuilder.js`, `runtime.js` | HTML жинау, навигация/ауысулар |
| QUALITY | `qa.js` | HTML ішінде: overflow, overlap, safe-area, майда мәтін, тығыздық тексеру → авто-түзету (өлшемді азайту, әлсіз элементті алып тастау) → қайта өлшеу |

Жаңа стиль = жаңа палитра/tone (`tokens.js` → `MOODS`, `TYPE_STYLES`); layout қайта жазылмайды.
Қозғалтқыш қате берсе, `html3DBuilder.legacy.js` автоматты түрде қолданылады.

Көзбен тексеру: `node scripts/design-preview.js ./out [deck.json]` (PNG + QA есебі).

## Суреттер (v3.1 fix)

Провайдер реті: Pexels → Unsplash → Pixabay → Wikimedia (соңғы резерв). Өзгерту: `IMAGE_PROVIDER_ORDER=wikimedia,pexels,unsplash,pixabay`.
Ең кіші сурет ені: `IMAGE_MIN_WIDTH` (әдепкі 900). Жүктелмеген сурет болса, келесі кандидатқа автоматты өтеді.

## База

`db.js` — дерекқор таңдаушы: `DATABASE_URL` болса PostgreSQL (`storage/pgDb.js`), болмаса жергілікті JSON (`storage/jsonDb.js`, `data/db.json`).

## Дизайн әртүрлілігі (v3.2)

- Түс темасын LLM емес, **код** таңдайды: `products/presentation/design/tokens.js` → `pickTheme()` (14 тема: қараңғы және ашық). Тақырып + жұмыс id бойынша кездейсоқ, қатарынан екі презентация бірдей болмайды. Клиент «қара фон / светлая тема» деп жазса, соны орындайды. Қара-алтын `dark` тек сұраса ғана.
- Фон декорациясы (`orbs`, `grid`, `rings`, `dots`, `diagonal`, `bands`) әр темаға тіркелген, сурет жоқ слайдтарда салынады: `style.js` → `.deco-*`.
- Кесте шектеуі: 4 слайдқа ≤1 кесте, қатар емес, артығы буллетке айналады: `products/presentation/deckPolish.js`.
- Сурет іздеу тек ағылшынша (латын) сұраныспен. Қазақша/орысша сұраныс ешқашан жіберілмейді.

## Реферат режимі

Mini App-та «📄 Реферат» таңдалады: тақырып, бет саны (5–30), тіл, титул деректері (университет, факультет, кафедра, топ, қала, орындаған, тексерген).
Нәтиже — Word (`.docx`): титул, мазмұны, кіріспе, тараулар, қорытынды, әдебиеттер. Times New Roman 14, жол аралығы 24pt, жиектері 30/10/20/20 мм, қызыл жол 1.25 см, бет нөмірі төменде ортада.
Бос орын болмауы үшін: тараулар жаңа беттен басталмайды, тақырып беттің түбінде жалғыз қалмайды, көлем сұралған бет санына дәл келтіріледі, соңғы бет толық.
Қосымша npm пакет керек емес (docx файлы өз ішіндегі `products/referat/zipmin.js` арқылы жиналады). Әдебиеттер тізімін қолданушы тексеруі тиіс.


## Railway + PostgreSQL

1. Railway жобасына PostgreSQL қосыңыз (бар болса — сол). Бот сервисінің Variables бөлімінде:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway reference)
   - `TELEGRAM_BOT_TOKEN`, `DEEPSEEK_API_KEY`, `WEBAPP_URL` (сервистің домені), `ADMIN_CHAT_ID` және т.б.
   - сыртқы (public) URL арқылы қосылсаңыз және SSL талап етілсе: `DATABASE_SSL=1`
2. Start command: `npm start` (`node server.js`). Health check: `/api/health`.
3. Іске қосылғанда кестелер өздігінен жасалады; бар кестелерде тек жетіспейтін бағандар қосылады — ештеңе жойылмайды.
4. Railway дискі уақытша: дайын файлдар (`jobs/`) қайта deploy-да өшеді. Сақтау керек болса Volume қосып, `JOBS_DIR=/data/jobs` беріңіз.
5. Puppeteer Chrome-ы `.cache/puppeteer` ішіне жүктеледі (`.puppeteerrc.cjs`). Рендер «Could not find Chrome» немесе жүйелік кітапхана қатесін берсе, `PUPPETEER_EXECUTABLE_PATH` арқылы жүйедегі Chromium-ды көрсетіңіз.
6. `package-lock.json` жоқ (ескісі package.json-мен сәйкес емес еді). Жергілікті `npm install` жасап, жаңа lock-ты commit етсеңіз, нұсқалар бекітіледі.

7. Ескі нәтижелер автоматты өшеді: `JOB_RETENTION_HOURS` (әдепкі 48) сағаттан ескі жұмыстар, тарих, дайын файлдар, жүктелген шаблондар мен материалдар — базадан да, дисктен де. Тазалау іске қосылғанда және сағат сайын жүреді. Пайдаланушылар, кредиттер мен чектер өшпейді.

PostgreSQL тесті: `TEST_DATABASE_URL=postgres://... npm test` (тек бос тест базасын беріңіз).


## Серіктес бағдарламасы (30%)

Клиент әкелген серіктес сол клиенттің **әр төлемінен 30%** алады (мәңгі). `PARTNER_RATE` env-мен өзгертіледі (әдепкі 0.3).

- Қолданушы «🤝 Серіктес болу» басады → админге «✅ Рұқсат / ❌ Бас тарту» батырмалары бар сұраныс барады.
- Рұқсаттан кейін ғана пайыз есептеледі (бұрынғы төлемдерге — жоқ). Әр чек бір рет (қайталанбайды).
- Серіктес кабинетінде: сілтеме, баланс, тапқаны, аударылғаны, клиент саны. Төлем кезінде серіктеске хабарлама барады.
- Админ командалары: `/partners` — тізім; `/payout <chatId> <сома>` — Kaspi-мен аударғаннан кейін баланстан алып тастау.
- Қолмен растауда (чек парсингсіз) сома кредит санынан бағамен есептеледі.
- Postgres-те жаңа бағандар (`users.partner_*`) мен `partner_log` кестесі автоматты қосылады; бар деректер сақталады.
