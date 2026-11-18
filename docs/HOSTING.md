# Розгортання на Vercel + Railway / Hosting on Vercel + Railway

[Українська](#українська) · [English](#english)

---

## Українська

Схема: **сайт (Next.js) на Vercel**, **API (FastAPI + SQLite) на Railway**. Браузер відвідувача звертається до API напряму, тому API має дозволити адресу сайту (CORS). Паролів немає, секретів для входу теж.

```
Браузер ──► Vercel (сайт)            NEXT_PUBLIC_API_URL
   │
   └──────► Railway (API, /health) ──► том /data (SQLite-бази відвідувачів)
```

### 0. Що потрібно

- Акаунти на [GitHub](https://github.com), [Railway](https://railway.com) і [Vercel](https://vercel.com).
- Репозиторій із цим проєктом на GitHub. Корінь репозиторію містить `Dockerfile`, `railway.toml`, `backend/` і `vita-astronaut-health-monitor/frontend/`.

### 1. API на Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → оберіть репозиторій.
2. Railway знайде `railway.toml` у корені й збере образ із `Dockerfile` (кореневий каталог — корінь репозиторію, нічого міняти не треба). Перевірка стану — `/health`.
3. **Том для баз.** Сервіс → **Settings → Volumes → Add Volume**, шлях монтування `/data`. Без тому дані зникають при кожному деплої (для демо це допустимо, але тоді пропустіть `DATA_DIR`).
4. **Змінні.** Сервіс → **Variables**:

   | Змінна | Значення | Навіщо |
   |---|---|---|
   | `DATA_DIR` | `/data` | де лежать бази відвідувачів і ключ підпису аудиту |
   | `SIGNAL_DELAY_SEC` | `1200` | затримка Землі, 20 хвилин симульованого часу |
   | `DEMO_MODE` | `true` | залишає демо-ендпоінт перевірки підпису |
   | `MAX_WORKSPACES` | `40` | скільки просторів тримати одночасно |
   | `WORKSPACE_TTL_SEC` | `10800` | через скільки секунд бездіяльності простір видаляється |
   | `CORS_ORIGINS` | `https://ВАШ-САЙТ.vercel.app` | дозволені адреси сайту, через кому |
   | `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` | (необов'язково) дозволяє й прев'ю-розгортання Vercel |

   `PORT` Railway задає сам.
5. **Settings → Networking → Generate Domain.** Скопіюйте адресу виду `https://errno-api-production.up.railway.app`.
6. Перевірте: відкрийте `https://…up.railway.app/health`, має бути `{"status":"ok"}`.

Тримайте **одну репліку**: простори живуть у пам'яті процесу, тож кілька реплік розірвали б відвідувача між різними копіями.

### 2. Сайт на Vercel

1. Vercel → **Add New → Project** → імпортуйте той самий репозиторій.
2. **Root Directory**: `vita-astronaut-health-monitor/frontend`. Framework: Next.js (визначиться сам), Node 22.
3. **Environment Variables**: `NEXT_PUBLIC_API_URL` = адреса з Railway **без** кінцевого `/`, наприклад `https://errno-api-production.up.railway.app`.
4. **Deploy.** Змінна `NEXT_PUBLIC_*` вшивається під час збірки: змінили її — зробіть **Redeploy**.
5. Скопіюйте адресу сайту (`https://….vercel.app`) і впишіть її в `CORS_ORIGINS` на Railway (змінні застосуються після автоматичного перезапуску).

### 3. Перевірка

1. Відкрийте сайт: має з'явитися «Оберіть обліковий запис».
2. Увійдіть, натисніть кнопку «Генератор» у кутку, запустіть сценарій «Серцевий стрес». Через кілька секунд на панелі має з'явитися тривога.
3. Відкрийте сайт в іншому браузері або в режимі інкогніто: ви побачите свій, окремий, порожній простір.

### 4. Часті проблеми

| Симптом | Причина і що робити |
|---|---|
| Сторінка вибору акаунта каже, що сервер недоступний | неправильний `NEXT_PUBLIC_API_URL`, або API ще спить/запускається. Перевірте `/health` і зробіть Redeploy на Vercel |
| У консолі помилка CORS | адреси сайту немає в `CORS_ORIGINS` (без кінцевого `/`, з `https://`) або додайте `CORS_ORIGIN_REGEX` |
| Генератор пише «сервер не приймає дані» (503) | досягнуто `MAX_WORKSPACES`; підніміть значення або зачекайте, поки найстаріший простір звільниться |
| Дані зникли після деплою | немає тому на `/data` або `DATA_DIR` не заданий |
| Живі оновлення (`/live`) не працюють | перевірте, що `NEXT_PUBLIC_API_URL` починається з `https://`: сайт сам перетворить його на `wss://` |
| Нічні відвідувачі бачать порожній простір | його видалено через `WORKSPACE_TTL_SEC`; це очікувано, натисніть «Запустити» ще раз |

### 5. Локально

```bash
cp .env.example .env
make demo     # API :8000 + сайт :3000
```

---

## English

Layout: the **site (Next.js) runs on Vercel**, the **API (FastAPI + SQLite) runs on Railway**. A visitor's browser talks to the API directly, so the API must allow the site's origin (CORS). There are no passwords and no sign-in secrets.

```
Browser ──► Vercel (site)            NEXT_PUBLIC_API_URL
   │
   └──────► Railway (API, /health) ──► volume /data (per-visitor SQLite files)
```

### 0. Requirements

- Accounts on [GitHub](https://github.com), [Railway](https://railway.com) and [Vercel](https://vercel.com).
- A GitHub repository with this project. Its root holds `Dockerfile`, `railway.toml`, `backend/` and `vita-astronaut-health-monitor/frontend/`.

### 1. The API on Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → pick the repository.
2. Railway reads `railway.toml` in the root and builds the image from `Dockerfile` (the root directory is the repo root; leave it). The health check is `/health`.
3. **Volume for the databases.** Service → **Settings → Volumes → Add Volume**, mount path `/data`. Without a volume data is lost on every deploy (acceptable for a pure demo; then skip `DATA_DIR`).
4. **Variables.** Service → **Variables**:

   | Variable | Value | Purpose |
   |---|---|---|
   | `DATA_DIR` | `/data` | where visitor databases and the audit signing key live |
   | `SIGNAL_DELAY_SEC` | `1200` | Earth delay, 20 minutes of simulated time |
   | `DEMO_MODE` | `true` | keeps the demo tamper-check endpoint |
   | `MAX_WORKSPACES` | `40` | how many visitor spaces to keep at once |
   | `WORKSPACE_TTL_SEC` | `10800` | idle seconds before a space is deleted |
   | `CORS_ORIGINS` | `https://YOUR-SITE.vercel.app` | allowed site origins, comma separated |
   | `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` | (optional) also allows Vercel preview deployments |

   Railway sets `PORT` itself.
5. **Settings → Networking → Generate Domain.** Copy the address, e.g. `https://errno-api-production.up.railway.app`.
6. Check it: open `https://…up.railway.app/health`; expect `{"status":"ok"}`.

Keep **one replica**: visitor spaces live in process memory, so several replicas would split one visitor across different copies.

### 2. The site on Vercel

1. Vercel → **Add New → Project** → import the same repository.
2. **Root Directory**: `vita-astronaut-health-monitor/frontend`. Framework: Next.js (detected automatically), Node 22.
3. **Environment Variables**: `NEXT_PUBLIC_API_URL` = the Railway address **without** a trailing `/`, e.g. `https://errno-api-production.up.railway.app`.
4. **Deploy.** `NEXT_PUBLIC_*` values are baked in at build time: after changing one, **Redeploy**.
5. Copy the site address (`https://….vercel.app`) and put it into `CORS_ORIGINS` on Railway (variables apply after the automatic restart).

### 3. Verify

1. Open the site: you should see “Choose an account”.
2. Sign in, press the “Generator” button in the corner, run the “Cardiac stress” scenario. Within seconds the panels should show an alarm.
3. Open the site in another browser or in a private window: you get your own separate, empty space.

### 4. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The account page says the server is unreachable | wrong `NEXT_PUBLIC_API_URL`, or the API is still starting. Check `/health` and Redeploy on Vercel |
| CORS error in the console | the site origin is not in `CORS_ORIGINS` (use `https://`, no trailing `/`), or add `CORS_ORIGIN_REGEX` |
| The generator says “the server is not accepting data” (503) | `MAX_WORKSPACES` reached; raise it or wait until the oldest space is freed |
| Data vanished after a deploy | no volume on `/data`, or `DATA_DIR` not set |
| Live updates (`/live`) do not work | make sure `NEXT_PUBLIC_API_URL` starts with `https://`; the site turns it into `wss://` itself |
| A visitor returns later and the space is empty | it expired after `WORKSPACE_TTL_SEC`; expected, press “Start” again |

### 5. Locally

```bash
cp .env.example .env
make demo     # API :8000 + site :3000
```
