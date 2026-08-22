# New KDroid GitHub OAuth Worker

Этот Worker нужен для админ-панели сайта New KDroid. Он выполняет OAuth-вход через GitHub и после проверки администратора позволяет добавлять репозитории в `repo.txt` и их название/категорию/описание в `deca.txt`.

## 1. Создать GitHub OAuth App

В GitHub откройте Settings → Developer settings → OAuth Apps → New OAuth App.

Укажите:

- Application name: `New KDroid Admin`
- Homepage URL: `https://konyakpivo-wq.github.io/new_kdord`
- Authorization callback URL: `https://YOUR-WORKER.workers.dev/callback`

После создания сохраните Client ID и Client Secret. Client Secret нельзя помещать в GitHub Pages или в JavaScript сайта.

## 2. Создать Worker

В Cloudflare Workers создайте Worker и загрузите содержимое `worker/src/index.js`, либо разверните проект через Wrangler.

В `worker/wrangler.toml` уже указаны публичные настройки каталога и аккаунт администратора.

Секреты задаются отдельно:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` должен быть длинной случайной строкой.

## 3. Права GitHub

Для текущей реализации OAuth App запрашивает `public_repo read:user`. Этого достаточно для записи в публичный `new_kdord` через Contents API от имени вошедшего администратора.

## 4. URL Worker

После публикации Worker будет иметь адрес вида:

`https://new-kdroid-admin.<your-subdomain>.workers.dev`

Этот URL нужно указать в `admin.html`/`admin-panel.html` как OAuth Worker URL.

## 5. Важно

Не добавляйте Client Secret, access token или `SESSION_SECRET` в этот репозиторий. Они должны храниться только как secrets Cloudflare Worker.
