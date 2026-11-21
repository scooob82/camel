# Nasazení na VMS Smart (nebo jiný Apache + PHP hosting)

Celá aplikace je jedna složka `dist/`: statický frontend, statické stránky Knowledge Base a PHP API v `dist/api/`. Na serveru stačí **Apache, PHP 8.2+ a MariaDB**. Composer, Node ani Docker na serveru nejsou potřeba.

## 1. Jednorázová příprava serveru

1. **Databáze:** v administraci hostingu založ MariaDB databázi a uživatele.
2. **Konfigurace:** zkopíruj `api/config.example.php` jako `cas-config.php` **o úroveň výš než web root** (např. vedle složky `www/`) a vyplň:
   - `app_url`: veřejná adresa webu (kvůli odkazům v e-mailech),
   - `db.dsn`, `db.user`, `db.password`,
   - `mail`: SMTP schránku pro odesílání (ověření e-mailu, reset hesla),
   - `setup_token`: náhodný řetězec, pokud chceš spouštět migrace přes HTTP (viz bod 3).

   Pokud hosting nedovolí soubor mimo web root, dej ho jako `api/config.php`. Je chráněný přes `.htaccess`.
3. **Zapisovatelná složka:** `api/storage/` (sessions, logy, zálohy) musí být zapisovatelná pro PHP. Typicky stačí práva 775.

## 2. Build a nahrání

Lokálně:

```bash
npm install
SITE_URL=https://www.tvoje-domena.cz npm run build
```

Pak nahraj **obsah** `dist/` (včetně skrytých `.htaccess`) do web rootu přes SFTP. Na serveru nikdy nepřepisuj `api/storage/` ani `api/config.php`.

Automaticky to dělá GitHub Actions workflow `Deploy` po úspěšném CI na `main`. Nastav v repu:

| Typ | Název | Hodnota |
|---|---|---|
| Secret | `SFTP_HOST` | host SFTP |
| Secret | `SFTP_USER` / `SFTP_PASSWORD` | přístup SFTP |
| Secret | `SFTP_PATH` | cesta k web rootu, např. `/www` |
| Secret | `SETUP_TOKEN` | stejný jako `setup_token` v konfiguraci (volitelné) |
| Variable | `SITE_URL` | `https://www.tvoje-domena.cz` |

## 3. Migrace databáze

Po prvním nahrání a po každé změně ve složce `api/migrations/`:

- **přes SSH:** `php www/api/bin/migrate.php`
- **bez shellu:** `curl -X POST -H "X-Setup-Token: <token>" https://www.tvoje-domena.cz/api/v1/setup/migrate`. Deploy workflow to volá sám, pokud jsou nastavené `SETUP_TOKEN` a `SITE_URL`.

Ověření: `https://www.tvoje-domena.cz/api/v1/health` vrátí `{"ok":true,...}`.

## 4. Cron (údržba a zálohy)

V administraci hostingu přidej denní cron:

```
15 3 * * *  php /cesta/k/www/api/bin/maintenance.php
```

Skript promaže prošlé tokeny a rate-limit záznamy a uloží zálohu DB do `api/storage/backups/` (posledních 14). **Tu složku si pravidelně stahuj mimo server.** Záloha hostingu sama o sobě nestačí.

## 5. Kontrola po nasazení

- [ ] `/api/v1/health` odpovídá
- [ ] `/api/src/App.php` a `/api/config.php` vrací 403
- [ ] registrace pošle e-mail s odkazem na správnou doménu
- [ ] `/kb/` a `/sitemap.xml` existují; sitemap nahrát do Google Search Console
- [ ] HTTPS je vynucené (session cookie má `secure`)

## 6. Admin, analytika a chyby

- Prvního administrátora vytvoříš po registraci: `php api/bin/make-admin.php tvuj@email.cz`. Admin je pak na `#/admin`.
- Volitelně Sentry a Plausible: v `dist/config.js` (zdroj `public/config.js`) vyplň `sentryDsn` a `plausibleDomain`. Bez nich se chyby a návštěvnost ukládají jen do vlastní DB (bez cookies a IP).
- Údaje provozovatele do obchodních podmínek a GDPR doplň v `src/config/brand.ts` (`operator`, `hosting`, `effectiveDate`) a nech texty zkontrolovat právníkem.

## 7. Sandbox runner (Run & Debug, Transformation Lab)

Runner potřebuje Javu, takže nepoběží na PHP hostingu. Stačí malý VPS (2 GB RAM) s Dockerem:

```bash
cd runner
mvn -q test            # poprvé ověř build
RUNNER_TOKEN=$(openssl rand -hex 32) docker compose up -d --build
```

Runner dej za HTTPS reverse proxy (Caddy/nginx) a do `cas-config.php` doplň:

```php
'runner' => [
    'url' => 'https://runner.tvoje-domena.cz',
    'token' => '<stejný RUNNER_TOKEN>',
    'daily_runs' => ['free' => 20, 'pro' => null, 'team' => null],
],
```

Bez runneru aplikace funguje dál, jen Run & Debug a Saxon v Labu ukážou hlášku, že runner není nastavený.

## Lokální vývoj s API

```bash
npm run build
npm run migrate        # SQLite v api/storage/dev.sqlite, maily do api/storage/mail/*.eml
npm run serve          # http://127.0.0.1:8080 (aplikace + API)
```

`npm run dev` (esbuild watch na portu 5173) běží bez API. Aplikace se pak automaticky přepne do režimu „projekty v prohlížeči“.
