import { esc } from '$lib/server/mail';
import { newServerPdf } from '$lib/server/pdf';
import { rysujLogo } from '$lib/server/pdfLogo';
import type { PodpisPdf } from '$lib/server/podpis';
import { okresNowyWniosku, opObecnie, type RenewalRow } from '$lib/server/renewals';
import { ZGODA_TYTUL, ZGODY, opisZgody, type KanalZgody } from '$lib/renewals/zgody';
import {
	APK_ODPOWIEDZI,
	APK_ODMOWA_TRESC,
	APK_PYTANIA,
	KLAUZULA_OCHRONY_PRAWNEJ,
	LICZBA_OSOB,
	LUKI_OCHRONY,
	LUKI_OCHRONY_WU,
	NOWY_LINK_DNI,
	OCHRONA_PRAWNA_LIMIT,
	OCHRONA_PRAWNA_SKLADKA,
	OSWIADCZENIA_NOWEJ,
	OSWIADCZENIE_ANKIETY,
	PROGRAM_NR,
	RODZAJE_GABINETU,
	SUMA_NAJCZESCIEJ_WYBIERANA,
	SUMY,
	UBEZPIECZYCIEL,
	ZABIEGI_ANKIETA,
	formatSuma,
	formatZl,
	kategoriaZRodzajow,
	nazwaUbezpieczyciela,
	opisZalacznika,
	skladkaProgramu,
	type Ankieta,
	type Apk,
	type RodzajWniosku,
	type Suma,
	type Wniosek
} from '$lib/renewals/program';

// Treści e-maili i PDF wniosku o odnowienie. Wszystko, co pochodzi od klienta, przechodzi przez esc()
// (HTML) albo trafia do PDF jako zwykły tekst.

const STOPKA = 'Beauty❤️Polisa · Aura Expert sp. z o.o., ul. Bolkowska 2A/28, 01-466 Warszawa · auraexpert.pl';
const STOPKA_HTML =
	'Beauty❤️Polisa · <a href="https://auraexpert.pl/" target="_blank" rel="noopener noreferrer" style="color:#64748b;">Aura Expert sp. z o.o.</a>, ul. Bolkowska 2A/28, 01-466 Warszawa';
const KONTAKT = 'odnowienia@auraexpert.pl';
// Logo w prawym górnym rogu PDF (mm; prawy margines 14 mm).
const LOGO_PDF_SZER = 46;

export const DECYZJA_TEKST = { bez_zmian: 'TAK — odnowienie bez zmian', zmiany: 'TAK — odnowienie ze zmianami', nie: 'NIE — rezygnacja z odnowienia', nowa: 'TAK — wniosek o zawarcie ubezpieczenia' } as const;
// Tekst decyzji z uwzględnieniem rodzaju wniosku (przy pierwszej polisie „nie” to rezygnacja z ubezpieczenia).
export const decyzjaTekst = (r: Pick<RenewalRow, 'decyzja' | 'rodzaj'>): string =>
	r.rodzaj === 'nowa' && r.decyzja === 'nie' ? 'NIE — rezygnacja z ubezpieczenia' : (DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? r.decyzja ?? '—');
const nowaPolisa = (r: Pick<RenewalRow, 'rodzaj'>) => r.rodzaj === 'nowa';
const nowyOkres = (r: Pick<RenewalRow, 'rodzaj' | 'okres_do' | 'wniosek'>) => okresNowyWniosku(r);

// Pierwsza polisa: dane firmy i początek ochrony podane przez klienta (zadanie, e-mail do biura, PDF).
export function opisNowej(w: Wniosek | null): string[] {
	const n = w?.nowa;
	if (!n) return [];
	const f = n.firma;
	const okres = okresNowyWniosku({ rodzaj: 'nowa', okres_do: null, wniosek: w });
	return [
		`Ubezpieczający: ${f.nazwa}, NIP ${f.nip}${f.regon ? `, REGON ${f.regon}` : ''}`,
		`Adres gabinetu: ${f.ulica}, ${f.kod} ${f.miasto}`,
		`Kontakt: ${f.email}, tel. ${f.telefon}`,
		`Okres ubezpieczenia: ${data(okres.od)} – ${data(okres.do)}`
	];
}

const data = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
const dataGodzina = (iso: string | null | undefined) =>
	iso ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';

function ramka(tytul: string, tresc: string) {
	return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:28px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="background:#2a3b69;padding:20px 28px;border-radius:8px 8px 0 0;">
        <p style="margin:0;font-size:13px;color:#c7d2fe;">Beauty❤️Polisa · ${esc(UBEZPIECZYCIEL)}</p>
        <h1 style="margin:4px 0 0;font-size:20px;color:#fff;">${esc(tytul)}</h1>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;color:#334155;">${tresc}</td></tr>
      <tr><td style="padding:14px 28px;border-top:1px solid #eef0f3;font-size:12px;color:#94a3b8;">${STOPKA_HTML}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const przycisk = (href: string, tekst: string) =>
	`<p style="margin:22px 0;"><a href="${esc(href)}" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:6px;">${esc(tekst)}</a></p>`;

// ---------- Zaproszenie i przypomnienie ----------

export function mailZaproszenie(r: RenewalRow, link: string, przypomnienie = false) {
	if (nowaPolisa(r)) return mailZaproszenieNowej(r, link, przypomnienie);
	const koniec = data(r.okres_do);
	const nowy = nowyOkres(r);
	const temat = przypomnienie
		? `Przypomnienie: odnowienie ubezpieczenia OC — certyfikat ${r.nr_polisy ?? ''} kończy się ${koniec}`
		: `Odnowienie ubezpieczenia OC gabinetu — certyfikat ${r.nr_polisy ?? ''} kończy się ${koniec}`;
	const skladka = r.skladka != null ? formatZl(Number(r.skladka)) : null;
	const html = ramka(przypomnienie ? 'Przypomnienie o odnowieniu' : 'Odnowienie ubezpieczenia OC', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    <p style="margin:0 0 14px;">${przypomnienie ? 'przypominamy, że ' : ''}ochrona OC w programie Beauty❤️Polisa (STU Ergo Hestia SA) dla <strong>${esc(r.klient_nazwa)}</strong>
      kończy się <strong>${esc(koniec)}</strong>. Aby przedłużyć ją na okres ${esc(data(nowy.od))}–${esc(data(nowy.do))}, wypełnij krótki wniosek online — zajmie to około 5 minut.</p>
    ${przycisk(link, 'Przejdź do wniosku o odnowienie')}
    <p style="margin:0 0 10px;">We wniosku:</p>
    <ul style="margin:0 0 14px;padding-left:20px;">
      <li>krótka analiza potrzeb (APK),</li>
      <li>potwierdzenie odnowienia bez zmian${skladka ? ` (składka ${esc(skladka)})` : ''} albo ze zmianami — np. wyższa suma gwarancyjna, ochrona prawna, nowe zabiegi,</li>
      <li>możliwość rezygnacji z odnowienia.</li>
    </ul>
    <p style="margin:0 0 10px;font-size:13px;color:#64748b;">Link jest ważny do ${esc(dataGodzina(r.wazny_do))}. Pytania? Odpowiedz na tę wiadomość.</p>`);
	const tekst = [
		'Dzień dobry,',
		'',
		`${przypomnienie ? 'przypominamy, że ' : ''}ochrona OC w programie Beauty❤️Polisa (STU Ergo Hestia SA) dla ${r.klient_nazwa} kończy się ${koniec}.`,
		`Aby przedłużyć ją na okres ${data(nowy.od)}–${data(nowy.do)}, wypełnij wniosek online:`,
		link,
		'',
		`We wniosku: analiza potrzeb (APK), potwierdzenie odnowienia bez zmian${skladka ? ` (składka ${skladka})` : ''} albo ze zmianami, możliwość rezygnacji.`,
		`Link jest ważny do ${dataGodzina(r.wazny_do)}. Pytania? Odpowiedz na tę wiadomość.`,
		'',
		STOPKA
	].join('\n');
	return { temat, html, tekst };
}

// Pierwsza polisa: zaproszenie do APK i wniosku o zawarcie ubezpieczenia (klient bez certyfikatu).
function mailZaproszenieNowej(r: RenewalRow, link: string, przypomnienie: boolean) {
	const temat = przypomnienie
		? `Przypomnienie: wniosek o ubezpieczenie OC gabinetu — ${r.klient_nazwa ?? ''}`
		: `Ubezpieczenie OC gabinetu — analiza potrzeb i wniosek online dla ${r.klient_nazwa ?? ''}`;
	const html = ramka(przypomnienie ? 'Przypomnienie o wniosku' : 'Ubezpieczenie OC gabinetu', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    <p style="margin:0 0 14px;">${przypomnienie ? 'przypominamy o wniosku o ubezpieczenie OC w programie Beauty❤️Polisa (STU Ergo Hestia SA) dla ' : 'przygotowaliśmy dla '}<strong>${esc(r.klient_nazwa)}</strong>${przypomnienie ? '.' : ' wniosek o ubezpieczenie OC gabinetu w programie Beauty❤️Polisa (STU Ergo Hestia SA).'}
      Wypełnij go online — zajmie to około 5 minut, a certyfikat przygotujemy po sprawdzeniu wniosku.</p>
    ${przycisk(link, 'Przejdź do analizy potrzeb i wniosku')}
    <p style="margin:0 0 10px;">We wniosku:</p>
    <ul style="margin:0 0 14px;padding-left:20px;">
      <li>krótka analiza potrzeb (APK) z podpisem,</li>
      <li>dane gabinetu, początek ochrony, suma gwarancyjna (100.000, 200.000 albo 300.000 zł) i ochrona prawna — od razu z orientacyjną składką,</li>
      <li>podpis pod wnioskiem; PDF-y przyjdą e-mailem.</li>
    </ul>
    <p style="margin:0 0 10px;font-size:13px;color:#64748b;">Link jest ważny ${NOWY_LINK_DNI} dni — do ${esc(dataGodzina(r.wazny_do))}. Pytania? Odpowiedz na tę wiadomość.</p>`);
	const tekst = [
		'Dzień dobry,',
		'',
		`${przypomnienie ? 'przypominamy o wniosku' : 'przygotowaliśmy wniosek'} o ubezpieczenie OC gabinetu w programie Beauty❤️Polisa (STU Ergo Hestia SA) dla ${r.klient_nazwa}.`,
		'Wypełnij go online (około 5 minut):',
		link,
		'',
		'We wniosku: analiza potrzeb (APK), dane gabinetu, początek ochrony, suma gwarancyjna i ochrona prawna z orientacyjną składką, podpis.',
		`Link jest ważny do ${dataGodzina(r.wazny_do)}. Pytania? Odpowiedz na tę wiadomość.`,
		'',
		STOPKA
	].join('\n');
	return { temat, html, tekst };
}

// ---------- E-mail z analizą potrzeb (od razu po APK) ----------

// Aura Expert obsługuje program jako agent ubezpieczeniowy (nie broker): po APK nie ma rekomendacji,
// jest propozycja wynikająca z Umowy Generalnej na OC dla branży beauty.
export const DYSTRYBUTOR = 'Aura Expert sp. z o.o., ul. Bolkowska 2A/28, 01-466 Warszawa';

// Wszystkie warianty sumy z programu z orientacyjną składką (gdy APK podaje rodzaj gabinetu i liczbę osób).
// Bez rekomendacji — środkowy wariant oznaczony tylko jako najczęściej wybierany.
function wariantySum(r: RenewalRow): string {
	const a = r.apk_odmowa ? null : r.apk;
	const kategoria = a ? kategoriaZRodzajow(a.rodzaje) : null;
	const opis = (suma: Suma) => (suma === SUMA_NAJCZESCIEJ_WYBIERANA ? ' (najczęściej wybierany)' : '');
	const linie = SUMY.map((suma) => {
		const w = kategoria && a ? skladkaProgramu({ kategoria, suma, osoby: a.osoby, ochronaPrawna: false }) : null;
		return `${formatSuma(suma)}${w?.rodzaj === 'kwota' ? ` — ${formatZl(w.kwota)} rocznie` : ''}${opis(suma)}`;
	});
	const zCenami = linie.some((l) => l.includes(' rocznie'));
	const skladka = zCenami
		? 'Składki orientacyjne według taryfy programu.'
		: a?.osoby === '9+'
			? `Składkę ustala indywidualnie ${UBEZPIECZYCIEL} (więcej niż 8 osób wykonujących zabiegi).`
			: 'Składka według taryfy programu.';
	return [
		...linie,
		`Ochrona prawna (klauzula 7): +${formatZl(OCHRONA_PRAWNA_SKLADKA)} rocznie.`,
		skladka,
		nowaPolisa(r) ? 'Sumę, ochronę prawną i początek ochrony wskazujesz we wniosku o zawarcie ubezpieczenia.' : 'Sumę i ewentualne zmiany zakresu wskazujesz we wniosku o odnowienie.'
	].join('\n');
}

// Propozycja ubezpieczenia po APK (PDF APK). Gdy zgłoszone potrzeby wykraczają poza program — informacja wprost.
export function propozycjaApk(r: RenewalRow): [string, string][] {
	const nowy = nowyOkres(r);
	const umowa = r.program ? `Umowy Generalnej na OC dla branży beauty (${r.program})` : 'Umowy Generalnej na OC dla branży beauty';
	const wiersze: [string, string][] = [
		[
			'Proponowane ubezpieczenie',
			nowaPolisa(r)
				? `Zawarcie ubezpieczenia OC zawodowego gabinetu na 12 miesięcy od dnia wskazanego we wniosku w ramach ${umowa}, ${UBEZPIECZYCIEL}, na warunkach tej umowy.`
				: `Odnowienie ubezpieczenia OC zawodowego na okres ${data(nowy.od)} – ${data(nowy.do)} w ramach ${umowa}, ` +
					`${UBEZPIECZYCIEL}, na warunkach tej umowy.`
		],
		['Warianty sumy gwarancyjnej', wariantySum(r)],
		[
			'Charakter propozycji',
			'Aura Expert sp. z o.o. działa jako agent ubezpieczeniowy. Propozycja wynika z zawartej Umowy Generalnej — ' +
				'nie jest rekomendacją ani porównaniem ofert różnych ubezpieczycieli.'
		]
	];
	const a = r.apk_odmowa ? null : r.apk;
	wiersze.push([
		'Czego program nie obejmuje (m.in.)',
		[...LUKI_OCHRONY.map((l) => `• ${l.tekst}${l.inne && a?.inne_ubezpieczenia.includes(l.inne) ? ' (Klient ma osobne ubezpieczenie)' : ''}`), LUKI_OCHRONY_WU].join('\n')
	]);
	if (!a) {
		wiersze.push(['Zgodność z potrzebami', 'Nie oceniono — Klient odmówił wypełnienia analizy potrzeb.']);
		return wiersze;
	}
	const uwagi: string[] = [];
	if (a.suma_oczekiwana === 'wiecej')
		uwagi.push(
			`Oczekiwana suma gwarancyjna jest wyższa niż ${formatSuma(Math.max(...SUMY))} — najwyższa suma w programie. ` +
				'Tej potrzeby program nie zaspokoi w pełni; skontaktujemy się w tej sprawie.'
		);
	if (a.osoby === '9+') uwagi.push(`Więcej niż 8 osób wykonujących zabiegi — warunki ustala indywidualnie ${UBEZPIECZYCIEL}.`);
	wiersze.push(['Zgodność z potrzebami', uwagi.length ? uwagi.join(' ') : 'Propozycja odpowiada wymaganiom i potrzebom wskazanym w analizie.']);
	return wiersze;
}

export function mailApk(r: RenewalRow, link: string, aktualizacja = false) {
	const odmowa = r.apk_odmowa || !r.apk;
	const nowa = nowaPolisa(r);
	const przed = nowa ? 'przed zawarciem ubezpieczenia OC' : 'przed odnowieniem ubezpieczenia OC';
	const temat = `${odmowa ? 'Odmowa wypełnienia analizy potrzeb (APK)' : 'Analiza potrzeb (APK)'}${aktualizacja ? ' — wersja poprawiona' : ''} — ${nowa ? r.klient_nazwa ?? '' : `certyfikat ${r.nr_polisy ?? ''}`}`;
	const akapity = [
		odmowa
			? `zapisaliśmy, że świadomie odmawiasz wypełnienia analizy potrzeb (APK) ${przed} dla ${r.klient_nazwa}. W załączonym PDF jest potwierdzenie odmowy i propozycja ubezpieczenia wynikająca z Umowy Generalnej na OC dla branży beauty — zachowaj go.`
			: `dziękujemy za wypełnienie analizy potrzeb (APK) ${przed} dla ${r.klient_nazwa}. W załączonym PDF są Twoje odpowiedzi i propozycja ubezpieczenia wynikająca z Umowy Generalnej na OC dla branży beauty — zachowaj go.`,
		`${nowa ? 'Wniosek o ubezpieczenie' : 'Wniosek o odnowienie'} dokończysz pod tym samym linkiem. Po wysłaniu wniosku przyślemy drugi e-mail z PDF wniosku.`
	];
	const html = ramka(odmowa ? 'Odmowa wypełnienia APK' : 'Analiza potrzeb (APK)', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    ${akapity.map((a) => `<p style="margin:0 0 14px;">${esc(a)}</p>`).join('\n    ')}
    ${przycisk(link, 'Wróć do wniosku')}
    <p style="margin:0 0 10px;font-size:13px;color:#64748b;">Pytania? Odpowiedz na tę wiadomość. Link jest ważny do ${esc(dataGodzina(r.wazny_do))}.</p>`);
	const tekst = ['Dzień dobry,', '', ...akapity, '', link, '', STOPKA].join('\n');
	return { temat, html, tekst };
}

// ---------- Opis decyzji (wspólny dla e-maili i PDF) ----------

// ankieta: zabiegi z pozycji „Inny – prosimy opisać” też są zmianą, o którą prosi klient (doradca je wycenia).
// rodzaj 'nowa': te same pola opisują zakres pierwszej polisy (suma zamiast „nowej sumy”, uwagi zamiast „innych zmian”).
export function opisZmian(w: Wniosek | null, apk: Apk | null, ankieta: Pick<Ankieta, 'inne_zabiegi'> | null = null, rodzaj: RodzajWniosku = 'odnowienie'): string[] {
	const nowa = rodzaj === 'nowa';
	if (!w || (w.decyzja !== 'zmiany' && w.decyzja !== 'nowa') || !w.zmiany) return [];
	const z = w.zmiany;
	const linie: string[] = [];
	if (z.wyzsza_suma) linie.push(`${nowa ? 'Suma gwarancyjna' : 'Nowa suma gwarancyjna'}: ${formatSuma(z.wyzsza_suma)}`);
	if (nowa) linie.push(z.ochrona_prawna ? `Klauzula ochrony prawnej: tak (+${OCHRONA_PRAWNA_SKLADKA} zł rocznie, limit ${formatSuma(OCHRONA_PRAWNA_LIMIT)})` : 'Klauzula ochrony prawnej: nie');
	else if (z.ochrona_prawna) linie.push(`Klauzula ochrony prawnej (+${OCHRONA_PRAWNA_SKLADKA} zł rocznie, limit ${formatSuma(OCHRONA_PRAWNA_LIMIT)})`);
	if (z.adres) linie.push(`Nowy adres działalności: ${z.adres.ulica}, ${z.adres.kod} ${z.adres.miasto}`);
	if (z.nowe_zabiegi.length) linie.push(`Nowe zabiegi z list programu: ${z.nowe_zabiegi.join('; ')}`);
	if (z.zabiegi_ankieta.length) linie.push(`Zabiegi wymagające ankiety: ${z.zabiegi_ankieta.join('; ')}`);
	if (ankieta?.inne_zabiegi?.trim()) linie.push(`Inne zabiegi do oceny ryzyka (ankieta, „Inny”): ${ankieta.inne_zabiegi.trim()}`);
	for (const w of z.wykonawcy ?? []) linie.push(`Wykonuje: ${w.imie_nazwisko} — ${w.zabiegi.join('; ')}`);
	if (z.inne) linie.push(`${nowa ? 'Uwagi klienta' : 'Inne'}: ${z.inne}`);
	if (!apk && z.rodzaje.length) linie.push(`Rodzaj działalności (do wyceny): ${z.rodzaje.map(rodzajNazwa).join(', ')}`);
	if (!apk && z.osoby) linie.push(`Liczba osób (do wyceny): ${osobyNazwa(z.osoby)}`);
	return linie;
}

const rodzajNazwa = (k: string) => RODZAJE_GABINETU.find((r) => r.key === k)?.nazwa ?? k;
const osobyNazwa = (k: string) => LICZBA_OSOB.find((o) => o.key === k)?.nazwa ?? k;

export function opisSkladki(r: Pick<RenewalRow, 'decyzja' | 'skladka_nowa'>): string {
	if (r.decyzja === 'nie') return '—';
	if (r.skladka_nowa != null) return formatZl(Number(r.skladka_nowa)) + (r.decyzja === 'zmiany' || r.decyzja === 'nowa' ? ' (orientacyjnie wg programu, potwierdzi doradca)' : '');
	return 'do indywidualnej wyceny przez doradcę';
}

export function odpowiedziApk(apk: Apk): [string, string][] {
	const tak = (v: string) => (v === 'tak' ? 'tak' : 'nie');
	return [
		[APK_PYTANIA.rodzaje, apk.rodzaje.map(rodzajNazwa).join(', ')],
		[APK_PYTANIA.osoby, osobyNazwa(apk.osoby)],
		// Starsze wnioski (przed 9.10.2026) miały w APK pytania o szkody i zabiegi spoza list.
		...(apk.szkody ? ([[APK_PYTANIA.szkody, apk.szkody === 'tak' ? `tak — ${apk.szkody_opis ?? ''}` : 'nie']] as [string, string][]) : []),
		...(apk.spoza_listy ? ([[APK_PYTANIA.spoza_listy, apk.spoza_listy === 'tak' ? `tak — ${apk.spoza_listy_opis ?? ''}` : 'nie']] as [string, string][]) : []),
		// Starsze APK: oczekiwana suma i priorytet (dziś sumę wybiera się we wniosku, a priorytetu nie pytamy).
		...(apk.suma_oczekiwana ? ([[APK_PYTANIA.suma_oczekiwana, (APK_ODPOWIEDZI.suma_oczekiwana as Record<string, string>)[apk.suma_oczekiwana] ?? apk.suma_oczekiwana]] as [string, string][]) : []),
		[APK_PYTANIA.ochrona_prawna, (APK_ODPOWIEDZI.ochrona_prawna as Record<string, string>)[apk.ochrona_prawna] ?? 'nie wiem'],
		[APK_PYTANIA.szkolenia, tak(apk.szkolenia)],
		[APK_PYTANIA.inne_ubezpieczenia, apk.inne_ubezpieczenia.map((k) => APK_ODPOWIEDZI.inne_ubezpieczenia[k]).join(', ')],
		...(apk.priorytet ? ([[APK_PYTANIA.priorytet, APK_ODPOWIEDZI.priorytet[apk.priorytet] ?? apk.priorytet]] as [string, string][]) : []),
		...(apk.uwagi ? ([[APK_PYTANIA.uwagi, apk.uwagi]] as [string, string][]) : [])
	];
}

// ---------- Potwierdzenie dla klienta i powiadomienie biura ----------

// PDF ankiety nie powstał przy złożeniu (blad_pdf_ankiety) — e-mail do biura i zadanie dla doradcy.
export const BRAK_PDF_ANKIETY =
	'PDF ankiety nie powstał — wyślij klientowi ankietę do podpisu ręcznie (odpowiedzi klienta są na karcie polisy w sekcji „Ankieta Ergo Hestii”).';

// ankietaWZalaczniku: PDF ankiety Ergo Hestii (osobny dokument do podpisu) dołączony do e-maila.
export function mailPotwierdzenie(r: RenewalRow, apkWZalaczniku = false, ankietaWZalaczniku = !!r.ankieta) {
	const nowy = nowyOkres(r);
	const ankieta = !!r.ankieta;
	const ankietaPdf = ankieta && ankietaWZalaczniku;
	const nowa = nowaPolisa(r);
	const akapity: string[] = [];
	if (nowa && r.decyzja === 'nowa') {
		akapity.push(`przyjęliśmy wniosek o ubezpieczenie OC gabinetu dla ${r.klient_nazwa}. Doradca sprawdzi wniosek, potwierdzi składkę i przygotuje certyfikat na okres ${data(nowy.od)}–${data(nowy.do)}.`);
		if (ankieta) {
			akapity.push(
				ankietaPdf
					? `Zabiegi, które wskazano, wymagają ankiety ERGO Hestia. Ankieta to osobny PDF „Ankieta ERGO Hestia” w załączniku — wydrukuj go, podpisz ankietę i odeślij jej skan na ${KONTAKT} (wystarczy odpowiedzieć na tę wiadomość). Bez podpisanej ankiety ubezpieczyciel nie obejmie tych zabiegów ochroną.`
					: `Zabiegi, które wskazano, wymagają ankiety ERGO Hestia. PDF ankiety do podpisu prześlemy w osobnej wiadomości — wydrukuj go, podpisz i odeślij skan na ${KONTAKT}. Bez podpisanej ankiety ubezpieczyciel nie obejmie tych zabiegów ochroną.`
			);
		}
	} else if (nowa) {
		akapity.push(`przyjęliśmy informację, że nie wnioskujesz o ubezpieczenie OC gabinetu dla ${r.klient_nazwa}. Jeśli zmienisz zdanie, odpowiedz na tę wiadomość — przygotujemy nowy wniosek.`);
	} else if (r.decyzja === 'bez_zmian') {
		akapity.push(`przyjęliśmy wniosek o odnowienie ubezpieczenia OC bez zmian dla ${r.klient_nazwa}. Przygotujemy odnowienie certyfikatu na okres ${data(nowy.od)}–${data(nowy.do)}.`);
	} else if (r.decyzja === 'zmiany') {
		akapity.push(`przyjęliśmy wniosek o odnowienie ubezpieczenia OC ze zmianami dla ${r.klient_nazwa}. Doradca sprawdzi zmiany i potwierdzi zakres oraz składkę przed wystawieniem certyfikatu na okres ${data(nowy.od)}–${data(nowy.do)}.`);
		if (ankieta) {
			akapity.push(
				ankietaPdf
					? `Zabiegi, które wskazano, wymagają ankiety ERGO Hestia. Ankieta to osobny PDF „Ankieta ERGO Hestia” w załączniku — wydrukuj go, podpisz ankietę i odeślij jej skan na ${KONTAKT} (wystarczy odpowiedzieć na tę wiadomość). Bez podpisanej ankiety ubezpieczyciel nie obejmie tych zabiegów ochroną.`
					: `Zabiegi, które wskazano, wymagają ankiety ERGO Hestia. PDF ankiety do podpisu prześlemy w osobnej wiadomości — wydrukuj go, podpisz i odeślij skan na ${KONTAKT}. Bez podpisanej ankiety ubezpieczyciel nie obejmie tych zabiegów ochroną.`
			);
		}
	} else {
		akapity.push(`przyjęliśmy informację o rezygnacji z odnowienia ubezpieczenia OC dla ${r.klient_nazwa}. Ochrona kończy się ${data(r.okres_do)} — od tego dnia gabinet nie ma ubezpieczenia OC w programie.`);
		akapity.push('Jeśli zmienisz zdanie, odpowiedz na tę wiadomość — przygotujemy odnowienie.');
	}
	// Załączniki: PDF wniosku, PDF APK (gdy nie poszedł wcześniej) i PDF ankiety Ergo Hestii (do podpisu).
	const pliki = ['PDF z treścią wniosku', ...(apkWZalaczniku ? ['PDF analizy potrzeb (APK)'] : []), ...(ankietaPdf ? ['PDF ankiety ERGO Hestia do podpisu'] : [])];
	akapity.push(
		(pliki.length === 1 ? 'W załączniku przesyłamy PDF z treścią wniosku.' : `W załącznikach przesyłamy ${pliki.slice(0, -1).join(', ')} i ${pliki[pliki.length - 1]}.`) +
			(apkWZalaczniku ? '' : ' Analizę potrzeb (APK) wysłaliśmy wcześniej osobnym e-mailem.')
	);
	const temat = nowa
		? r.decyzja === 'nie'
			? `Rezygnacja z ubezpieczenia OC — ${r.klient_nazwa ?? ''}`
			: `Wniosek o ubezpieczenie OC przyjęty — ${r.klient_nazwa ?? ''}${ankieta ? ' (ankieta do podpisu)' : ''}`
		: r.decyzja === 'nie'
			? `Rezygnacja z odnowienia ubezpieczenia OC — certyfikat ${r.nr_polisy ?? ''}`
			: `Wniosek o odnowienie ubezpieczenia OC przyjęty — certyfikat ${r.nr_polisy ?? ''}${ankieta ? ' (ankieta do podpisu)' : ''}`;
	const html = ramka(r.decyzja === 'nie' ? 'Rezygnacja przyjęta' : 'Wniosek przyjęty', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    ${akapity.map((a) => `<p style="margin:0 0 14px;">${esc(a)}</p>`).join('\n    ')}
    ${ankieta ? `<p style="margin:0 0 14px;padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;"><strong>Do zrobienia:</strong> wydrukuj, podpisz i odeślij skan ankiety (${ankietaPdf ? 'osobny PDF „Ankieta ERGO Hestia” w załączniku' : 'PDF „Ankieta ERGO Hestia” prześlemy osobno'}).</p>` : ''}`);
	const tekst = ['Dzień dobry,', '', ...akapity, '', STOPKA].join('\n');
	return { temat, html, tekst };
}

// Sygnały z APK, na które doradca powinien spojrzeć przed wystawieniem certyfikatu.
export function sygnalyApk(r: RenewalRow): string[] {
	const a = r.apk_odmowa ? null : r.apk;
	if (!a) return [];
	const s: string[] = [];
	if (a.osoby === '9+') s.push('APK: więcej niż 8 osób wykonujących zabiegi — poza taryfą programu');
	if (a.szkody === 'tak') s.push(`APK: szkody lub roszczenia${a.szkody_opis ? ` — ${a.szkody_opis}` : ''}`);
	if (a.spoza_listy === 'tak') s.push(`APK: zabiegi spoza list programu${a.spoza_listy_opis ? ` — ${a.spoza_listy_opis}` : ''}`);
	if (a.suma_oczekiwana === 'wiecej') s.push(`APK: oczekiwana suma gwarancyjna wyższa niż ${formatSuma(300000)}`);
	return s;
}

// ankietaPdf: czy PDF ankiety powstał (jest w CRM i poszedł do klienta). Gdy nie — biuro wysyła ankietę samo.
export function mailBiuro(r: RenewalRow, linki: { polisa: string; klient: string }, kto: { ip: string | null }, ankietaPdf = !!r.ankieta) {
	const nowa = nowaPolisa(r);
	const zmiany = [...(nowa ? opisNowej(r.wniosek) : []), ...opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk, r.ankieta, r.rodzaj), ...sygnalyApk(r)];
	const ankietaBezPdf = !!r.ankieta && !ankietaPdf;
	const nowy = nowyOkres(r);
	const temat = nowa
		? `[Pierwsza polisa] ${decyzjaTekst(r)} — ${r.klient_nazwa}${r.ankieta ? ' — ANKIETA' : ''}`
		: `[Odnowienie] ${decyzjaTekst(r)} — ${r.klient_nazwa} — cert. ${r.nr_polisy ?? '—'}${r.ankieta ? ' — ANKIETA' : ''}`;
	const wiersze: [string, string][] = [
		['Klient', r.klient_nazwa ?? '—'],
		...(nowa
			? ([['Wniosek', `pierwsza polisa w programie OC beauty${r.decyzja === 'nowa' ? ` — ochrona ${data(nowy.od)}–${data(nowy.do)}` : ''}`]] as [string, string][])
			: ([['Certyfikat', `${r.nr_polisy ?? '—'} (${data(r.okres_od)}–${data(r.okres_do)})`]] as [string, string][])),
		['Decyzja', decyzjaTekst(r)],
		['Składka', opisSkladki(r)],
		['APK', r.apk_odmowa ? 'klient odmówił wypełnienia APK' : 'wypełniona'],
		...(nowa ? [] : ([['Ochrona prawna w obecnym certyfikacie', opObecnie(r) ? 'tak (zostaje)' : 'nie']] as [string, string][])),
		['Złożono', `${dataGodzina(r.zlozono_at)}${kto.ip ? `, IP ${kto.ip}` : ''}`],
		...(r.wniosek?.nie_powod ? ([['Powód rezygnacji', r.wniosek.nie_powod]] as [string, string][]) : []),
		...(ankietaBezPdf ? ([['Ankieta ERGO Hestia', BRAK_PDF_ANKIETY]] as [string, string][]) : []),
		['Dokumenty w CRM', ['PDF analizy potrzeb (APK)', 'PDF wniosku', ...(r.ankieta && ankietaPdf ? ['PDF ankiety ERGO Hestia (do podpisu klienta)'] : []), ...(r.zalaczniki?.length ? [`załączniki klienta: ${r.zalaczniki.length}`] : [])].join(', ')],
		...(r.zalaczniki?.length ? ([['Załączniki klienta', r.zalaczniki.map((z) => `${opisZalacznika(z, r.wniosek?.zmiany?.wykonawcy)}: ${z.nazwa}`).join('; ')]] as [string, string][]) : [])
	];
	const naglowekZmian = nowa ? 'Dane wniosku:' : 'Zmiany i uwagi:';
	const html = ramka(nowa ? 'Wniosek o pierwszą polisę' : 'Wniosek o odnowienie', `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:14px;">
      ${wiersze.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;font-weight:600;color:#475569;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;">${esc(v)}</td></tr>`).join('\n      ')}
    </table>
    ${zmiany.length ? `<p style="margin:0 0 6px;font-weight:600;">${naglowekZmian}</p><ul style="margin:0 0 14px;padding-left:20px;">${zmiany.map((z) => `<li>${esc(z)}</li>`).join('')}</ul>` : ''}
    ${r.ankieta ? `<p style="margin:0 0 14px;color:#be123c;font-weight:600;">${ankietaBezPdf ? `${esc(BRAK_PDF_ANKIETY)}${r.email ? ' W potwierdzeniu napisaliśmy klientowi, że PDF ankiety prześlemy w osobnej wiadomości.' : ''}` : 'Klient wypełnił ankietę Ergo Hestii — czekamy na podpisany egzemplarz.'}</p>` : ''}
    <p style="margin:0 0 6px;">Pliki (PDF APK, PDF wniosku${r.ankieta && ankietaPdf ? ', PDF ankiety ERGO Hestia' : ''} i załączniki klienta) są w CRM — bez załączników w tej wiadomości:</p>
    ${przycisk(linki.polisa, nowa ? 'Otwórz wniosek na karcie klienta' : 'Otwórz wniosek na karcie polisy')}
    <p style="margin:0 0 14px;"><a href="${esc(linki.klient)}" style="color:#2a3b69;">Karta klienta → Załączniki</a></p>`);
	const tekst = [
		...wiersze.map(([k, v]) => `${k}: ${v}`),
		...(zmiany.length ? ['', naglowekZmian, ...zmiany.map((z) => `- ${z}`)] : []),
		'',
		`${nowa ? 'Wniosek na karcie klienta' : 'Wniosek na karcie polisy'}: ${linki.polisa}`,
		`Załączniki na karcie klienta: ${linki.klient}`
	].join('\n');
	return { temat, html, tekst };
}

// ---------- PDF wniosku ----------

type PdfEvent = Parameters<typeof newServerPdf>[0];
type Doc = Awaited<ReturnType<typeof newServerPdf>>['doc'];

// Blok podpisu klienta (obraz PNG z pola podpisu, data w czasie polskim, skrót SHA-256 podpisanej treści).
// Zwykły podpis elektroniczny (eIDAS) — bez określeń „kwalifikowany” ani „równoważny odręcznemu”.
// Wnioski sprzed podpisów: blok pomijany.
function blokPodpisu(doc: Doc, font: string, y: number, podpis: PodpisPdf | null | undefined, czego: string): number {
	if (!podpis) return y;
	const SZER = 60;
	const WYS = SZER / 2.5;
	if (y + WYS + 24 > 276) {
		doc.addPage();
		y = 20;
	}
	doc.setFont(font, 'bold');
	doc.setFontSize(9);
	doc.setTextColor(42, 59, 105);
	doc.text('Podpis Klienta', 14, y);
	doc.setTextColor(0);
	doc.setFont(font, 'normal');
	y += 2;
	try {
		doc.addImage(podpis.png, 'PNG', 14, y, SZER, WYS);
	} catch (e) {
		console.error('renewals: podpis w PDF nieczytelny:', (e as Error)?.message ?? e);
	}
	doc.setDrawColor(160);
	doc.setLineWidth(0.3);
	doc.line(14, y + WYS + 1, 14 + SZER, y + WYS + 1);
	y += WYS + 5;
	doc.setFontSize(7);
	doc.setTextColor(90);
	const linie: string[] = doc.splitTextToSize(
		`Podpisano elektronicznie ${dataGodzina(podpis.podpisano_at)} (czas polski) w formularzu ${czego}. Skrót SHA-256 podpisanej treści: ${podpis.skrot_tresci}`,
		182
	);
	doc.text(linie, 14, y);
	doc.setTextColor(0);
	doc.setFontSize(9);
	return y + linie.length * 3.2 + 6;
}

export async function pdfWniosku(event: PdfEvent, r: RenewalRow, kto: { ip: string | null; ua: string | null }, o: { podpis?: PodpisPdf | null } = {}): Promise<Uint8Array> {
	const { doc, autoTable, font } = await newServerPdf(event);
	const nowy = nowyOkres(r);
	const nowa = nowaPolisa(r);
	const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
	const tabela = (body: [string, string][], startY: number, head?: [string, string]) =>
		autoTable(doc, {
			startY,
			head: head ? [head] : [],
			body,
			theme: 'grid',
			styles: { font, fontSize: 9, cellPadding: 2.5, overflow: 'linebreak', lineColor: [226, 232, 240] },
			headStyles: { fillColor: [42, 59, 105], textColor: 255, fontStyle: 'bold' },
			columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold', fillColor: [248, 250, 252] }, 1: { cellWidth: 112 } },
			margin: { left: 14, right: 14 }
		});
	const naglowek = (tekst: string, y: number) => {
		if (y > 260) {
			doc.addPage();
			y = 20;
		}
		doc.setFont(font, 'bold');
		doc.setFontSize(12);
		doc.setTextColor(42, 59, 105);
		doc.text(tekst, 14, y);
		doc.setTextColor(0);
		doc.setFont(font, 'normal');
		return y + 3;
	};

	rysujLogo(doc, 196 - LOGO_PDF_SZER, 10, LOGO_PDF_SZER);
	doc.setFont(font, 'bold');
	doc.setFontSize(16);
	doc.text(nowa ? 'Wniosek o zawarcie ubezpieczenia OC' : 'Wniosek o odnowienie ubezpieczenia OC', 14, 18);
	doc.setFont(font, 'normal');
	doc.setFontSize(9);
	doc.setTextColor(100);
	doc.text(`${r.program ?? ''} · ${UBEZPIECZYCIEL} · BeautyPolisa`, 14, 24);
	doc.setTextColor(0);

	const f = r.wniosek?.nowa?.firma;
	tabela(
		nowa
			? [
					['Ubezpieczający / Ubezpieczony', f?.nazwa || r.klient_nazwa || '—'],
					['NIP / REGON', f ? `${f.nip}${f.regon ? ` / ${f.regon}` : ''}` : '—'],
					['Adres gabinetu', f ? `${f.ulica}, ${f.kod} ${f.miasto}` : '—'],
					['E-mail / telefon', f ? `${f.email} / ${f.telefon}` : r.email ?? '—'],
					['Ubezpieczyciel', nazwaUbezpieczyciela(r.tu_nazwa)],
					['Okres ubezpieczenia', r.decyzja === 'nie' ? '—' : `${data(nowy.od)} – ${data(nowy.do)} (12 miesięcy)`],
					['Suma gwarancyjna', r.wniosek?.zmiany?.wyzsza_suma ? formatSuma(r.wniosek.zmiany.wyzsza_suma) : '—'],
					['Składka', opisSkladki(r)],
					['Decyzja', decyzjaTekst(r)],
					['Złożono', `${dataGodzina(r.zlozono_at)} (wniosek elektroniczny)`]
				]
			: [
					['Ubezpieczający / Ubezpieczony', r.klient_nazwa ?? '—'],
					['Certyfikat', r.nr_polisy ?? '—'],
					['Ubezpieczyciel', nazwaUbezpieczyciela(r.tu_nazwa)],
					['Obecny okres ubezpieczenia', `${data(r.okres_od)} – ${data(r.okres_do)}`],
					['Okres po odnowieniu', r.decyzja === 'nie' ? '—' : `${data(nowy.od)} – ${data(nowy.do)}`],
					['Suma gwarancyjna (obecna)', r.suma ? formatSuma(Number(r.suma)) : 'zgodnie z obecnym certyfikatem'],
					['Składka (obecna)', r.skladka != null ? formatZl(Number(r.skladka)) : '—'],
					['Składka po odnowieniu', opisSkladki(r)],
					['Decyzja', decyzjaTekst(r)],
					['Złożono', `${dataGodzina(r.zlozono_at)} (wniosek elektroniczny)`]
				],
		30
	);

	let y = lastY() + 8;
	const zmiany = opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk, r.ankieta, r.rodzaj);
	if (zmiany.length) {
		y = naglowek(nowa ? 'Zakres ubezpieczenia wskazany przez klienta' : 'Zmiany wskazane przez klienta', y);
		tabela(zmiany.map((z, i) => [`${i + 1}.`, z] as [string, string]), y);
		y = lastY() + 8;
		if (r.wniosek?.zmiany?.ochrona_prawna) {
			y = naglowek('Treść klauzuli ochrony prawnej', y);
			tabela([['Klauzula 7', KLAUZULA_OCHRONY_PRAWNEJ]], y);
			y = lastY() + 8;
		}
	}
	if (nowa && r.decyzja === 'nowa' && r.wniosek?.nowa?.oswiadczenia) {
		y = naglowek('Oświadczenia klienta', y);
		tabela(OSWIADCZENIA_NOWEJ.map((t, i) => [`${i + 1}.`, t] as [string, string]), y);
		y = lastY() + 8;
	}
	if (r.decyzja === 'nie') {
		y = naglowek(nowa ? 'Rezygnacja z ubezpieczenia' : 'Rezygnacja z odnowienia', y);
		tabela(
			[
				['Oświadczenie', nowa ? 'Klient potwierdził, że nie wnioskuje o ubezpieczenie OC w programie.' : `Klient potwierdził rezygnację z odnowienia. Ochrona kończy się ${data(r.okres_do)}.`],
				...(r.wniosek?.nie_powod ? ([['Powód', r.wniosek.nie_powod]] as [string, string][]) : [])
			],
			y
		);
		y = lastY() + 8;
	}

	y = naglowek('Analiza potrzeb klienta (APK)', y);
	tabela(
		[[
			'APK',
			r.apk_odmowa || !r.apk
				? `Klient świadomie odmówił wypełnienia APK (${dataGodzina(r.apk_at)}).`
				: `Wypełniona ${dataGodzina(r.apk_at)} — osobny dokument „Analiza wymagań i potrzeb klienta”.`
		]],
		y
	);
	y = lastY() + 8;

	// Ankieta Ergo Hestii to osobny dokument do podpisu (pdfAnkieta) — tu tylko informacja.
	if (r.ankieta) {
		y = naglowek('Ankieta ERGO Hestia', y);
		tabela(
			[['Ankieta', `Wypełniona elektronicznie ${dataGodzina(r.zlozono_at)} — osobny dokument „Ankieta ERGO Hestia” (PDF) do wydruku, podpisu Ubezpieczonego i odesłania skanu.`]],
			y
		);
		y = lastY() + 8;
	}

	if (r.zalaczniki?.length) {
		y = naglowek('Załączniki przesłane przez klienta', y);
		tabela(r.zalaczniki.map((z) => [opisZalacznika(z, r.wniosek?.zmiany?.wykonawcy), z.nazwa] as [string, string]), y);
		y = lastY() + 8;
	}

	// Podpis klienta pod wnioskiem (decyzja, zmiany, ankieta i załączniki objęte skrótem).
	y = blokPodpisu(doc, font, y, o.podpis, nowa ? (r.decyzja === 'nie' ? 'wniosku o ubezpieczenie (rezygnacja)' : 'wniosku o ubezpieczenie') : r.decyzja === 'nie' ? 'odnowienia (rezygnacja)' : 'odnowienia (wniosek)');

	const strony = doc.getNumberOfPages();
	for (let i = 1; i <= strony; i++) {
		doc.setPage(i);
		doc.setFont(font, 'normal');
		doc.setFontSize(7);
		doc.setTextColor(140);
		doc.text(`Wniosek ${r.id} · złożony elektronicznie ${dataGodzina(r.zlozono_at)}${kto.ip ? ` · IP ${kto.ip}` : ''}`, 14, 289);
		doc.text(`Strona ${i} z ${strony}`, 196, 289, { align: 'right' });
		doc.setTextColor(0);
	}
	return new Uint8Array(doc.output('arraybuffer'));
}

// ---------- PDF analizy potrzeb (osobny dokument, wysyłany klientowi od razu po APK) ----------

// trescOdmowy: oświadczenie w brzmieniu, które klient zaznaczył (zapisane w dzienniku przy odmowie) — tekst
// w programie mógł się od tego czasu zmienić. Bez niego bieżąca treść APK_ODMOWA_TRESC.
export async function pdfApk(
	event: PdfEvent,
	r: RenewalRow,
	kto: { ip: string | null; ua: string | null },
	o: { trescOdmowy?: string | null; podpis?: PodpisPdf | null } = {}
): Promise<Uint8Array> {
	const { doc, autoTable, font } = await newServerPdf(event);
	const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
	const tabela = (body: [string, string][], startY: number, head?: [string, string]) =>
		autoTable(doc, {
			startY,
			head: head ? [head] : [],
			body,
			theme: 'grid',
			styles: { font, fontSize: 9, cellPadding: 2, overflow: 'linebreak', lineColor: [226, 232, 240] },
			headStyles: { fillColor: [42, 59, 105], textColor: 255, fontStyle: 'bold' },
			columnStyles: { 0: { cellWidth: 80, fontStyle: 'bold', fillColor: [248, 250, 252] }, 1: { cellWidth: 102 } },
			// Wiersz nie dzieli się między strony; dolny margines zostawia miejsce na stopkę strony.
			rowPageBreak: 'avoid',
			margin: { left: 14, right: 14, bottom: 16 }
		});
	const naglowek = (tekst: string, y: number) => {
		if (y > 260) {
			doc.addPage();
			y = 20;
		}
		doc.setFont(font, 'bold');
		doc.setFontSize(12);
		doc.setTextColor(42, 59, 105);
		doc.text(tekst, 14, y);
		doc.setTextColor(0);
		doc.setFont(font, 'normal');
		return y + 3;
	};
	const odmowa = r.apk_odmowa || !r.apk;
	const nowa = nowaPolisa(r);

	rysujLogo(doc, 196 - LOGO_PDF_SZER, 10, LOGO_PDF_SZER);
	doc.setFont(font, 'bold');
	doc.setFontSize(16);
	doc.text('Analiza wymagań i potrzeb klienta (APK)', 14, 18);
	doc.setFont(font, 'normal');
	doc.setFontSize(9);
	doc.setTextColor(100);
	doc.text(`${nowa ? 'Zawarcie ubezpieczenia OC' : 'Odnowienie ubezpieczenia OC'} · ${r.program ?? ''} · ${UBEZPIECZYCIEL} · BeautyPolisa`, 14, 24);
	doc.setTextColor(0);

	tabela(
		nowa
			? [
					['Klient (Ubezpieczony)', r.klient_nazwa ?? '—'],
					['Ubezpieczyciel', nazwaUbezpieczyciela(r.tu_nazwa)],
					['Rodzaj wniosku', 'pierwsza polisa w programie (klient bez certyfikatu)'],
					['Data i godzina', `${dataGodzina(r.apk_at)} (formularz elektroniczny)`],
					['Agent ubezpieczeniowy', DYSTRYBUTOR]
				]
			: [
					['Klient (Ubezpieczony)', r.klient_nazwa ?? '—'],
					['Certyfikat', r.nr_polisy ?? '—'],
					['Ubezpieczyciel', nazwaUbezpieczyciela(r.tu_nazwa)],
					['Obecny okres ubezpieczenia', `${data(r.okres_od)} – ${data(r.okres_do)}`],
					['Suma gwarancyjna (obecna)', r.suma ? formatSuma(Number(r.suma)) : 'zgodnie z obecnym certyfikatem'],
					['Data i godzina', `${dataGodzina(r.apk_at)} (formularz elektroniczny)`],
					['Agent ubezpieczeniowy', DYSTRYBUTOR]
				],
		30
	);
	let y = lastY() + 8;

	if (odmowa) {
		y = naglowek('Odmowa wypełnienia analizy potrzeb', y);
		tabela([['Oświadczenie Klienta', o.trescOdmowy || APK_ODMOWA_TRESC]], y);
	} else {
		y = naglowek('Odpowiedzi Klienta', y);
		tabela(odpowiedziApk(r.apk!), y, ['Pytanie', 'Odpowiedź']);
		y = lastY() + 8;
		y = naglowek('Oświadczenie', y);
		tabela([['Klient', 'Oświadczam, że podane informacje są zgodne z prawdą.']], y);
	}
	y = lastY() + 8;
	// Zgody marketingowe w brzmieniu z chwili podpisu (migawka przy wniosku); wnioski sprzed zgód — bez tej sekcji.
	if (r.zgody) {
		const z = r.zgody;
		const tekst = (k: KanalZgody) => z.teksty?.[k] ?? ZGODY.find((x) => x.kanal === k)?.tresc ?? '';
		y = naglowek('Zgody marketingowe (dobrowolne)', y);
		tabela(
			[
				[ZGODA_TYTUL.email, `${opisZgody(z, 'email')} — ${tekst('email')}`],
				[ZGODA_TYTUL.sms, `${opisZgody(z, 'sms')} — ${tekst('sms')}`]
			],
			y
		);
		y = lastY() + 8;
	}
	const czego = nowa ? 'wniosku o ubezpieczenie' : 'odnowienia';
	y = blokPodpisu(doc, font, y, o.podpis, odmowa ? `${czego} (odmowa wypełnienia APK i zgody)` : `${czego} (analiza potrzeb i zgody)`);
	y = naglowek('Propozycja ubezpieczenia', y);
	tabela(propozycjaApk(r), y);
	y = lastY() + 8;
	if (y > 250) {
		doc.addPage();
		y = 20;
	}
	doc.setFontSize(8.5);
	doc.setTextColor(80);
	const przed = nowa ? 'przed zawarciem ubezpieczenia' : 'przed odnowieniem ubezpieczenia';
	const info = doc.splitTextToSize(
		(odmowa
			? `Klient odmówił wypełnienia analizy ${przed} — propozycja nie uwzględnia jego wymagań i potrzeb. `
			: `Analiza została przeprowadzona ${przed} na podstawie informacji przekazanych przez Klienta. `) +
			`Dokument przekazano Klientowi na trwałym nośniku (PDF w wiadomości e-mail). ${nowa ? 'Wniosek o zawarcie ubezpieczenia' : 'Wniosek o odnowienie'} stanowi osobny dokument.`,
		182
	);
	doc.text(info, 14, y);
	doc.setTextColor(0);

	const strony = doc.getNumberOfPages();
	for (let i = 1; i <= strony; i++) {
		doc.setPage(i);
		doc.setFont(font, 'normal');
		doc.setFontSize(7);
		doc.setTextColor(140);
		doc.text(`APK do wniosku ${r.id} · ${dataGodzina(r.apk_at)}${kto.ip ? ` · IP ${kto.ip}` : ''}`, 14, 289);
		doc.text(`Strona ${i} z ${strony}`, 196, 289, { align: 'right' });
		doc.setTextColor(0);
	}
	return new Uint8Array(doc.output('arraybuffer'));
}

// ---------- PDF ankiety Ergo Hestii (osobny dokument do podpisu Ubezpieczonego) ----------

// „Program Ubezpieczenia OC nr WA50/003353/24/A” → „WA50/003353/24/A”; bez numeru — numer programu z program.ts.
export const numerProgramu = (program: string | null | undefined): string => /\bnr\s+(\S+)/i.exec(program ?? '')?.[1] ?? PROGRAM_NR;

// Nagłówki punktów w kolorze formularza Ergo.
const CZERWIEN_ERGO: [number, number, number] = [176, 18, 38];

// Układ jak w formularzu „Ankieta ubezpieczeniowa do Programu Ubezpieczenia OC … dla gabinetów kosmetologicznych”:
// 1. informacje ogólne, 2. zabiegi (wszystkie pozycje z kwadratem — zaznaczone te z wniosku), 3. osoby,
// oświadczenie i miejsce na podpis. Starsze ankiety nie mają NIP, REGON ani innych zabiegów — „—”.
export async function pdfAnkieta(event: PdfEvent, r: RenewalRow, _kto: { ip: string | null; ua: string | null }): Promise<Uint8Array> {
	const a = r.ankieta;
	if (!a) throw new Error('Wniosek nie ma ankiety.');
	const { doc, autoTable, font } = await newServerPdf(event);
	const L = 14;
	const SZER = 182;
	const DOL = 297 - 16; // poniżej — stopka strony
	const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
	const wartosc = (v: string | null | undefined) => (v?.trim() ? v.trim() : '—');
	// Siatka jak w formularzu; wiersz nie dzieli się między strony, dolny margines zostawia miejsce na stopkę.
	const tabela = (o: Parameters<typeof autoTable>[1]) =>
		autoTable(doc, {
			theme: 'grid',
			rowPageBreak: 'avoid',
			margin: { left: L, right: L, top: 14, bottom: 16 },
			...o,
			styles: { font, fontSize: 9, cellPadding: 2, overflow: 'linebreak', valign: 'middle', textColor: 20, lineColor: [110, 110, 110], lineWidth: 0.2, ...o.styles }
		});
	const punkt = (tekst: string, y: number) => {
		doc.setFont(font, 'bold');
		doc.setFontSize(11);
		const linie: string[] = doc.splitTextToSize(tekst, SZER);
		if (y + linie.length * 5 + 20 > DOL) {
			doc.addPage();
			y = 20;
		}
		doc.setTextColor(...CZERWIEN_ERGO);
		doc.text(linie, L, y);
		doc.setTextColor(0);
		doc.setFont(font, 'normal');
		return y + (linie.length - 1) * 5 + 3;
	};

	// Nagłówek: logo BeautyPolisa po lewej, ubezpieczyciel po prawej.
	rysujLogo(doc, L, 10, LOGO_PDF_SZER);
	doc.setFont(font, 'bold');
	doc.setFontSize(12);
	doc.setTextColor(...CZERWIEN_ERGO);
	doc.text(UBEZPIECZYCIEL, 196, 15.5, { align: 'right' });
	doc.setDrawColor(200);
	doc.setLineWidth(0.3);
	doc.line(L, 21, 196, 21);

	doc.setFontSize(11);
	doc.setTextColor(20);
	const tytul: string[] = doc.splitTextToSize(
		`Ankieta ubezpieczeniowa do Programu Ubezpieczenia Odpowiedzialności Cywilnej nr ${numerProgramu(r.program)} dla gabinetów ` +
			'kosmetologicznych wnioskujących o objęcie zakresem ubezpieczenia szkód wyrządzonych w następstwie wykonywania zabiegów, ' +
			'o których mowa w p. 2.',
		SZER
	);
	doc.text(tytul, L, 29);
	doc.setFont(font, 'normal');
	let y = 29 + tytul.length * 5 + 4;

	// 1. Informacje ogólne
	y = punkt('1. Informacje ogólne:', y);
	const naCalosc = (tekst: string) => ({ content: tekst, colSpan: 5 });
	tabela({
		startY: y,
		body: [
			['Ubezpieczający:', naCalosc(wartosc(a.ubezpieczajacy))],
			['Ubezpieczony:', naCalosc(wartosc(a.ubezpieczony))],
			['Data rozpoczęcia działalności:', naCalosc(data(a.data_rozpoczecia))],
			[
				'Liczba zatrudnionych osób:',
				wartosc(a.liczba_zatrudnionych),
				{ content: 'NIP', styles: { halign: 'center' } },
				wartosc(a.nip),
				{ content: 'REGON', styles: { halign: 'center' } },
				wartosc(a.regon)
			],
			[
				'Szkodowość OC z okresu ostatnich 3 lat tj. wypłacone odszkodowania, zgłoszone roszczenia, okoliczności, z których mogą powstać roszczenia w przyszłości:',
				naCalosc(wartosc(a.szkodowosc))
			]
		],
		columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 26 }, 2: { cellWidth: 14 }, 3: { cellWidth: 34 }, 4: { cellWidth: 17 }, 5: { cellWidth: 33 } }
	});
	y = lastY() + 8;

	// 2. Zabiegi kosmetologiczne: wszystkie pozycje formularza, kwadrat z „X” przy zabiegach z wniosku.
	y = punkt('2. Zabiegi kosmetologiczne:', y);
	const wybrane = new Set(r.wniosek?.zmiany?.zabiegi_ankieta ?? []);
	const inne = a.inne_zabiegi?.trim() ?? '';
	const zaznaczone = [...ZABIEGI_ANKIETA.map((z) => wybrane.has(z)), !!inne];
	tabela({
		startY: y,
		body: [
			[{ content: 'Prosimy o zaznaczenie zabiegów, które są wykonywane w gabinecie Ubezpieczonego:', colSpan: 2, styles: { fontStyle: 'bold', fontSize: 9, halign: 'left' } }],
			...ZABIEGI_ANKIETA.map((z, i) => [zaznaczone[i] ? 'X' : '', z]),
			[inne ? 'X' : '', { content: `Inny – prosimy opisać:${inne ? `\n${inne}` : ''}`, styles: { minCellHeight: inne ? 0 : 14, valign: 'top' } }]
		],
		columnStyles: { 0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', fontSize: 8 }, 1: { cellWidth: 172 } },
		// Kwadrat do zaznaczenia w pierwszej kolumnie (pierwszy wiersz to polecenie).
		didDrawCell: (d) => {
			if (d.section !== 'body' || d.column.index !== 0 || d.row.index === 0) return;
			const bok = 3.8;
			const x = d.cell.x + (d.cell.width - bok) / 2;
			const yk = d.row.index === zaznaczone.length ? d.cell.y + 2 : d.cell.y + (d.cell.height - bok) / 2;
			doc.setDrawColor(40);
			doc.setLineWidth(0.25);
			doc.rect(x, yk, bok, bok);
		},
		// W wierszu „Inny” kwadrat i „X” u góry komórki (pod spodem jest miejsce na opis).
		didParseCell: (d) => {
			if (d.section === 'body' && d.column.index === 0 && d.row.index === zaznaczone.length) d.cell.styles.valign = 'top';
		}
	});
	y = lastY();
	const zgody = (r.zalaczniki ?? []).filter((z) => z.typ === 'zgoda');
	tabela({
		startY: y,
		body: [
			['Prosimy o podanie jak długo w/w zabiegi są wykonywane w gabinecie', wartosc(a.jak_dlugo)],
			[
				'Czy przed wykonaniem zabiegów o których mowa w p. 2 klienci otrzymują i podpisują formularz zgody na zabieg',
				a.zgoda_klientow === 'tak' ? 'TAK' : a.zgoda_klientow === 'nie' ? 'NIE' : '—'
			],
			['Prosimy o załączenie stosowanych w gabinecie wzorów formularzy zgody na zabieg.', zgody.length ? zgody.map((z) => z.nazwa).join('\n') : 'nie dołączono']
		],
		columnStyles: { 0: { cellWidth: 100, fontStyle: 'bold' }, 1: { cellWidth: 82 } }
	});
	y = lastY() + 8;

	// 3. Osoby wykonujące zabiegi i ich dokumenty (skany dyplomu i certyfikatów są załącznikami ankiety).
	y = punkt('3. Prosimy o podanie danych osób wykonujących w/w zabiegi w gabinecie wraz z podaniem:', y);
	const wykonawcy = r.wniosek?.zmiany?.wykonawcy ?? [];
	const skany = (imie: string) => {
		const w = wykonawcy.find((x) => x.imie_nazwisko.trim() === imie.trim());
		const pliki = w ? (r.zalaczniki ?? []).filter((z) => z.osoba === w.id && (z.typ === 'dyplom' || z.typ === 'certyfikat')) : [];
		return `Skany dołączone do ankiety: ${pliki.length ? pliki.map((z) => `${opisZalacznika(z)} — ${z.nazwa}`).join('; ') : 'brak'}`;
	};
	const osoby = a.osoby?.length ? a.osoby : [{ imie_nazwisko: '', kwalifikacje: '', doswiadczenie: '' }];
	tabela({
		startY: y,
		head: [[
			'Osoba',
			'Kwalifikacje w zakresie ich wykonywania: wykształcenie, ukończone kursy i szkolenia (certyfikaty, dyplomy ze wskazaniem ' +
				'przedmiotu/czasu trwania, nazwy instytucji organizującej studia/kurs/szkolenie*)',
			'Doświadczenie (jak długo dana osoba wykonuje w/w zabiegi)'
		]],
		body: osoby.flatMap((o) => [
			[wartosc(o.imie_nazwisko), wartosc(o.kwalifikacje), wartosc(o.doswiadczenie)],
			[{ content: skany(o.imie_nazwisko), colSpan: 3, styles: { fontSize: 7.5, fontStyle: 'normal', textColor: 70, fillColor: [247, 247, 247] } }]
		]),
		headStyles: { fillColor: [238, 238, 238], textColor: 20, fontStyle: 'bold', fontSize: 8.5, valign: 'top' },
		columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' }, 1: { cellWidth: 90 }, 2: { cellWidth: 50 } }
	});
	y = lastY() + 4;
	doc.setFontSize(7.5);
	doc.setTextColor(...CZERWIEN_ERGO);
	doc.text('*scan dyplomu, certyfikatu powinien stanowić załącznik do niniejszej ankiety', L, y);
	doc.setTextColor(0);

	// Oświadczenie i podpis — razem na jednej stronie.
	doc.setFontSize(9);
	const oswiadczenie: string[] = doc.splitTextToSize(OSWIADCZENIE_ANKIETY, SZER);
	y += 9;
	if (y + 6 + oswiadczenie.length * 4.2 + 32 > DOL) {
		doc.addPage();
		y = 20;
	}
	doc.setFont(font, 'bold');
	doc.text('Oświadczenie Ubezpieczonego:', L, y);
	doc.setFont(font, 'normal');
	doc.text(oswiadczenie, L, y + 5);
	y += 5 + oswiadczenie.length * 4.2 + 24;
	doc.setDrawColor(120);
	doc.setLineWidth(0.3);
	doc.setLineDashPattern([0.6, 0.8], 0);
	doc.line(L, y, 120, y);
	doc.setLineDashPattern([], 0);
	doc.setFontSize(8);
	doc.setTextColor(110);
	doc.text('Miejscowość, data, czytelny podpis Ubezpieczonego', L, y + 4.5);
	doc.setTextColor(0);

	// Bez IP klienta: ankieta idzie do ubezpieczyciela, a IP zostaje w PDF wniosku i w dzienniku CRM.
	const stopka = `Ankieta do wniosku ${r.id} · wypełniona elektronicznie ${dataGodzina(r.zlozono_at)}`;
	const strony = doc.getNumberOfPages();
	for (let i = 1; i <= strony; i++) {
		doc.setPage(i);
		doc.setFont(font, 'normal');
		doc.setFontSize(7);
		doc.setTextColor(140);
		doc.text(`${stopka} · Strona ${i} z ${strony}`, L, 289);
		doc.setTextColor(0);
	}
	return new Uint8Array(doc.output('arraybuffer'));
}
