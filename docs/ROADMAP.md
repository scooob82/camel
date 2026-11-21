# Camel Studio – stav projektu a roadmapa

_Stav k 21. 11. 2026 · commit `d2e7192`_

Legenda: ✅ hotovo · 🟡 částečně · ⬜ zbývá · 🔶 rozhodnutí na tobě

Odhady pracnosti jsou hrubé a orientační (S = do 1 dne, M = 2–4 dny, L = 1–2 týdny, XL = víc než 2 týdny soustředěné práce).

---

## Shrnutí

| Fáze | Stav | Odhad zbývající práce |
|---|---|---|
| 1 – MVP: frontend | ✅ hotovo | – |
| 1 – MVP: backend, účty, nasazení | ⬜ | L |
| 1.5 – Dotažení builderu | ⬜ | L |
| 2 – Pro: Run & Debug | ⬜ | XL |
| 3 – Transformation Lab | ⬜ | L–XL |
| 4 – Migration Center | ⬜ | XL |
| 5 – AI, Team, Enterprise | ⬜ | XL |

**Hotová je asi třetina MVP a zhruba 15 % celé vize.** Builder, jádro produktu, je hotový a funkční. Do veřejného spuštění MVP chybí hlavně backend (účty, ukládání na server), nasazení a pár rozhodnutí (název, doména). Placené moduly (fáze 2–5) jsou zatím jen v plánu a jsou to největší kusy práce.

---

## ✅ Hotovo (fáze 1 – frontend)

### Jádro (`src/core`, pokryto 47 unit testy)
- ✅ Kanonický model routy (jediný zdroj pravdy pro plátno i editory)
- ✅ YAML DSL: import i export, obousměrná synchronizace
- ✅ XML DSL (xml-io): import i export, obousměrná synchronizace, vlastní XML parser bez závislostí
- ✅ Java DSL: export (RouteBuilder)
- ✅ Neznámé kroky a top-level prvky YAML se při importu neztratí
- ✅ 25 EIP: to, toD, wireTap, log, setBody, transform, setHeader, setProperty, removeHeader, convertBodyTo, marshal, unmarshal, bean, process, filter, choice, split, aggregate, multicast, loop, idempotentConsumer, delay, doTry/doCatch/doFinally, transacted, stop
- ✅ onException s redelivery politikou
- ✅ Katalog 40 komponent s nejpoužívanějšími parametry (ručně kurátorovaný)
- ✅ Validace a lint: povinná pole, platnost URI, consumer/producer, HTTP bez timeoutu, hesla natvrdo v URI, aggregate bez completion, prázdné větve, duplicitní route id, chybějící error handling
- ✅ Tester výrazů JSONPath (vlastní evaluátor) a XPath (v prohlížeči)
- ✅ Dokumentace: Mermaid diagram a tabulka endpointů
- ✅ Export: ZIP s routami a spustitelný Spring Boot projekt (YAML/XML/Java, správné startery, application.properties s placeholdery, Dockerfile, README)

### Aplikace
- ✅ Úvodní stránka podle návrhu designu, se živým náhledem builderu
- ✅ Dashboard: projekty, statistiky, vyhledávání, nový projekt (prázdný nebo z receptu), import souboru, duplikace, mazání s potvrzením
- ✅ Builder:
  - drag & drop z palety, vkládání přes „+“, přesun uzlů, duplikace, mazání
  - undo/redo, zoom, měnitelná šířka panelů, skrývání panelů
  - inspektor vlastností (endpoint formulář podle katalogu, editor výrazů, vlastnosti EIP)
  - záložky YAML / XML / Java / Docs
  - lišta validace s proklikem na problémový uzel
  - verze projektu (Ctrl+S), import do projektu
  - klávesové zkratky (Del, Ctrl+Z, Ctrl+Shift+Z, Ctrl+D, Esc)
- ✅ Knowledge Base: 12 receptů ve 3 DSL, reference EIP a komponent, vyhledávání, „Open in Builder“
- ✅ Command palette (Ctrl/Cmd+K), tmavý a světlý režim, toasty, empty states
- ✅ Responzivita: builder desktop-first, ostatní stránky plně responzivní
- ✅ Obchodní podmínky a Privacy (koncept)
- ✅ Build přes esbuild do `dist/`, `.htaccess` pro Apache (cache, bezpečnostní hlavičky)

---

## ⬜ Zbývá do spuštění MVP (fáze 1)

### Rozhodnutí 🔶
- 🔶 **Název a doména.** „camelapache“ / camelapache.com je podle trademark policy ASF riskantní. Doporučení: vlastní značka + podtitul „for Apache Camel“. Změna = `src/config/brand.ts` + `index.html`.
- 🔶 Ověřit verze v generovaném projektu (Camel 4.10.0, Spring Boot 3.4.4), případně přejít na aktuální LTS.

### Backend – Laravel API (L)
- ⬜ Kostra Laravel aplikace, `/api/v1`, MariaDB migrace
- ⬜ Registrace, přihlášení (Sanctum, session + CSRF), ověření e-mailu, reset hesla
- ⬜ API pro projekty a verze (CRUD), napojení přes existující `ProjectRepository`
- ⬜ Migrace projektů z prohlížeče do účtu po prvním přihlášení
- ⬜ Rate limiting, validace vstupů, role/oprávnění, pole tarifu (Free/Pro/Team)
- ⬜ Transakční e-maily (SMTP)
- ⬜ Uživatelská nastavení a smazání účtu (GDPR)
- ⬜ Ověřit na VMS Smart: Composer, artisan, cron (`schedule:run`). Jinak build `vendor` v GitHub Actions.

### Nasazení a kvalita (M)
- ⬜ `package-lock.json` (vznikne prvním `npm install`)
- ⬜ Spustit `npm run typecheck` s typy Reactu a opravit případné chyby
- ⬜ ESLint + Prettier konfigurace
- ⬜ Playwright E2E testy do repa (smoke test zatím existuje jen mimo repo)
- ⬜ GitHub Actions: test + build + deploy přes rsync/SFTP
- ⬜ Monitoring chyb (Sentry nebo podobný) a analytika šetrná k soukromí
- ⬜ Zálohy DB mimo hosting

### Obsah a SEO (M)
- ⬜ Hash routing (`#/kb/...`) vyhledávače špatně indexují. Předgenerovat statické HTML stránky Knowledge Base při buildu (nebo je servírovat z Laravelu).
- ⬜ Sitemap, meta tagy, Open Graph obrázky
- ⬜ Rozšířit Knowledge Base z 12 na 20+ receptů
- ⬜ Lokalizace CZ/EN (zatím jen angličtina)
- ⬜ Finální znění obchodních podmínek a GDPR; cookie lišta až s analytikou

---

## ⬜ Fáze 1.5 – Dotažení builderu (L)

- ⬜ Generovat katalog z oficiálního `camel-catalog` (všechny komponenty a parametry, automaticky s každou verzí Camelu)
- ⬜ Import Java DSL (vyžaduje Java službu)
- ⬜ Vyhodnocení Simple jazyka (vyžaduje Camel runtime, souvisí s fází 2)
- ⬜ Contract-first: OpenAPI / AsyncAPI / WSDL → kostra rout
- ⬜ Designer error handlingu s časovou osou redelivery
- ⬜ Kamelety a route templates, vlastní knihovna šablon
- ⬜ REST DSL, beans, routeConfiguration (dnes se v YAML jen zachovají, vizuálně je editovat nejde)
- ⬜ Další EIP: throttle, circuitBreaker, enrich/pollEnrich, recipientList, routingSlip, dynamicRouter, saga, threads, onCompletion
- ⬜ Plátno: posouvání tažením, výběr více uzlů, kopírovat/vložit, minimapa, sbalení bloků
- ⬜ Sdílení projektu odkazem jen pro čtení (vyžaduje backend)
- ⬜ Vizuální diff dvou verzí
- ⬜ Code splitting (bundle má teď ~540 kB, jszip a builder načítat až při potřebě)
- ⬜ Audit přístupnosti (klávesnicí ovladatelné plátno, kontrasty, screen reader)

---

## ⬜ Fáze 2 – Pro: Run & Debug (XL)

Vyžaduje samostatný VPS s Dockerem a Java/Camel runtime. Na VMS Smart to nepoběží.

- ⬜ Java služba (Spring Boot + Camel 4) s API pro spuštění routy
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
2. Kvalita: `npm install`, `typecheck`, ESLint, E2E testy do repa, GitHub Actions.
3. Laravel backend s účty a synchronizací projektů, nasazení na VMS Smart.
4. SEO pro Knowledge Base a rozšíření obsahu, spuštění veřejné verze Free.
5. Katalog z `camel-catalog` a další EIP (fáze 1.5).
6. VPS + Java runtime, pak Run & Debug jako první placený modul.
