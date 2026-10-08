import { esc } from '$lib/server/mail';
import { newServerPdf } from '$lib/server/pdf';
import { nowyOkres, opObecnie, type RenewalRow } from '$lib/server/renewals';
import {
	APK_ODPOWIEDZI,
	APK_ODMOWA_TRESC,
	APK_PYTANIA,
	KLAUZULA_OCHRONY_PRAWNEJ,
	LICZBA_OSOB,
	OSWIADCZENIE_ANKIETY,
	RODZAJE_GABINETU,
	TYPY_ZALACZNIKOW,
	formatSuma,
	formatZl,
	type Apk,
	type Wniosek
} from '$lib/renewals/program';

// Treści e-maili i PDF wniosku o odnowienie. Wszystko, co pochodzi od klienta, przechodzi przez esc()
// (HTML) albo trafia do PDF jako zwykły tekst.

const STOPKA = 'BeautyPolisa · obsługa ubezpieczeń: Aura Expert sp. z o.o., ul. Bolkowska 2A/28, 01-466 Warszawa';
const KONTAKT = 'odnowienia@auraexpert.pl';

export const DECYZJA_TEKST = { bez_zmian: 'TAK — odnowienie bez zmian', zmiany: 'TAK — odnowienie ze zmianami', nie: 'NIE — rezygnacja z odnowienia' } as const;

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
        <p style="margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#c7d2fe;">BeautyPolisa · ERGO Hestia</p>
        <h1 style="margin:4px 0 0;font-size:20px;color:#fff;">${esc(tytul)}</h1>
      </td></tr>
      <tr><td style="padding:24px 28px;font-size:15px;line-height:1.6;color:#334155;">${tresc}</td></tr>
      <tr><td style="padding:14px 28px;border-top:1px solid #eef0f3;font-size:12px;color:#94a3b8;">${esc(STOPKA)}</td></tr>
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
	const koniec = data(r.okres_do);
	const nowy = nowyOkres(r.okres_do ?? '');
	const temat = przypomnienie
		? `Przypomnienie: odnowienie ubezpieczenia OC — certyfikat ${r.nr_polisy ?? ''} kończy się ${koniec}`
		: `Odnowienie ubezpieczenia OC gabinetu — certyfikat ${r.nr_polisy ?? ''} kończy się ${koniec}`;
	const skladka = r.skladka != null ? formatZl(Number(r.skladka)) : null;
	const html = ramka(przypomnienie ? 'Przypomnienie o odnowieniu' : 'Odnowienie ubezpieczenia OC', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    <p style="margin:0 0 14px;">${przypomnienie ? 'przypominamy, że ' : ''}ochrona OC w programie BeautyPolisa (ERGO Hestia) dla <strong>${esc(r.klient_nazwa)}</strong>
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
		`${przypomnienie ? 'przypominamy, że ' : ''}ochrona OC w programie BeautyPolisa (ERGO Hestia) dla ${r.klient_nazwa} kończy się ${koniec}.`,
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

// ---------- Opis decyzji (wspólny dla e-maili i PDF) ----------

export function opisZmian(w: Wniosek | null, apk: Apk | null): string[] {
	if (!w || w.decyzja !== 'zmiany' || !w.zmiany) return [];
	const z = w.zmiany;
	const linie: string[] = [];
	if (z.wyzsza_suma) linie.push(`Wyższa suma gwarancyjna: ${formatSuma(z.wyzsza_suma)}`);
	if (z.ochrona_prawna) linie.push(`Klauzula ochrony prawnej (+92 zł rocznie, limit 100 000 zł)`);
	if (z.adres) linie.push(`Nowy adres działalności: ${z.adres.ulica}, ${z.adres.kod} ${z.adres.miasto}`);
	if (z.nowe_zabiegi.length) linie.push(`Nowe zabiegi z list programu: ${z.nowe_zabiegi.join('; ')}`);
	if (z.zabiegi_ankieta.length) linie.push(`Zabiegi wymagające ankiety: ${z.zabiegi_ankieta.join('; ')}`);
	if (z.inne) linie.push(`Inne: ${z.inne}`);
	if (!apk && z.rodzaje.length) linie.push(`Rodzaj działalności (do wyceny): ${z.rodzaje.map(rodzajNazwa).join(', ')}`);
	if (!apk && z.osoby) linie.push(`Liczba osób (do wyceny): ${osobyNazwa(z.osoby)}`);
	return linie;
}

const rodzajNazwa = (k: string) => RODZAJE_GABINETU.find((r) => r.key === k)?.nazwa ?? k;
const osobyNazwa = (k: string) => LICZBA_OSOB.find((o) => o.key === k)?.nazwa ?? k;

export function opisSkladki(r: RenewalRow): string {
	if (r.decyzja === 'nie') return '—';
	if (r.skladka_nowa != null) return formatZl(Number(r.skladka_nowa)) + (r.decyzja === 'zmiany' ? ' (orientacyjnie wg programu, potwierdzi doradca)' : '');
	return 'do indywidualnej wyceny przez doradcę';
}

export function odpowiedziApk(apk: Apk): [string, string][] {
	const tak = (v: string) => (v === 'tak' ? 'tak' : 'nie');
	return [
		[APK_PYTANIA.rodzaje, apk.rodzaje.map(rodzajNazwa).join(', ')],
		[APK_PYTANIA.osoby, osobyNazwa(apk.osoby)],
		[APK_PYTANIA.szkody, apk.szkody === 'tak' ? `tak — ${apk.szkody_opis}` : 'nie'],
		[APK_PYTANIA.spoza_listy, apk.spoza_listy === 'tak' ? `tak — ${apk.spoza_listy_opis}` : 'nie'],
		[APK_PYTANIA.suma_oczekiwana, APK_ODPOWIEDZI.suma_oczekiwana[apk.suma_oczekiwana]],
		[APK_PYTANIA.ochrona_prawna, APK_ODPOWIEDZI.ochrona_prawna[apk.ochrona_prawna]],
		[APK_PYTANIA.szkolenia, tak(apk.szkolenia)],
		[APK_PYTANIA.inne_ubezpieczenia, apk.inne_ubezpieczenia.map((k) => APK_ODPOWIEDZI.inne_ubezpieczenia[k]).join(', ')],
		[APK_PYTANIA.priorytet, APK_ODPOWIEDZI.priorytet[apk.priorytet]],
		...(apk.uwagi ? ([[APK_PYTANIA.uwagi, apk.uwagi]] as [string, string][]) : [])
	];
}

// ---------- Potwierdzenie dla klienta i powiadomienie biura ----------

export function mailPotwierdzenie(r: RenewalRow) {
	const nowy = nowyOkres(r.okres_do ?? '');
	const ankieta = !!r.ankieta;
	const akapity: string[] = [];
	if (r.decyzja === 'bez_zmian') {
		akapity.push(`przyjęliśmy wniosek o odnowienie ubezpieczenia OC bez zmian dla ${r.klient_nazwa}. Przygotujemy odnowienie certyfikatu na okres ${data(nowy.od)}–${data(nowy.do)}.`);
	} else if (r.decyzja === 'zmiany') {
		akapity.push(`przyjęliśmy wniosek o odnowienie ubezpieczenia OC ze zmianami dla ${r.klient_nazwa}. Doradca sprawdzi zmiany i potwierdzi zakres oraz składkę przed wystawieniem certyfikatu na okres ${data(nowy.od)}–${data(nowy.do)}.`);
		if (ankieta) {
			akapity.push(`Zabiegi, które wskazano, wymagają ankiety ERGO Hestii. Wydrukuj załączony PDF, podpisz ankietę i odeślij jej skan na ${KONTAKT} (wystarczy odpowiedzieć na tę wiadomość). Bez podpisanej ankiety ubezpieczyciel nie obejmie tych zabiegów ochroną.`);
		}
	} else {
		akapity.push(`przyjęliśmy informację o rezygnacji z odnowienia ubezpieczenia OC dla ${r.klient_nazwa}. Ochrona kończy się ${data(r.okres_do)} — od tego dnia gabinet nie ma ubezpieczenia OC w programie.`);
		akapity.push('Jeśli zmienisz zdanie, odpowiedz na tę wiadomość — przygotujemy odnowienie.');
	}
	akapity.push('W załączniku przesyłamy PDF z treścią wniosku.');
	const temat =
		r.decyzja === 'nie'
			? `Rezygnacja z odnowienia ubezpieczenia OC — certyfikat ${r.nr_polisy ?? ''}`
			: `Wniosek o odnowienie ubezpieczenia OC przyjęty — certyfikat ${r.nr_polisy ?? ''}${ankieta ? ' (ankieta do podpisu)' : ''}`;
	const html = ramka(r.decyzja === 'nie' ? 'Rezygnacja przyjęta' : 'Wniosek przyjęty', `
    <p style="margin:0 0 14px;">Dzień dobry,</p>
    ${akapity.map((a) => `<p style="margin:0 0 14px;">${esc(a)}</p>`).join('\n    ')}
    ${ankieta ? `<p style="margin:0 0 14px;padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;"><strong>Do zrobienia:</strong> wydrukuj, podpisz i odeślij ankietę (strona „Ankieta ERGO Hestia” w załączonym PDF).</p>` : ''}`);
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
	if (a.suma_oczekiwana === 'wiecej') s.push('APK: oczekiwana suma gwarancyjna wyższa niż 300 tys. zł');
	return s;
}

export function mailBiuro(r: RenewalRow, linkCrm: string, kto: { ip: string | null }, pominiete: string[] = []) {
	const zmiany = [...opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk), ...sygnalyApk(r)];
	const temat = `[Odnowienie] ${DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? r.decyzja} — ${r.klient_nazwa} — cert. ${r.nr_polisy ?? '—'}${r.ankieta ? ' — ANKIETA' : ''}`;
	const wiersze: [string, string][] = [
		['Klient', r.klient_nazwa ?? '—'],
		['Certyfikat', `${r.nr_polisy ?? '—'} (${data(r.okres_od)}–${data(r.okres_do)})`],
		['Decyzja', DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? '—'],
		['Składka', opisSkladki(r)],
		['APK', r.apk_odmowa ? 'klient odmówił wypełnienia APK' : 'wypełniona'],
		['Ochrona prawna w obecnym certyfikacie', opObecnie(r) ? 'tak (zostaje)' : 'nie'],
		['Złożono', `${dataGodzina(r.zlozono_at)}${kto.ip ? `, IP ${kto.ip}` : ''}`],
		...(r.wniosek?.nie_powod ? ([['Powód rezygnacji', r.wniosek.nie_powod]] as [string, string][]) : []),
		...(r.zalaczniki?.length ? ([['Załączniki', r.zalaczniki.map((z) => `${TYPY_ZALACZNIKOW[z.typ] ?? z.typ}: ${z.nazwa}`).join('; ')]] as [string, string][]) : []),
		...(pominiete.length ? ([['Pliki niedołączone do e-maila', pominiete.join('; ')]] as [string, string][]) : [])
	];
	const html = ramka('Wniosek o odnowienie', `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:14px;">
      ${wiersze.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;font-weight:600;color:#475569;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;">${esc(v)}</td></tr>`).join('\n      ')}
    </table>
    ${zmiany.length ? `<p style="margin:0 0 6px;font-weight:600;">Zmiany i uwagi:</p><ul style="margin:0 0 14px;padding-left:20px;">${zmiany.map((z) => `<li>${esc(z)}</li>`).join('')}</ul>` : ''}
    ${r.ankieta ? '<p style="margin:0 0 14px;color:#be123c;font-weight:600;">Klient wypełnił ankietę ERGO Hestii — czekamy na podpisany egzemplarz.</p>' : ''}
    ${przycisk(linkCrm, 'Otwórz polisę w CRM')}`);
	const tekst = [...wiersze.map(([k, v]) => `${k}: ${v}`), ...(zmiany.length ? ['', 'Zmiany i uwagi:', ...zmiany.map((z) => `- ${z}`)] : []), '', linkCrm].join('\n');
	return { temat, html, tekst };
}

// ---------- PDF wniosku ----------

type PdfEvent = Parameters<typeof newServerPdf>[0];

export async function pdfWniosku(event: PdfEvent, r: RenewalRow, kto: { ip: string | null; ua: string | null }): Promise<Uint8Array> {
	const { doc, autoTable, font } = await newServerPdf(event);
	const nowy = nowyOkres(r.okres_do ?? '');
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

	doc.setFont(font, 'bold');
	doc.setFontSize(16);
	doc.text('Wniosek o odnowienie ubezpieczenia OC', 14, 18);
	doc.setFont(font, 'normal');
	doc.setFontSize(9);
	doc.setTextColor(100);
	doc.text(`${r.program ?? ''} · ERGO Hestia · BeautyPolisa`, 14, 24);
	doc.setTextColor(0);

	tabela(
		[
			['Ubezpieczający / Ubezpieczony', r.klient_nazwa ?? '—'],
			['Certyfikat', r.nr_polisy ?? '—'],
			['Ubezpieczyciel', r.tu_nazwa ?? 'STU ERGO Hestia S.A.'],
			['Obecny okres ubezpieczenia', `${data(r.okres_od)} – ${data(r.okres_do)}`],
			['Okres po odnowieniu', r.decyzja === 'nie' ? '—' : `${data(nowy.od)} – ${data(nowy.do)}`],
			['Suma gwarancyjna (obecna)', r.suma ? formatSuma(Number(r.suma)) : 'zgodnie z obecnym certyfikatem'],
			['Składka (obecna)', r.skladka != null ? formatZl(Number(r.skladka)) : '—'],
			['Składka po odnowieniu', opisSkladki(r)],
			['Decyzja', DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? '—'],
			['Złożono', `${dataGodzina(r.zlozono_at)} (wniosek elektroniczny)`]
		],
		30
	);

	let y = lastY() + 8;
	const zmiany = opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk);
	if (zmiany.length) {
		y = naglowek('Zmiany wskazane przez klienta', y);
		tabela(zmiany.map((z, i) => [`${i + 1}.`, z] as [string, string]), y);
		y = lastY() + 8;
		if (r.wniosek?.zmiany?.ochrona_prawna) {
			y = naglowek('Treść klauzuli ochrony prawnej', y);
			tabela([['Klauzula 7', KLAUZULA_OCHRONY_PRAWNEJ]], y);
			y = lastY() + 8;
		}
	}
	if (r.decyzja === 'nie') {
		y = naglowek('Rezygnacja z odnowienia', y);
		tabela(
			[
				['Oświadczenie', `Klient potwierdził rezygnację z odnowienia. Ochrona kończy się ${data(r.okres_do)}.`],
				...(r.wniosek?.nie_powod ? ([['Powód', r.wniosek.nie_powod]] as [string, string][]) : [])
			],
			y
		);
		y = lastY() + 8;
	}

	y = naglowek('Analiza potrzeb klienta (APK)', y);
	if (r.apk_odmowa || !r.apk) {
		tabela([['Odmowa wypełnienia APK', `${APK_ODMOWA_TRESC} (${dataGodzina(r.apk_at)})`]], y);
	} else {
		tabela(odpowiedziApk(r.apk), y, ['Pytanie', 'Odpowiedź']);
	}
	y = lastY() + 8;

	if (r.zalaczniki?.length) {
		y = naglowek('Załączniki przesłane przez klienta', y);
		tabela(r.zalaczniki.map((z) => [TYPY_ZALACZNIKOW[z.typ] ?? z.typ, z.nazwa] as [string, string]), y);
		y = lastY() + 8;
	}

	if (r.ankieta) {
		const a = r.ankieta;
		doc.addPage();
		y = naglowek('Ankieta ERGO Hestia — zabiegi wymagające oceny ryzyka', 18);
		doc.setFontSize(8);
		doc.setTextColor(100);
		doc.text(`Ankieta ubezpieczeniowa do ${r.program ?? 'Programu Ubezpieczenia OC'}`, 14, y + 2);
		doc.setTextColor(0);
		tabela(
			[
				['Ubezpieczający', a.ubezpieczajacy],
				['Ubezpieczony', a.ubezpieczony],
				['Data rozpoczęcia działalności', data(a.data_rozpoczecia)],
				['Liczba zatrudnionych osób', a.liczba_zatrudnionych],
				['Szkodowość OC z ostatnich 3 lat', a.szkodowosc],
				['Zabiegi wykonywane w gabinecie', (r.wniosek?.zmiany?.zabiegi_ankieta ?? []).join('; ')],
				['Od kiedy zabiegi są wykonywane', a.jak_dlugo],
				['Czy klienci podpisują formularz zgody', a.zgoda_klientow]
			],
			y + 5
		);
		y = lastY() + 6;
		autoTable(doc, {
			startY: y,
			head: [['Osoba wykonująca zabiegi', 'Kwalifikacje (wykształcenie, kursy, szkolenia)', 'Doświadczenie']],
			body: a.osoby.map((o) => [o.imie_nazwisko, o.kwalifikacje, o.doswiadczenie]),
			theme: 'grid',
			styles: { font, fontSize: 8.5, cellPadding: 2.5, overflow: 'linebreak' },
			headStyles: { fillColor: [42, 59, 105], textColor: 255, fontStyle: 'bold' },
			margin: { left: 14, right: 14 }
		});
		y = lastY() + 8;
		if (y > 240) {
			doc.addPage();
			y = 20;
		}
		doc.setFontSize(9);
		const oswiadczenie = doc.splitTextToSize(`Oświadczenie Ubezpieczonego: ${OSWIADCZENIE_ANKIETY}`, 182);
		doc.text(oswiadczenie, 14, y);
		y += oswiadczenie.length * 4.5 + 18;
		doc.setDrawColor(120);
		doc.setLineDashPattern([0.6, 0.8], 0);
		doc.line(14, y, 196, y);
		doc.setLineDashPattern([], 0);
		doc.setFontSize(8);
		doc.text('Miejscowość, data, czytelny podpis Ubezpieczonego', 14, y + 5);
		doc.setTextColor(190, 18, 60);
		doc.text(`Wydrukuj, podpisz i odeślij skan na ${KONTAKT}.`, 14, y + 11);
		doc.setTextColor(0);
	}

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
