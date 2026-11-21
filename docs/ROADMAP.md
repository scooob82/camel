# Camel Studio – stav projektu a roadmapa

_Stav k 21. 11. 2026_

Legenda: ✅ hotovo · 🟡 částečně · ⬜ zbývá · 🔶 rozhodnutí na tobě

Odhady pracnosti jsou hrubé a orientační (S = do 1 dne, M = 2–4 dny, L = 1–2 týdny, XL = víc než 2 týdny soustředěné práce).

---

## Shrnutí

| Fáze | Stav | Odhad zbývající práce |
|---|---|---|
| 1 – MVP: frontend | ✅ hotovo | – |
| 1 – MVP: backend, účty, nasazení | ✅ hotovo, čeká na nasazení | S (nasazení, rozhodnutí) |
| 1.5 – Dotažení builderu | ✅ hotovo kromě částí, které potřebují Java runtime | – (zbytek ve fázi 2) |
| 2 – Pro: Run & Debug | ⬜ | XL |
| 3 – Transformation Lab | ⬜ | L–XL |
| 4 – Migration Center | ⬜ | XL |
| 5 – AI, Team, Enterprise | ⬜ | XL |

**MVP je hotové a připravené k nasazení, celkově asi 35 % vize.** Chybí rozhodnutí o názvu a doméně, první nasazení na hosting a ověření v CI. Placené moduly (fáze 2–5) jsou zatím jen v plánu.

Testy: 77 unit testů jádra, 2 testy generátoru katalogu, 53 end-to-end testů API, 3 browserové scénáře (Playwright) přes aplikaci + API.

---

## ✅ Fáze 1 – MVP

### Builder a jádro
- ✅ Kanonický model routy, obousměrná synchronizace YAML ↔ XML ↔ plátno, export Java DSL
- ✅ Validace a lint, tester JSONPath / XPath, Mermaid dokumentace
- ✅ Export: ZIP s routami a spustitelný Spring Boot projekt (YAML/XML/Java)
- ✅ Úvodní stránka, dashboard, Knowledge Base, command palette, tmavý/světlý režim

### Backend a účty (čisté PHP 8.2, bez závislostí)
- ✅ API `/api/v1`: PDO (MariaDB v produkci, SQLite pro vývoj a testy), migrace (CLI i přes HTTP se setup tokenem)
- ✅ Registrace, přihlášení, odhlášení, ověření e-mailu, zapomenuté heslo, reset hesla
- ✅ Session cookies (HttpOnly, SameSite, Secure), CSRF tokeny, jen JSON, rate limiting v DB, odhlášení ostatních zařízení po změně hesla
- ✅ Účet: změna jména a hesla, GDPR export dat, smazání účtu
- ✅ Projekty a verze přes API, limity podle tarifu (Free/Pro/Team), detekce konfliktů (dva taby nebo zařízení → 409 a načtení aktuální verze)
- ✅ Frontend: dva režimy (prohlížeč / účet), sériová fronta zápisů, indikátor „Saving / Saved to cloud“, import projektů z prohlížeče do účtu
- ✅ Sdílení projektu odkazem jen pro čtení, stránka sdíleného projektu s „Duplicate to my projects“
- ✅ E-maily přes SMTP (STARTTLS/SSL), PHP mail() nebo do souboru (vývoj)
- ✅ Denní údržba přes cron: čištění tokenů a zálohy DB do `api/storage/backups`

### Nasazení a kvalita
- ✅ Build vytvoří jednu složku `dist/` (aplikace + statické KB stránky + API) na nahrání přes SFTP
- ✅ GitHub Actions: CI (unit testy, PHP lint, API testy, build, Playwright) a Deploy (SFTP přes lftp + migrace)
- ✅ Prettier, EditorConfig, návod [DEPLOY.md](DEPLOY.md)
- ✅ Code splitting: builder a jszip se načítají až při potřebě

### Obsah a SEO
- ✅ Knowledge Base rozšířena na 20 receptů
- ✅ Statické HTML stránky `/kb/` a `/kb/<recept>/` pro vyhledávače, sitemap.xml, robots.txt, Open Graph a JSON-LD

### Zbývá z fáze 1
- 🔶 **Název a doména:** „camelapache“ je kvůli ochranné známce ASF riskantní. Změna = `src/config/brand.ts` + `index.html`.
- 🔶 Ověřit verze v generovaném projektu (Camel 4.10.0, Spring Boot 3.4.4).
- ⬜ První nasazení na VMS Smart (S), nastavit SMTP a cron
- ⬜ `npm run typecheck` s typy Reactu: tady se nedalo spustit, v CI zatím nepovinné (S)
- ⬜ ESLint (S). Teď je jen Prettier.
- ⬜ Lokalizace CZ/EN, rozhraní je zatím anglicky (M)
- ⬜ Monitoring chyb (Sentry) a analytika šetrná k soukromí (S)
- ⬜ Finální znění obchodních podmínek a GDPR; cookie lišta, až přibude analytika
- ⬜ Admin rozhraní (uživatelé, tarify), zatím jen přímo v DB (M)

---

## ✅ Fáze 1.5 – Dotažení builderu

- ✅ Generátor katalogu z oficiálního `camel-catalog` (`npm run catalog`), který se slučuje s ručně vybranými komponentami. Otestovaný na vzorku ve formátu camel-catalog; reálný katalog vygeneruješ lokálně přes Maven.
- ✅ Contract-first: OpenAPI 2/3 → REST DSL + routy, AsyncAPI 2/3 → consumer/producer routy, WSDL → CXF routa s rozcestníkem operací
- ✅ Designer error handlingu: exponential back-off, max. prodleva, časová osa pokusů
- ✅ Knihovna vlastních snippetů (uložit krok i s obsahem, vložit z palety)
- ✅ REST DSL s vizuálním editorem operací
- ✅ Nové EIP: throttle, circuitBreaker + onFallback, enrich, pollEnrich, recipientList, routingSlip, dynamicRouter, threads
- ✅ Plátno: posouvání tažením, výběr více uzlů (Shift/Ctrl), kopírovat/vyjmout/vložit (i YAML ze schránky), sbalení bloků, šipky mezi kroky
- ✅ Porovnání verzí (diff YAML)
- ✅ Code splitting

### Přesunuto do fáze 2 (potřebuje Java runtime)
- ⬜ Import Java DSL
- ⬜ Vyhodnocení Simple jazyka

### Zbývá (menší)
- ⬜ Vizuální editor pro beans a routeConfiguration (dnes se v YAML jen zachovají)
- ⬜ EIP saga a onCompletion
- ⬜ Minimapa plátna
- ⬜ Snippety synchronizované s účtem (dnes jen v prohlížeči)
- ⬜ Plný audit přístupnosti (základ je: klávesnice, ARIA, kontrasty)

---

## ⬜ Fáze 2 – Pro: Run & Debug (XL)

Vyžaduje samostatný VPS s Dockerem a Java/Camel runtime. Na VMS Smart to nepoběží.

- ⬜ Java služba (Spring Boot + Camel 4) s API pro spuštění routy
- ⬜ Import Java DSL a živé vyhodnocení Simple výrazů (používají stejnou Java službu)
- ⬜ Izolovaný sandbox: kontejner na běh, limity CPU/RAM/času/sítě/FS, zakázané nebezpečné komponenty (exec, file mimo sandbox…)
- ⬜ Mock endpointy a vstupní zprávy
- ⬜ Trasování zprávy krok po kroku přímo v diagramu (body, headers, properties)
- ⬜ Breakpointy a historie běhů
- ⬜ Generování unit testů z trace
- ⬜ Chaos testy (timeout, HTTP 500, nevalidní data) a pokrytí větví
- ⬜ Platby a tarify: merchant of record (Paddle / Lemon Squeezy), webhooky, kredity

## ⬜ Fáze 3 – Transformation Lab (L–XL)

- ⬜ XSLT 3.0 playground (zvážit SaxonJS v prohlížeči pro rychlý start, ověřit licenci)
- ⬜ XQuery playground (Saxon na Javě)
- ⬜ Debugger s breakpointy a profiler transformací
- ⬜ Vizuální mapper JSON ↔ XML
- ⬜ Excel mapping → XSLT a zpět
- ⬜ Diff XSD verzí a dopad změn na transformace
- ⬜ Generování testovacích dat ze schémat

## ⬜ Fáze 4 – Migration Center (XL)

- ⬜ Import a analýza projektu (OSB, MuleSoft, Fuse, Spring XML)
- ⬜ Assessment report (počty, složitost, rizika, odhad pracnosti) jako placený výstup
- ⬜ Automatický převod podporovaných konstrukcí, označení nepodporovaných
- ⬜ Upgrade checker Camel 2/3 → 4
- ⬜ Bezpečné zacházení s nahranými daty zákazníků (šifrování, retence, mazání)

## ⬜ Fáze 5 – AI, Team, Enterprise (XL)

- ⬜ AI asistent s kontextem projektu: routa z textu, vysvětlení, review, rozbor stack trace
- ⬜ MCP server pro externí AI agenty
- ⬜ Limity a náklady AI podle tarifu
- ⬜ Team: sdílené knihovny, kolaborace, code review, SSO
- ⬜ Marketplace šablon a konektorů
- ⬜ Self-hosted licence (Docker image, licenční klíč)

---

## Doporučené pořadí dalších kroků

1. Rozhodnout název a doménu.
2. Nasadit na VMS Smart podle [DEPLOY.md](DEPLOY.md): konfigurace, migrace, cron se zálohami, SMTP.
3. Pustit CI na GitHubu a opravit, co ukáže `typecheck` s typy Reactu (pak ho zapnout jako povinný).
4. Vygenerovat katalog z `camel-catalog` (`npm run catalog`) a commitnout `src/content/catalog.generated.json`.
5. Veřejné spuštění Free verze, Google Search Console + sitemap.
6. VPS + Java runtime, pak Run & Debug jako první placený modul.
