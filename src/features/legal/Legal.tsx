import { useEffect, type ReactNode } from 'react';
import { langStore, t } from '../../app/i18n';
import { href } from '../../app/router';
import { BRAND } from '../../config/brand';

/*
 * Terms of use and privacy policy (Czech law, GDPR). Written as complete documents, but they
 * are not legal advice: have them reviewed by a lawyer and fill in BRAND.operator before launch.
 */

const op = BRAND.operator;

function Doc({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.display}`;
  }, [title]);
  return (
    <main className="wrap page prose legal">
      <div className="tag">{t('Legal')}</div>
      <h1 style={{ fontSize: 30 }}>{title}</h1>
      <p className="muted">
        {t('Effective from')} {BRAND.effectiveDate}
      </p>
      {children}
    </main>
  );
}

function Operator() {
  return (
    <p>
      {op.name}, {t('Company ID')} {op.id}, {op.address}, {op.registry}. {t('Contact')}: {op.email}
    </p>
  );
}

const cs = () => langStore.get() === 'cs';

export function Terms() {
  if (cs()) {
    return (
      <Doc title="Obchodní podmínky">
        <h2>1. Provozovatel</h2>
        <Operator />
        <h2>2. Služba</h2>
        <p>{BRAND.display} je webový nástroj pro návrh, validaci, dokumentaci a export integračních rout pro Apache Camel. Služba je dostupná bez registrace (projekty se ukládají v prohlížeči) nebo s uživatelským účtem (projekty se ukládají na serveru provozovatele).</p>
        <h2>3. Uživatelský účet</h2>
        <ul>
          <li>Účet může založit fyzická osoba starší 16 let nebo osoba jednající za firmu.</li>
          <li>Uživatel odpovídá za správnost údajů a za utajení svého hesla. Podezření na zneužití účtu oznámí provozovateli bez zbytečného odkladu.</li>
          <li>Uživatel může účet kdykoli zrušit v nastavení účtu. Zrušením se nevratně smažou všechny jeho projekty.</li>
        </ul>
        <h2>4. Tarify a platby</h2>
        <p>Základní tarif Free je zdarma. Placené tarify (Pro, Team) a jejich cena jsou uvedeny na webu v okamžiku objednávky; platby zpracovává třetí strana (poskytovatel plateb), jejíž podmínky se uplatní. Předplatné lze zrušit ke konci zaplaceného období. Provozovatel může rozsah tarifu Free změnit; o podstatných změnách placených tarifů informuje nejméně 30 dní předem.</p>
        <h2>5. Obsah uživatele</h2>
        <ul>
          <li>Routy, projekty a vygenerovaný kód patří uživateli. Provozovateli uděluje uživatel pouze licenci nezbytnou k provozu služby (uložení, zálohování, zobrazení).</li>
          <li>Vygenerovaný kód lze použít v jakémkoli projektu, včetně komerčních.</li>
          <li>Sdílením odkazem uživatel zpřístupňuje projekt komukoli, kdo odkaz zná. Sdílení lze kdykoli zrušit.</li>
          <li>Do projektů nevkládejte hesla, tokeny ani osobní údaje třetích osob. Používejte zástupné hodnoty <code>{'{{property}}'}</code>.</li>
        </ul>
        <h2>6. Zakázané užití</h2>
        <p>Je zakázáno službu zneužívat, zejména obcházet limity, narušovat její bezpečnost, spouštět v sandboxu kód, který útočí na třetí strany, nebo službu automatizovaně přetěžovat. Při porušení může provozovatel účet omezit nebo zrušit.</p>
        <h2>7. Dostupnost a odpovědnost</h2>
        <p>Služba je poskytována „tak, jak je“. Provozovatel usiluje o vysokou dostupnost, ale negarantuje ji, a doporučuje projekty pravidelně exportovat. Vygenerovaný kód je třeba před produkčním nasazením zkontrolovat a otestovat. Provozovatel neodpovídá za škody vzniklé použitím vygenerovaného kódu ani za ušlý zisk; u placených tarifů je odpovědnost omezena na cenu zaplacenou za posledních 12 měsíců, pokud zákon nestanoví jinak.</p>
        <h2>8. Ochranné známky</h2>
        <p>{BRAND.disclaimer}</p>
        <h2>9. Změny podmínek a rozhodné právo</h2>
        <p>O změně podmínek provozovatel informuje registrované uživatele e-mailem nejméně 14 dní předem; nesouhlasí-li uživatel, může účet zrušit. Vztahy se řídí právem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník. Spotřebitel se může obrátit na Českou obchodní inspekci (www.coi.cz) jako subjekt mimosoudního řešení sporů.</p>
      </Doc>
    );
  }
  return (
    <Doc title="Terms of use">
      <h2>1. Operator</h2>
      <Operator />
      <h2>2. The service</h2>
      <p>{BRAND.display} is a web tool for designing, validating, documenting and exporting Apache Camel integration routes. It can be used without an account (projects stay in your browser) or with an account (projects are stored on the operator’s servers).</p>
      <h2>3. Accounts</h2>
      <ul>
        <li>Accounts may be created by individuals aged 16+ or on behalf of a company.</li>
        <li>You are responsible for your credentials and must report suspected misuse without undue delay.</li>
        <li>You can delete your account at any time in the account settings; this permanently deletes all your projects.</li>
      </ul>
      <h2>4. Plans and payments</h2>
      <p>The Free plan costs nothing. Paid plans (Pro, Team) and their prices are shown on the website at the time of purchase; payments are processed by a third-party payment provider whose terms apply. Subscriptions can be cancelled at the end of the paid period. Material changes to paid plans are announced at least 30 days in advance.</p>
      <h2>5. Your content</h2>
      <ul>
        <li>Your routes, projects and generated code belong to you. You grant the operator only the licence needed to run the service (storage, backups, display).</li>
        <li>Generated code may be used in any project, including commercial ones.</li>
        <li>A share link makes the project visible to anyone who has the link. You can revoke it at any time.</li>
        <li>Do not put passwords, tokens or third-party personal data into projects — use <code>{'{{property}}'}</code> placeholders.</li>
      </ul>
      <h2>6. Prohibited use</h2>
      <p>You must not abuse the service, circumvent limits, compromise its security, run sandbox code that attacks third parties, or overload it with automated traffic. The operator may restrict or close accounts that breach these terms.</p>
      <h2>7. Availability and liability</h2>
      <p>The service is provided “as is”. We aim for high availability but do not guarantee it — export important projects regularly. Review and test generated code before using it in production. The operator is not liable for damage caused by generated code or for lost profits; for paid plans liability is limited to the fees paid in the last 12 months, unless the law provides otherwise.</p>
      <h2>8. Trademarks</h2>
      <p>{BRAND.disclaimer}</p>
      <h2>9. Changes and governing law</h2>
      <p>Registered users are notified of changes by e-mail at least 14 days in advance and may delete their account if they disagree. Czech law applies, in particular Act No. 89/2012 Coll., the Civil Code. Consumers may contact the Czech Trade Inspection Authority (www.coi.cz) for out-of-court dispute resolution.</p>
    </Doc>
  );
}

export function Privacy() {
  if (cs()) {
    return (
      <Doc title="Zásady ochrany osobních údajů">
        <h2>Správce</h2>
        <Operator />
        <h2>Jaké údaje zpracováváme a proč</h2>
        <table className="tbl">
          <thead><tr><th>Údaje</th><th>Účel</th><th>Právní základ (GDPR)</th><th>Doba uložení</th></tr></thead>
          <tbody>
            <tr><td>E-mail, jméno, hash hesla, tarif</td><td>Vedení účtu, přihlášení, servisní e-maily</td><td>Plnění smlouvy, čl. 6 odst. 1 písm. b)</td><td>Do zrušení účtu</td></tr>
            <tr><td>Projekty, verze, snippety</td><td>Poskytování služby</td><td>Plnění smlouvy</td><td>Do smazání / zrušení účtu, v zálohách max. 14 dní</td></tr>
            <tr><td>Session cookie</td><td>Udržení přihlášení, ochrana proti CSRF</td><td>Nezbytné pro službu</td><td>Max. 30 dní</td></tr>
            <tr><td>IP adresa (jen dočasně)</td><td>Ochrana proti zneužití (limity pokusů)</td><td>Oprávněný zájem, písm. f)</td><td>Max. 24 hodin, ukládá se jen otisk (hash)</td></tr>
            <tr><td>Chybová hlášení z prohlížeče</td><td>Oprava chyb</td><td>Oprávněný zájem</td><td>90 dní</td></tr>
            <tr><td>Fakturační údaje (placené tarify)</td><td>Účetnictví, daně</td><td>Právní povinnost, písm. c)</td><td>10 let</td></tr>
          </tbody>
        </table>
        <h2>Statistiky návštěvnosti</h2>
        <p>Počítáme pouze souhrnné denní počty zobrazení jednotlivých stránek, bez cookies, bez IP adres a bez vazby na konkrétního uživatele. Proto nepotřebujeme souhlas s cookies. Pokud bychom nasadili nástroj třetí strany, uvedeme ho zde.</p>
        <h2>Bez účtu</h2>
        <p>Bez přihlášení se projekty ukládají pouze ve vašem prohlížeči (localStorage) a na server se neodesílají, s výjimkou anonymních statistik a chybových hlášení popsaných výše.</p>
        <h2>Zpracovatelé a předávání</h2>
        <p>Údaje jsou uloženy u poskytovatele hostingu ({BRAND.hosting}) v EU. E-maily odesíláme přes SMTP poskytovatele hostingu. Platby (u placených tarifů) zpracovává poskytovatel plateb jako samostatný správce. Údaje neprodáváme a nepředáváme mimo EU.</p>
        <h2>Vaše práva</h2>
        <p>Máte právo na přístup, opravu, výmaz, omezení zpracování, přenositelnost a vznést námitku. Export všech dat a smazání účtu najdete přímo v <a href={href('/account')}>nastavení účtu</a>; ostatní žádosti posílejte na {op.email}. Máte právo podat stížnost u Úřadu pro ochranu osobních údajů (www.uoou.cz).</p>
        <h2>Zabezpečení</h2>
        <p>Hesla ukládáme pouze jako hash (bcrypt/argon2), komunikace probíhá přes HTTPS, session cookie je HttpOnly a SameSite, přístup k datům je oddělen podle účtů. Do projektů nevkládejte skutečná hesla ani tokeny.</p>
      </Doc>
    );
  }
  return (
    <Doc title="Privacy policy">
      <h2>Controller</h2>
      <Operator />
      <h2>What we process and why</h2>
      <table className="tbl">
        <thead><tr><th>Data</th><th>Purpose</th><th>Legal basis (GDPR)</th><th>Retention</th></tr></thead>
        <tbody>
          <tr><td>E-mail, name, password hash, plan</td><td>Account, sign-in, service e-mails</td><td>Contract, Art. 6(1)(b)</td><td>Until the account is deleted</td></tr>
          <tr><td>Projects, versions, snippets</td><td>Providing the service</td><td>Contract</td><td>Until deleted; in backups max. 14 days</td></tr>
          <tr><td>Session cookie</td><td>Keeping you signed in, CSRF protection</td><td>Strictly necessary</td><td>Max. 30 days</td></tr>
          <tr><td>IP address (temporarily)</td><td>Abuse protection (rate limits)</td><td>Legitimate interest, Art. 6(1)(f)</td><td>Max. 24 h, only a hash is stored</td></tr>
          <tr><td>Browser error reports</td><td>Fixing bugs</td><td>Legitimate interest</td><td>90 days</td></tr>
          <tr><td>Billing data (paid plans)</td><td>Accounting, taxes</td><td>Legal obligation, Art. 6(1)(c)</td><td>10 years</td></tr>
        </tbody>
      </table>
      <h2>Analytics</h2>
      <p>We only count aggregated daily page views per page — no cookies, no IP addresses, no link to individual users — so no cookie consent is needed. If we ever add a third-party tool, it will be listed here.</p>
      <h2>Without an account</h2>
      <p>Without signing in, projects stay in your browser (localStorage) and are not sent to our servers, except the anonymous statistics and error reports described above.</p>
      <h2>Processors and transfers</h2>
      <p>Data is stored with our hosting provider ({BRAND.hosting}) in the EU. E-mails are sent through the hosting provider’s SMTP. Payments (paid plans) are processed by the payment provider as an independent controller. We do not sell data or transfer it outside the EU.</p>
      <h2>Your rights</h2>
      <p>You have the right of access, rectification, erasure, restriction, portability and objection. Data export and account deletion are available in your <a href={href('/account')}>account settings</a>; send other requests to {op.email}. You may lodge a complaint with the Czech Office for Personal Data Protection (www.uoou.cz).</p>
      <h2>Security</h2>
      <p>Passwords are stored only as hashes, all traffic uses HTTPS, the session cookie is HttpOnly and SameSite, and data access is separated per account. Do not put real passwords or tokens into projects.</p>
    </Doc>
  );
}
