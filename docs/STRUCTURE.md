# Як влаштований ERRNO

Браузер на `http://localhost:3000`. Бекенд на `http://127.0.0.1:8000`. Генератор живе в самому сайті (кнопка в куті, вікно): він шле `POST /ingest` із браузера, тож окремого процесу немає.

```
генератор у браузері (або реальний пристрій у спільному просторі з X-Device-Token)
  → POST /ingest, X-Workspace
  → FastAPI: WorkspaceMiddleware вибирає базу цього відвідувача
  → черга → SQLite WAL
  → штраф і автомат статусу
браузер
  → Bearer, X-Workspace
  → ті самі ендпоінти, вже відфільтровані за роллю і затримкою
```

## Дерево

```
NASA/
├── README.md
├── Makefile                  make demo / make test
├── .env.example
├── Dockerfile / railway.toml   бекенд для Railway
├── docker-compose.yml        необов'язковий запуск
├── docs/
│   ├── BACKEND.md
│   ├── STRUCTURE.md
│   ├── SCENARIOS.md
│   └── HOSTING.md            Vercel + Railway, укр. та англ.
└── backend/
    ├── main.py
    ├── access.py             ролі, сесії без паролів
    ├── workspace.py          окремий корабель (база, рушії, Hub) на кожного відвідувача
    ├── ctx.py                ContextVar поточного простору
    ├── zones.py              лише підсвітка значення
    ├── earth_link.py         симульований годинник і черга дій
    ├── scoring/penalty.py
    ├── scoring/status_machine.py
    ├── scoring/clinical.py
    ├── config/               екіпаж, метрики, штраф, статус, затримка, CSV правил
    └── api/
```

Фронтенд: `vita-astronaut-health-monitor/frontend`.

- Вхід: `src/app/login/page.tsx` (вибір акаунта), `src/lib/auth.tsx`, `src/lib/session.ts`. Токен у `sessionStorage` (дві вкладки — дві різні людини) і в `localStorage` (закрили вкладку — не вийшли), ключ `errno:auth-token`.
- Простір: `src/lib/workspace.ts`, ключ `errno:workspace`.
- Генератор: логіка в `src/lib/generator/` (`engine.ts` — запуск і відправка, `rig.ts` — сигнал одного космонавта, `scenarios.ts`, `catalog.ts`, `recordings.ts`), інтерфейс у `src/components/generator/` (кнопка `generator-dock.tsx`, вікно `generator-modal.tsx`). Ключі `localStorage`: `errno:gen:config`, `errno:gen:recordings`, `errno:gen:cursor`, `errno:gen:lock`.

## Хто куди потрапляє

Паролів немає: на екрані входу обирається один із цих акаунтів.

| Логін | Роль | Куди | Що бачить |
|---|---|---|---|
| `astronaut` | космонавт `A1` Олена Кравець | `/`, `/training` | свої групи. Статус 0 без повідомлень. Статус 1 — картки HUD лише для штрафів. Статус 2 — червоний екран |
| `officer` | космонавт `A2` Тарас Бондар з правом вахти | `/captain`, `/training`, `/captain/incident/[id]` | свої дані як у astronaut. «Екіпаж» — лише готовність. Чужі числа лише в критиці (break-glass) |
| `doctor` | головний лікар (`chief`) | `/medic`, `/medic/crew`, `/medic/earth` | телеметрія із затримкою. Пакет хірурга відкривається після `visible_at` |

## Сторінки

| Шлях | Хто |
|---|---|
| `/login` | усі, вибір акаунта |
| `/` | космонавт |
| `/training` | космонавт, сон і анкета |
| `/captain` | офіцер |
| `/captain/incident/[id]` | офіцер, break-glass |
| `/medic` | лікар |
| `/medic/crew`, `/medic/crew/[id]` | лікар |
| `/medic/earth` | лікар, пакети і журнал попереджень |
| `/medic/alerts` | лікар |
Меню: `lib/navigation.ts`. Числа: `lib/number.ts` (`uk-UA`). Зони на екрані збігаються з `backend/zones.py`. Рішення про статус іде зі штрафу, не з кольору зони.

## Як показ стає статусом

1. `POST /ingest` кладе рядки в чергу простору відвідувача. Якщо `time_scale > 1`, час пристрою — це симульований час, медіана зсуву не рахується.
2. Writer пише пачку в SQLite.
3. `scoring/penalty.py` рахує штраф. `scoring/status_machine.py` оновлює статус кожні 5 симульованих секунд і на миттєвих метриках.
4. Вхід у статус 2 відкриває інцидент, break-glass і пакет Землі.
5. Лікар бачить рядки з `ts <= sim_now - SIGNAL_DELAY_SEC`. Вміст пакета — лише після `visible_at`.

`PUT /limits` діє одразу. `POST /actions` офіцера йде на Землю, а дія лікаря — на борт, обидві після затримки.
