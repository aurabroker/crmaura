<script lang="ts">
	// Raporty — gotowe zestawienia liczone na żywo z danych firmy. Przed eksportem raport sprawdza dane
	// i mówi, czego brakuje. Eksport: CSV (Excel, polskie znaki) albo XLSX.
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { appState, isAdmin, isBroker } from '$lib/stores/app.svelte';
	import { dateDiffDays, fmtDzien, odmiana, todayStr } from '$lib/utils';
	import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import { nazwaRodzaju, nazwaTu, odnowionePolisy } from '$lib/statusPolisy';
	import { logAudit } from '$lib/utils/audit';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import {
		KUBELKI_ZALEGLOSCI, PRESETY, dzien, grupuj, liczba, liczonaPolisa, okresZPresetu, pobierzCsv, pobierzXlsx, proc, sumuj, wOkresie, zl,
		type PresetOkresu
	} from '$lib/analityka';
	import { CheckCircle2, AlertTriangle, Download, FileSpreadsheet, ExternalLink, Inbox } from 'lucide-svelte';

	const dzis = todayStr();
	type Id = 'knf' | 'apk' | 'nal' | 'prow' | 'odn' | 'rodz';
	type Kontrola = { ok: boolean; tekst: string; szczegol?: string; akcja?: { tekst: string; href: string } };
	type Suma = { etykieta: string; wartosc: string; notka?: string; uwaga?: boolean };
	type Kol = { t: string; prawa?: boolean; mono?: boolean };
	type Raport = {
		nazwa: string; opis: string; okres?: boolean; horyzont?: boolean;
		kontrole: Kontrola[]; sumy: Suma[];
		kolumny?: Kol[]; wiersze?: string[][]; razem?: string[];
		eksport?: { naglowek: string[]; wiersze: (string | number | null)[][] };
		pusty?: { tytul: string; tekst: string; akcja?: { tekst: string; href: string } };
		link?: { tekst: string; href: string };
	};
	const SZABLONY = $derived<{ grupa: string; pozycje: { id: Id; nazwa: string; krotko: string; widoczny: boolean }[] }[]>([
		{ grupa: 'Obowiązkowe', pozycje: [
			{ id: 'knf', nazwa: 'Sprawozdanie roczne dla KNF', krotko: 'Przypis, wynagrodzenie i liczba umów według grup', widoczny: isAdmin(appState.profile) && isBroker() },
			{ id: 'apk', nazwa: 'Rejestr analiz potrzeb (APK)', krotko: 'Formularze APK w okresie i ich status', widoczny: true }
		] },
		{ grupa: 'Finanse', pozycje: [
			{ id: 'nal', nazwa: 'Należności i zaległości', krotko: 'Raty po terminie według towarzystw i wieku', widoczny: true },
			{ id: 'prow', nazwa: 'Prowizje według towarzystw', krotko: 'Przypis, prowizja i stawka efektywna', widoczny: true }
		] },
		{ grupa: 'Portfel', pozycje: [
			{ id: 'odn', nazwa: 'Odnowienia', krotko: 'Polisy kończące się w najbliższych dniach', widoczny: true },
			{ id: 'rodz', nazwa: 'Portfel według rodzaju', krotko: 'Polisy, przypis i prowizja według rodzaju', widoczny: true }
		] }
	]);
	const widoczneSzablony = $derived(SZABLONY.map((g) => ({ ...g, pozycje: g.pozycje.filter((p) => p.widoczny) })).filter((g) => g.pozycje.length));
	const wszystkieId = $derived(widoczneSzablony.flatMap((g) => g.pozycje.map((p) => p.id)));

	const wybrany = $derived<Id>(((r) => (r && wszystkieId.includes(r as Id) ? (r as Id) : wszystkieId.includes('nal') ? 'nal' : wszystkieId[0]))($page.url.searchParams.get('r')));
	function wybierz(id: Id) { goto(`/raporty?r=${id}`, { replaceState: true, noScroll: true, keepFocus: true }); }

	let preset = $state<PresetOkresu>('rok');
	let horyzont = $state(60);
	const polisyLiczone = $derived(appState.policies.filter(liczonaPolisa));
	const najstarsza = $derived(polisyLiczone.reduce<string | null>((m, p) => (p.data_od && (!m || p.data_od < m) ? p.data_od : m), null));
	const okres = $derived(okresZPresetu(preset, dzis, najstarsza));
	const wOkr = $derived(polisyLiczone.filter((p) => wOkresie(p.data_od, okres)));
	const nazwaTuWg = $derived(new Map(appState.insurers.map((i) => [i.id, i.skrot || i.nazwa])));
	const polisaWg = $derived(new Map(appState.policies.map((p) => [p.id, p])));
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	const kwota = (n: number) => Math.round(n * 100) / 100;

	function raportNaleznosci(): Raport {
		const zalegle = appState.payments.filter((r) => !ugBez.has(r.polisa_id) && !ROZLICZONE.includes(r.status) && poTerminie(r, dzis, ugBez));
		const wg = new Map<string, { k: number[]; n: number }>();
		const kub = [0, 0, 0];
		const kubN = [0, 0, 0];
		for (const r of zalegle) {
			const tu = polisaWg.get(r.polisa_id)?.tu_id ?? '';
			const dni = Math.max(1, dateDiffDays(r.data_platnosci, dzis));
			const i = KUBELKI_ZALEGLOSCI.findIndex(([, od, doo]) => dni >= od && dni <= doo);
			const w = wg.get(tu) ?? { k: [0, 0, 0], n: 0 };
			w.k[i] += Number(r.kwota ?? 0); w.n++;
			wg.set(tu, w);
			kub[i] += Number(r.kwota ?? 0); kubN[i]++;
		}
		const razem = kub.reduce((a, b) => a + b, 0);
		const wiersze = [...wg].map(([tu, w]) => ({ nazwa: nazwaTuWg.get(tu) ?? '—', ...w, suma: w.k.reduce((a, b) => a + b, 0) })).sort((a, b) => b.suma - a.suma);
		const wszystkie = appState.payments.length;
		const oplacone = appState.payments.filter((r) => ROZLICZONE.includes(r.status)).length;
		const bezPolisy = appState.payments.filter((r) => !polisaWg.has(r.polisa_id)).length;
		const kontrole: Kontrola[] = [];
		if (wszystkie >= 10 && oplacone / wszystkie < 0.1) kontrole.push({ ok: false, tekst: `Tylko ${oplacone} z ${wszystkie} rat oznaczono jako opłacone`, szczegol: 'najpewniej wpłaty nie są odnotowywane — raport zawyża zaległości', akcja: { tekst: 'Płatności', href: '/payments' } });
		if (kubN[2] > 0) kontrole.push({ ok: kub[2] / Math.max(1, razem) < 0.5, tekst: `${odmiana(kubN[2], 'rata jest', 'raty są', 'rat jest')} po terminie ponad 90 dni`, szczegol: 'tak długie zaległości zwykle oznaczają brak księgowania wpłaty, a nie dług klienta', akcja: { tekst: 'Pokaż raty', href: '/payments?filtr=po-terminie' } });
		kontrole.push(bezPolisy ? { ok: false, tekst: `${odmiana(bezPolisy, 'rata nie jest powiązana', 'raty nie są powiązane', 'rat nie jest powiązanych')} z polisą` } : { ok: true, tekst: 'Każda rata jest powiązana z polisą', szczegol: `${liczba(wszystkie)} z ${liczba(wszystkie)}` });
		const fmtK = (v: number) => (v ? zl(v) : '—');
		return {
			nazwa: 'Należności i zaległości',
			opis: `Raty nieopłacone po terminie płatności na dzień ${dzien(dzis)}, według towarzystwa i liczby dni po terminie. Status liczony z daty, jak w Płatnościach; umowy generalne rozliczane bez rat pominięte.`,
			kontrole,
			sumy: [
				{ etykieta: 'Po terminie razem', wartosc: zl(razem), notka: odmiana(zalegle.length, 'rata', 'raty', 'rat') },
				...KUBELKI_ZALEGLOSCI.map(([l], i) => ({ etykieta: l, wartosc: zl(kub[i]), notka: `${odmiana(kubN[i], 'rata', 'raty', 'rat')}${i === 2 && razem ? ` · ${proc((kub[2] / razem) * 100, 0)}` : ''}`, uwaga: i === 2 && razem > 0 && kub[2] / razem >= 0.5 }))
			],
			kolumny: [{ t: 'Towarzystwo' }, ...KUBELKI_ZALEGLOSCI.map(([l]) => ({ t: l, prawa: true })), { t: 'Razem', prawa: true }, { t: 'Raty', prawa: true }],
			wiersze: wiersze.map((w) => [w.nazwa, ...w.k.map(fmtK), zl(w.suma), liczba(w.n)]),
			razem: ['Razem', ...kub.map(fmtK), zl(razem), liczba(zalegle.length)],
			eksport: {
				naglowek: ['Towarzystwo', ...KUBELKI_ZALEGLOSCI.map(([l]) => l), 'Razem', 'Liczba rat'],
				wiersze: [...wiersze.map((w) => [w.nazwa, ...w.k.map(kwota), kwota(w.suma), w.n]), ['Razem', ...kub.map(kwota), kwota(razem), zalegle.length]]
			},
			pusty: zalegle.length ? undefined : { tytul: 'Brak rat po terminie', tekst: 'Na dziś żadna rata nie jest po terminie płatności.' }
		};
	}

	function raportProwizji(): Raport {
		const g = [...grupuj(wOkr, (p) => p.tu_id)].map(([tu, s]) => ({ nazwa: nazwaTuWg.get(tu) ?? '—', ...s })).sort((a, b) => b.przypis - a.przypis);
		const s = sumuj(wOkr);
		const zeroweStawki = wOkr.filter((p) => !Number(p.prowizja_pct) && Number(p.skladka_przypisana) > 0).length;
		const ugZero = appState.policies.filter((p) => p.typ_umowy === 'generalna' && !Number(p.skladka_przypisana)).length;
		const najw = [...g].filter((x) => x.przypis > 0).sort((a, b) => b.prowizja / b.przypis - a.prowizja / a.przypis)[0];
		const kontrole: Kontrola[] = [
			zeroweStawki ? { ok: false, tekst: `${odmiana(zeroweStawki, 'polisa ma', 'polisy mają', 'polis ma')} stawkę prowizji 0%`, szczegol: 'prowizja przypisana tych polis jest zerowa — sprawdź stawki', akcja: { tekst: 'Polisy', href: '/policies' } } : { ok: true, tekst: 'Każda polisa ze składką ma stawkę prowizji' },
			{ ok: true, tekst: 'Każda polisa ma towarzystwo', szczegol: `${liczba(wOkr.length)} z ${liczba(wOkr.length)}` }
		];
		if (ugZero) kontrole.push({ ok: true, tekst: `${odmiana(ugZero, 'umowa generalna ma', 'umowy generalne mają', 'umów generalnych ma')} przypis 0 zł`, szczegol: 'to normalne — przypis jest na polisach podpiętych pod umowę i to one są w zestawieniu' });
		return {
			nazwa: 'Prowizje według towarzystw',
			opis: `Prowizja przypisana z polis z początkiem ochrony w okresie (${okres.etykieta.split(' · ')[1]}), według towarzystw — do uzgodnienia z notami prowizyjnymi.`,
			okres: true,
			kontrole,
			sumy: [
				{ etykieta: 'Przypis składki', wartosc: zl(s.przypis), notka: odmiana(s.polisy, 'polisa', 'polisy', 'polis') },
				{ etykieta: 'Prowizja przypisana', wartosc: zl(s.prowizja), notka: `stawka efektywna ${proc(s.przypis ? (s.prowizja / s.przypis) * 100 : 0)}` },
				...(najw ? [{ etykieta: 'Najwyższa stawka', wartosc: proc((najw.prowizja / najw.przypis) * 100), notka: najw.nazwa }] : [])
			],
			kolumny: [{ t: 'Towarzystwo' }, { t: 'Polisy', prawa: true }, { t: 'Przypis', prawa: true }, { t: 'Prowizja', prawa: true }, { t: 'Stawka', prawa: true }],
			wiersze: g.map((x) => [x.nazwa, liczba(x.polisy), zl(x.przypis), zl(x.prowizja), proc(x.przypis ? (x.prowizja / x.przypis) * 100 : 0)]),
			razem: ['Razem', liczba(s.polisy), zl(s.przypis), zl(s.prowizja), proc(s.przypis ? (s.prowizja / s.przypis) * 100 : 0)],
			eksport: {
				naglowek: ['Towarzystwo', 'Polisy', 'Przypis', 'Prowizja', 'Stawka %'],
				wiersze: [...g.map((x) => [x.nazwa, x.polisy, kwota(x.przypis), kwota(x.prowizja), x.przypis ? kwota((x.prowizja / x.przypis) * 100) : 0]), ['Razem', s.polisy, kwota(s.przypis), kwota(s.prowizja), s.przypis ? kwota((s.prowizja / s.przypis) * 100) : 0]]
			},
			pusty: wOkr.length ? undefined : { tytul: 'Brak polis w okresie', tekst: 'Wybierz dłuższy okres.' }
		};
	}

	function raportOdnowien(): Raport {
		const odnowione = odnowionePolisy(appState.policies);
		const zadaniaPolis = new Set(appState.tasks.filter((t) => t.polisa_id && (t.status === 'otwarte' || t.status === 'w_toku')).map((t) => t.polisa_id as string));
		const lista = polisyLiczone
			.filter((p) => p.data_do && p.data_do >= dzis && dateDiffDays(dzis, p.data_do) <= horyzont && !odnowione.has(p.id))
			.sort((a, b) => a.data_do.localeCompare(b.data_do));
		const bezZadania = lista.filter((p) => !zadaniaPolis.has(p.id)).length;
		const skladka = lista.reduce((a, p) => a + Number(p.skladka_przypisana ?? 0), 0);
		const tydzien = lista.filter((p) => dateDiffDays(dzis, p.data_do) <= 7).length;
		return {
			nazwa: 'Odnowienia',
			opis: `Polisy kończące się w ciągu ${horyzont} dni, które nie mają jeszcze polisy następczej. Zadanie = otwarte zadanie powiązane z polisą.`,
			horyzont: true,
			kontrole: [
				bezZadania ? { ok: false, tekst: `${odmiana(bezZadania, 'polisa nie ma', 'polisy nie mają', 'polis nie ma')} zadania odnowienia`, szczegol: 'bez zadania nikt nie dostanie przypomnienia', akcja: { tekst: 'Odnowienia', href: '/renewals' } } : { ok: true, tekst: 'Każda polisa ma otwarte zadanie' },
				tydzien ? { ok: false, tekst: `${odmiana(tydzien, 'polisa kończy', 'polisy kończą', 'polis kończy')} się w ciągu 7 dni` } : { ok: true, tekst: 'Żadna polisa nie kończy się w ciągu 7 dni' }
			],
			sumy: [
				{ etykieta: 'Polisy do odnowienia', wartosc: liczba(lista.length), notka: `w ${horyzont} dni` },
				{ etykieta: 'Składka', wartosc: zl(skladka), notka: 'do utrzymania' },
				{ etykieta: 'Bez zadania', wartosc: liczba(bezZadania), notka: lista.length ? proc((bezZadania / lista.length) * 100, 0) : '', uwaga: bezZadania > 0 }
			],
			kolumny: [{ t: 'Koniec ochrony' }, { t: 'Klient' }, { t: 'Polisa', mono: true }, { t: 'Towarzystwo' }, { t: 'Składka', prawa: true }, { t: 'Zadanie' }],
			wiersze: lista.map((p) => [`${fmtDzien(p.data_do, true)} · za ${dateDiffDays(dzis, p.data_do)} dni`, p.crm_clients?.nazwa ?? '—', p.nr_polisy, nazwaTu(p), zl(Number(p.skladka_przypisana ?? 0)), zadaniaPolis.has(p.id) ? 'jest' : 'brak']),
			eksport: {
				naglowek: ['Koniec ochrony', 'Dni do końca', 'Klient', 'Nr polisy', 'Towarzystwo', 'Rodzaj', 'Składka', 'Zadanie'],
				wiersze: lista.map((p) => [p.data_do, dateDiffDays(dzis, p.data_do), p.crm_clients?.nazwa ?? '', p.nr_polisy, nazwaTu(p), nazwaRodzaju(p.rodzaj), kwota(Number(p.skladka_przypisana ?? 0)), zadaniaPolis.has(p.id) ? 'tak' : 'nie'])
			},
			pusty: lista.length ? undefined : { tytul: 'Brak polis do odnowienia', tekst: `W ciągu ${horyzont} dni nie kończy się żadna polisa bez następczyni.` }
		};
	}

	function raportRodzajow(): Raport {
		const s = sumuj(wOkr);
		const g = [...grupuj(wOkr, (p) => p.rodzaj)].map(([r, x]) => ({ r, ...x })).sort((a, b) => b.przypis - a.przypis);
		return {
			nazwa: 'Portfel według rodzaju',
			opis: `Polisy z początkiem ochrony w okresie (${okres.etykieta.split(' · ')[1]}) według rodzaju ubezpieczenia — liczba, przypis, prowizja i udział w przypisie.`,
			okres: true,
			kontrole: [{ ok: true, tekst: 'Każda polisa ma rodzaj', szczegol: `${liczba(wOkr.length)} z ${liczba(wOkr.length)}` }],
			sumy: [
				{ etykieta: 'Polisy', wartosc: liczba(s.polisy), notka: odmiana(g.length, 'rodzaj', 'rodzaje', 'rodzajów') },
				{ etykieta: 'Przypis składki', wartosc: zl(s.przypis) },
				{ etykieta: 'Prowizja przypisana', wartosc: zl(s.prowizja) }
			],
			kolumny: [{ t: 'Rodzaj' }, { t: 'Polisy', prawa: true }, { t: 'Klienci', prawa: true }, { t: 'Przypis', prawa: true }, { t: 'Prowizja', prawa: true }, { t: 'Udział w przypisie', prawa: true }],
			wiersze: g.map((x) => [nazwaRodzaju(x.r), liczba(x.polisy), liczba(x.klienci.size), zl(x.przypis), zl(x.prowizja), proc(s.przypis ? (x.przypis / s.przypis) * 100 : 0)]),
			razem: ['Razem', liczba(s.polisy), liczba(new Set(wOkr.map((p) => p.klient_id)).size), zl(s.przypis), zl(s.prowizja), '100%'],
			eksport: {
				naglowek: ['Rodzaj', 'Polisy', 'Klienci', 'Przypis', 'Prowizja', 'Udział w przypisie %'],
				wiersze: g.map((x) => [nazwaRodzaju(x.r), x.polisy, x.klienci.size, kwota(x.przypis), kwota(x.prowizja), s.przypis ? kwota((x.przypis / s.przypis) * 100) : 0])
			},
			pusty: wOkr.length ? undefined : { tytul: 'Brak polis w okresie', tekst: 'Wybierz dłuższy okres.' }
		};
	}

	function raportApk(): Raport {
		const formy = appState.apkForms.filter((f) => wOkresie((f.form_date || f.created_at || '').slice(0, 10), okres));
		const zlozone = formy.filter((f) => f.status === 'submitted' && !f.client_declined).length;
		const odmowy = formy.filter((f) => f.client_declined).length;
		const nowePolisy = wOkr.length;
		const klientWg = new Map(appState.clients.map((c) => [c.id, c.nazwa_skrocona ?? c.nazwa]));
		const status = (f: (typeof formy)[number]) => (f.client_declined ? 'odmowa klienta' : f.status === 'submitted' ? 'złożony' : 'wersja robocza');
		return {
			nazwa: 'Rejestr analiz potrzeb (APK)',
			opis: `Formularze analizy potrzeb klienta utworzone w okresie (${okres.etykieta.split(' · ')[1]}) — do kontroli i na żądanie klienta lub nadzoru.`,
			okres: true,
			kontrole: [
				nowePolisy > 0 && formy.length < nowePolisy / 2
					? { ok: false, tekst: `${odmiana(formy.length, 'formularz APK', 'formularze APK', 'formularzy APK')} przy ${odmiana(nowePolisy, 'nowej polisie', 'nowych polisach', 'nowych polisach')}`, szczegol: 'analiza potrzeb przed zawarciem umowy może nie być dokumentowana w systemie', akcja: { tekst: 'APK', href: '/apk' } }
					: { ok: true, tekst: 'Liczba formularzy APK odpowiada liczbie nowych polis' },
				{ ok: !formy.some((f) => !f.klient_id), tekst: formy.some((f) => !f.klient_id) ? 'Część formularzy nie jest powiązana z klientem' : 'Każdy formularz jest powiązany z klientem' }
			],
			sumy: [
				{ etykieta: 'Formularze', wartosc: liczba(formy.length), notka: `nowe polisy: ${liczba(nowePolisy)}` },
				{ etykieta: 'Złożone przez klienta', wartosc: liczba(zlozone) },
				{ etykieta: 'Odmowy', wartosc: liczba(odmowy) }
			],
			kolumny: [{ t: 'Data' }, { t: 'Numer', mono: true }, { t: 'Klient' }, { t: 'Doradca' }, { t: 'Status' }],
			wiersze: formy.map((f) => [fmtDzien((f.form_date || f.created_at).slice(0, 10), true), f.ref_number, (f.klient_id && klientWg.get(f.klient_id)) || f.client_name || '—', f.advisor_name ?? '—', status(f)]),
			eksport: {
				naglowek: ['Data', 'Numer', 'Klient', 'Doradca', 'Status', 'Data złożenia'],
				wiersze: formy.map((f) => [(f.form_date || f.created_at).slice(0, 10), f.ref_number, (f.klient_id && klientWg.get(f.klient_id)) || f.client_name || '', f.advisor_name ?? '', status(f), f.submitted_at?.slice(0, 10) ?? ''])
			},
			pusty: formy.length ? undefined : { tytul: 'Rejestr jest pusty', tekst: 'W okresie nie utworzono żadnego formularza APK. Formularz wyślesz z Panelu 360° klienta („Wyślij APK”).', akcja: { tekst: 'Klienci', href: '/clients' } }
		};
	}

	function raportKnf(): Raport {
		const rok = Number(dzis.slice(0, 4)) - 1;
		return {
			nazwa: 'Sprawozdanie roczne dla KNF',
			opis: `Dane do rocznego sprawozdania brokera (za ${rok} składane do 31 marca ${rok + 1}): liczba umów, przypis i wynagrodzenie według grup ubezpieczeń. Zestawienie z mapowaniem rodzajów na grupy KNF jest na osobnym ekranie.`,
			kontrole: [],
			sumy: [],
			link: { tekst: 'Otwórz sprawozdanie KNF', href: '/knf-report' }
		};
	}

	const raport = $derived.by((): Raport => {
		switch (wybrany) {
			case 'nal': return raportNaleznosci();
			case 'prow': return raportProwizji();
			case 'odn': return raportOdnowien();
			case 'rodz': return raportRodzajow();
			case 'apk': return raportApk();
			default: return raportKnf();
		}
	});
	const uwagi = $derived(raport.kontrole.filter((k) => !k.ok).length);
	const LIMIT = 50;

	async function eksportuj(format: 'csv' | 'xlsx') {
		if (!raport.eksport) return;
		const plik = `${raport.nazwa.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, '-').replace(/^-|-$/g, '')}-${dzis}`;
		if (format === 'csv') pobierzCsv(`${plik}.csv`, raport.eksport.naglowek, raport.eksport.wiersze);
		else await pobierzXlsx(`${plik}.xlsx`, raport.nazwa, raport.eksport.naglowek, raport.eksport.wiersze);
		void logAudit('report_exported', 'report', wybrany, raport.nazwa, { format, wiersze: raport.eksport.wiersze.length });
		ctxToast(`Pobrano: ${raport.nazwa} (${format.toUpperCase()})`);
	}
</script>

<svelte:head><title>Raporty — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Raporty</h1>
		<p class="text-sm text-ink-3 mt-0.5">Gotowe zestawienia · przed eksportem raport sprawdza dane i mówi, czego brakuje</p>
	</div>
</div>

<div class="flex flex-col lg:flex-row gap-4 items-start">
	<nav aria-label="Szablony raportów" class="w-full lg:w-[300px] shrink-0 flex flex-col gap-4">
		{#each widoczneSzablony as g}
			<div class="flex flex-col gap-1.5">
				<span class="px-1 text-xs font-semibold text-ink-3">{g.grupa}</span>
				{#each g.pozycje as r}
					<button
						aria-pressed={wybrany === r.id}
						onclick={() => wybierz(r.id)}
						class="text-left px-3 py-2.5 rounded-xl border transition-colors {wybrany === r.id ? 'bg-white border-accent shadow-sm' : 'bg-white/60 border-line hover:bg-white'}"
					>
						<span class="block text-sm font-semibold text-ink">{r.nazwa}</span>
						<span class="block text-xs text-ink-3">{r.krotko}</span>
					</button>
				{/each}
			</div>
		{/each}
	</nav>

	<section aria-labelledby="rap-tytul" class="flex-1 min-w-0 w-full bg-white border border-line rounded-xl overflow-hidden">
		<div class="flex flex-wrap items-start gap-3 px-4 py-3.5 border-b border-line-soft">
			<div class="flex-1 min-w-[240px]">
				<span class="text-xs text-ink-3">{widoczneSzablony.find((g) => g.pozycje.some((p) => p.id === wybrany))?.grupa} · podgląd</span>
				<h2 id="rap-tytul" class="text-lg font-semibold text-ink">{raport.nazwa}</h2>
				<p class="text-[13px] text-ink-2 max-w-[70ch]">{raport.opis}</p>
			</div>
			{#if raport.eksport}
				<div class="flex gap-2">
					<button onclick={() => eksportuj('xlsx')} disabled={!raport.eksport.wiersze.length} class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-50"><FileSpreadsheet size={16} /> XLSX</button>
					<button onclick={() => eksportuj('csv')} disabled={!raport.eksport.wiersze.length} class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-50"><Download size={16} class="text-ink-3" /> CSV</button>
				</div>
			{:else if raport.link}
				<a href={raport.link.href} class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover"><ExternalLink size={16} /> {raport.link.tekst}</a>
			{/if}
		</div>

		{#if raport.okres || raport.horyzont}
			<div role="group" aria-label="Parametry raportu" class="flex flex-wrap gap-2 px-4 py-2.5 border-b border-line-soft bg-side">
				{#if raport.okres}
					<label class="relative inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border border-line bg-white text-[13px] focus-within:ring-2 focus-within:ring-accent/40">
						<span class="text-ink-3">Okres</span>
						<span class="font-semibold text-ink">{okres.etykieta.split(' · ')[1]}</span>
						<select bind:value={preset} aria-label="Okres" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
							{#each PRESETY as [id, label]}<option value={id}>{label}</option>{/each}
						</select>
					</label>
				{/if}
				{#if raport.horyzont}
					<label class="relative inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border border-line bg-white text-[13px] focus-within:ring-2 focus-within:ring-accent/40">
						<span class="text-ink-3">Kończą się w ciągu</span>
						<span class="font-semibold text-ink">{horyzont} dni</span>
						<select bind:value={horyzont} aria-label="Horyzont" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
							{#each [30, 60, 90] as d}<option value={d}>{d} dni</option>{/each}
						</select>
					</label>
				{/if}
			</div>
		{/if}

		<div class="p-4 flex flex-col gap-4">
			{#if raport.kontrole.length}
				<div class="rounded-xl border border-line overflow-hidden">
					<div class="flex flex-wrap items-baseline gap-2 px-3 py-2 bg-surface-2">
						<span class="text-[13px] font-semibold text-ink">Kontrola danych przed eksportem</span>
						<span class="text-xs {uwagi ? 'text-warn font-semibold' : 'text-ok font-semibold'}">{uwagi ? odmiana(uwagi, 'uwaga', 'uwagi', 'uwag') : 'bez uwag'}</span>
					</div>
					<ul>
						{#each raport.kontrole as k}
							<li class="flex flex-wrap items-start gap-2.5 px-3 py-2.5 border-t border-line-soft">
								{#if k.ok}<CheckCircle2 size={16} class="shrink-0 mt-0.5 text-ok" />{:else}<AlertTriangle size={16} class="shrink-0 mt-0.5 text-warn" />{/if}
								<span class="flex-[1_1_260px] min-w-0">
									<span class="block text-[13px] font-medium text-ink">{k.tekst}</span>
									{#if k.szczegol}<span class="block text-xs text-ink-3">{k.szczegol}</span>{/if}
								</span>
								{#if k.akcja}<a href={k.akcja.href} class="h-7 inline-flex items-center px-2.5 text-xs font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">{k.akcja.tekst}</a>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if raport.sumy.length}
				<div class="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3">
					{#each raport.sumy as s}
						<div class="px-3 py-2.5 rounded-xl border border-line flex flex-col gap-0.5">
							<span class="text-xs text-ink-3">{s.etykieta}</span>
							<span class="text-lg font-semibold text-ink">{s.wartosc}</span>
							{#if s.notka}<span class="text-xs {s.uwaga ? 'text-warn font-semibold' : 'text-ink-3'}">{s.notka}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if raport.pusty}
				<div class="flex flex-col items-center text-center gap-2 py-10 px-4 rounded-xl border border-dashed border-line">
					<span class="w-10 h-10 rounded-full bg-surface-2 text-ink-3 flex items-center justify-center"><Inbox size={20} /></span>
					<span class="text-sm font-semibold text-ink">{raport.pusty.tytul}</span>
					<span class="text-[13px] text-ink-2 max-w-[48ch]">{raport.pusty.tekst}</span>
					{#if raport.pusty.akcja}<a href={raport.pusty.akcja.href} class="mt-1 text-[13px] font-semibold text-accent-text hover:underline">{raport.pusty.akcja.tekst} →</a>{/if}
				</div>
			{:else if raport.kolumny && raport.wiersze}
				<div class="rounded-xl border border-line overflow-hidden">
					<div class="flex flex-wrap items-baseline gap-2 px-3 py-2 border-b border-line-soft">
						<span class="text-[13px] font-semibold text-ink">Podgląd zestawienia</span>
						<span class="text-xs text-ink-3">{raport.wiersze.length > LIMIT ? `pierwsze ${LIMIT} z ${raport.wiersze.length} wierszy — całość w eksporcie` : odmiana(raport.wiersze.length, 'wiersz', 'wiersze', 'wierszy')}</span>
					</div>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-[13px]">
							<thead>
								<tr class="bg-surface-2 text-ink-2">
									{#each raport.kolumny as k}<th class="px-3 py-2 font-semibold whitespace-nowrap {k.prawa ? 'text-right' : 'text-left'}">{k.t}</th>{/each}
								</tr>
							</thead>
							<tbody>
								{#each raport.wiersze.slice(0, LIMIT) as w}
									<tr class="border-t border-line-soft">
										{#each w as c, j}<td class="px-3 py-1.5 {raport.kolumny[j]?.prawa ? 'text-right tabular-nums whitespace-nowrap' : ''} {raport.kolumny[j]?.mono ? 'font-mono text-xs' : ''}">{c}</td>{/each}
									</tr>
								{/each}
								{#if raport.razem}
									<tr class="border-t border-line font-semibold bg-side">
										{#each raport.razem as c, j}<td class="px-3 py-1.5 {raport.kolumny[j]?.prawa ? 'text-right tabular-nums whitespace-nowrap' : ''}">{c}</td>{/each}
									</tr>
								{/if}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>
	</section>
</div>
