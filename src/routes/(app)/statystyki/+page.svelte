<script lang="ts">
	// Statystyki portfela — wszystko liczone z danych firmy już wczytanych do aplikacji.
	// Polisy według daty początku ochrony; umowy generalne pomijane (przypis jest na polisach pod nimi).
	import { onMount, type Snippet } from 'svelte';
	import { sb } from '$lib/supabase';
	import { appState, isBroker } from '$lib/stores/app.svelte';
	import { odmiana, todayStr } from '$lib/utils';
	import { ugBezRozliczania, ROZLICZONE } from '$lib/platnosci';
	import { nazwaRodzaju } from '$lib/statusPolisy';
	import type { Policy } from '$lib/types/database';
	import Kolumny from '$lib/components/wykresy/Kolumny.svelte';
	import {
		KOLOR, PRESETY, dzien, grupuj, liczba, liczonaPolisa, mediana, miesiacKrotko, miesiacPelny, miesiecznie,
		okresZPresetu, proc, rokWczesniej, stanRat, sumuj, wOkresie, zl, zmiana, type Kolumna, type PresetOkresu
	} from '$lib/analityka';
	import { ArrowDownRight, ArrowUpRight, CheckCircle2, Clock, AlertCircle, Info, X, GitCompare, FileChartColumn } from 'lucide-svelte';

	const dzis = todayStr();

	// ── Filtry (jeden wiersz, obowiązują dla wszystkich sekcji) ──
	let preset = $state<PresetOkresu>('rok');
	let fTu = $state('');
	let fRodzaj = $state('');
	let fOpiekun = $state('');
	let bezNajwiekszych = $state(false);
	let miara = $state<'przypis' | 'prowizja' | 'polisy'>('przypis');
	let widok = $state<'wykres' | 'tabela'>('wykres');

	const polisyLiczone = $derived(appState.policies.filter(liczonaPolisa));
	const najstarsza = $derived(polisyLiczone.reduce<string | null>((m, p) => (p.data_od && (!m || p.data_od < m) ? p.data_od : m), null));
	const okres = $derived(okresZPresetu(preset, dzis, najstarsza));
	const opiekunKlienta = $derived(new Map(appState.clients.map((c) => [c.id, c.opiekun_id])));
	const nazwaTuWg = $derived(new Map(appState.insurers.map((i) => [i.id, i.skrot || i.nazwa])));
	const opiekunWg = $derived(new Map(appState.brokers.map((b) => [b.id, b.imie_nazwisko || b.email])));

	const pasuje = (p: Policy) =>
		(!fTu || p.tu_id === fTu) &&
		(!fRodzaj || p.rodzaj === fRodzaj) &&
		(!fOpiekun || (fOpiekun === '-' ? !opiekunKlienta.get(p.klient_id) : opiekunKlienta.get(p.klient_id) === fOpiekun));
	const wFiltrach = $derived(polisyLiczone.filter(pasuje));
	const wOkresieWszystkie = $derived(wFiltrach.filter((p) => wOkresie(p.data_od, okres)));
	const posortowaneWgSkladki = $derived([...wOkresieWszystkie].sort((a, b) => Number(b.skladka_przypisana ?? 0) - Number(a.skladka_przypisana ?? 0)));
	const najwieksze = $derived(posortowaneWgSkladki.slice(0, 2));
	const moznaUkryc = $derived(wOkresieWszystkie.length >= 5);
	const polisy = $derived(bezNajwiekszych && moznaUkryc ? wOkresieWszystkie.filter((p) => !najwieksze.includes(p)) : wOkresieWszystkie);
	const sumy = $derived(sumuj(polisy));
	const ileFiltrow = $derived([fTu, fRodzaj, fOpiekun].filter(Boolean).length);

	const towarzystwa = $derived(appState.insurers.filter((i) => polisyLiczone.some((p) => p.tu_id === i.id)).sort((a, b) => (a.skrot || a.nazwa).localeCompare(b.skrot || b.nazwa, 'pl')));
	const rodzaje = $derived([...new Set(polisyLiczone.map((p) => p.rodzaj).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')));
	const opiekunowie = $derived([...appState.brokers].sort((a, b) => (a.imie_nazwisko || a.email).localeCompare(b.imie_nazwisko || b.email, 'pl')));

	// ── Wskaźniki ──
	const rr = $derived.by(() => {
		if (preset === 'wszystko') return { dostepne: false, tekst: 'cała historia — bez porównania' };
		const wczesniej = rokWczesniej(okres);
		if (!najstarsza || najstarsza > wczesniej.od) {
			return { dostepne: false, tekst: najstarsza ? `r/r niedostępne — historia polis od ${dzien(najstarsza)}` : 'r/r niedostępne — brak polis' };
		}
		const s = sumuj(wFiltrach.filter((p) => wOkresie(p.data_od, wczesniej)));
		return { dostepne: true, przypis: zmiana(sumy.przypis, s.przypis), prowizja: zmiana(sumy.prowizja, s.prowizja), polisy: zmiana(sumy.polisy, s.polisy), tekst: 'rok do roku' };
	});
	const stawka = $derived(sumy.przypis ? (sumy.prowizja / sumy.przypis) * 100 : 0);
	const medianaSkladki = $derived(mediana(polisy.map((p) => Number(p.skladka_przypisana ?? 0))));
	const koncentracja = $derived.by(() => {
		const total = posortowaneWgSkladki.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0);
		if (posortowaneWgSkladki.length < 3 || !total) return null;
		const top = (n: number) => posortowaneWgSkladki.slice(0, n).reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0) / total * 100;
		return { dwie: top(2), dziesiec: posortowaneWgSkladki.length > 10 ? top(10) : null };
	});

	// Raty — stan na dziś (bez filtra okresu), dla polis spełniających pozostałe filtry
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	const idsWFiltrach = $derived(new Set(appState.policies.filter(pasuje).map((p) => p.id)));
	const raty = $derived(appState.payments.filter((r) => idsWFiltrach.has(r.polisa_id)));
	const rat = $derived(stanRat(raty, dzis, ugBez));
	const wartoscRat = $derived(rat.oplacone.przypis + rat.przed.przypis + rat.po.przypis);
	const liczbaRat = $derived(rat.oplacone.polisy + rat.przed.polisy + rat.po.polisy);
	const udzialRat = (v: number) => (wartoscRat ? (v / wartoscRat) * 100 : 0);

	// ── Wykres miesięczny ──
	const miesieczne = $derived(miesiecznie(polisy, okres));
	const kilkaLat = $derived(okres.od.slice(0, 4) !== okres.do.slice(0, 4));
	const kolumny = $derived<Kolumna[]>(
		miesieczne.map(({ ym, s }) => {
			const wToku = ym === dzis.slice(0, 7) && okres.do === dzis;
			return {
				klucz: ym,
				etykieta: miesiacKrotko(ym, kilkaLat),
				pelna: `${miesiacPelny(ym)}${wToku ? ` (do ${dzien(dzis, false)})` : ''}`,
				wartosc: s[miara],
				dodatek: miara === 'polisy' ? `przypis ${zl(s.przypis)}` : odmiana(s.polisy, 'polisa', 'polisy', 'polis'),
				jasna: wToku
			};
		})
	);
	const TYTUL = { przypis: 'Przypis składki miesięcznie', prowizja: 'Prowizja przypisana miesięcznie', polisy: 'Nowe polisy miesięcznie' };
	const sumaWykresu = $derived(miara === 'polisy' ? liczba(sumy.polisy) : zl(sumy[miara]));
	const notka = $derived.by(() => {
		if (bezNajwiekszych && moznaUkryc) {
			const ukryte = najwieksze.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0);
			return `Bez 2 największych polis (${zl(ukryte)}) widać rytm reszty portfela.`;
		}
		if (koncentracja && koncentracja.dwie >= 40 && miara !== 'polisy') {
			return `2 największe polisy to ${proc(koncentracja.dwie)} przypisu — zaznacz „Bez 2 największych polis”, żeby zobaczyć resztę okresu.`;
		}
		return '';
	});

	// ── Towarzystwa ──
	const wgTu = $derived(
		[...grupuj(polisy, (p) => p.tu_id)].map(([id, s]) => ({ id, nazwa: nazwaTuWg.get(id) ?? '—', ...s })).sort((a, b) => b.przypis - a.przypis)
	);
	const tuWidoczne = $derived.by(() => {
		if (wgTu.length <= 8) return wgTu;
		const reszta = wgTu.slice(7);
		return [...wgTu.slice(0, 7), { id: '_reszta', nazwa: `Pozostałe (${reszta.length})`, przypis: reszta.reduce((s, t) => s + t.przypis, 0), prowizja: reszta.reduce((s, t) => s + t.prowizja, 0), polisy: reszta.reduce((s, t) => s + t.polisy, 0), klienci: new Set<string>() }];
	});
	const tuMaks = $derived(Math.max(1, ...tuWidoczne.map((t) => t.przypis)));
	const tuWniosek = $derived.by(() => {
		if (!wgTu.length || !sumy.przypis) return '';
		const top = wgTu[0];
		const zeStawka = wgTu.filter((t) => t.przypis > 0);
		const naj = [...zeStawka].sort((a, b) => b.prowizja / b.przypis - a.prowizja / a.przypis)[0];
		return `${top.nazwa} to ${proc((top.przypis / sumy.przypis) * 100)} przypisu (${odmiana(top.polisy, 'polisa', 'polisy', 'polis')}).` +
			(naj && zeStawka.length > 1 ? ` Najwyższa stawka prowizji: ${naj.nazwa} — ${proc((naj.prowizja / naj.przypis) * 100)}.` : '');
	});

	// ── Rodzaje: udział w liczbie polis a udział w przypisie ──
	const wgRodzaju = $derived(
		[...grupuj(polisy, (p) => p.rodzaj)]
			.map(([r, s]) => ({ r, a: sumy.polisy ? (s.polisy / sumy.polisy) * 100 : 0, b: sumy.przypis ? (s.przypis / sumy.przypis) * 100 : 0, n: s.polisy }))
			.sort((x, y) => y.b - x.b)
			.slice(0, 8)
	);
	const skalaRodzajow = $derived(Math.min(100, Math.max(20, Math.ceil(Math.max(0, ...wgRodzaju.flatMap((x) => [x.a, x.b])) / 20) * 20)));
	const rodzajWniosek = $derived.by(() => {
		if (wgRodzaju.length < 2) return '';
		const roznica = [...wgRodzaju].sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0];
		const liczny = [...wgRodzaju].sort((x, y) => y.a - x.a)[0];
		return `${nazwaRodzaju(liczny.r)} to ${proc(liczny.a)} polis i ${proc(liczny.b)} przypisu.` +
			(roznica.r !== liczny.r ? ` ${nazwaRodzaju(roznica.r)} — ${proc(roznica.a)} polis i ${proc(roznica.b)} przypisu.` : '');
	});

	// ── Lejek leadów (liczby z bazy, bez wczytywania całej listy) ──
	const ETAPY: [string, string][] = [['nowy', 'Nowy'], ['w_kontakcie', 'W kontakcie'], ['oferta_wyslana', 'Oferta wysłana'], ['wygrany', 'Wygrany'], ['przegrany', 'Przegrany']];
	let lejek = $state<Record<string, number> | null>(null);
	let lejekBlad = $state(false);
	onMount(async () => {
		try {
			const wyniki = await Promise.all(ETAPY.map(([k]) => sb.from('crm_prospects').select('id', { count: 'exact', head: true }).eq('status', k)));
			if (wyniki.some((w) => w.error)) { lejekBlad = true; return; }
			lejek = Object.fromEntries(ETAPY.map(([k], i) => [k, wyniki[i].count ?? 0]));
		} catch {
			lejekBlad = true;
		}
	});
	const leadowRazem = $derived(lejek ? Object.values(lejek).reduce((s, n) => s + n, 0) : 0);
	const lejekMaks = $derived(lejek ? Math.max(1, ...Object.values(lejek)) : 1);

	// ── Czego brakuje do pełnych statystyk ──
	const braki = $derived.by(() => {
		const out: { co: string; dlaczego: string; akcja: string; href: string }[] = [];
		const wygasle = polisyLiczone.filter((p) => p.data_do && p.data_do < dzis).length;
		const odnowien = appState.policies.filter((p) => p.renewal_of).length;
		if (odnowien === 0 && wygasle > 0) {
			out.push({ co: 'Skuteczność odnowień', dlaczego: `Żadna polisa nie jest powiązana z polisą, którą wznawia (pole „odnowienie polisy”), a ${odmiana(wygasle, 'polisa wygasła', 'polisy wygasły', 'polis wygasło')}.`, akcja: 'Odnowienia', href: '/renewals' });
		}
		const zOpiekunem = appState.clients.filter((c) => c.opiekun_id).length;
		if (appState.clients.length > 0 && zOpiekunem / appState.clients.length < 0.5) {
			out.push({ co: 'Porównanie opiekunów', dlaczego: `Opiekuna ma ${liczba(zOpiekunem)} z ${liczba(appState.clients.length)} klientów — wyniki według opiekunów obejmą tylko ich.`, akcja: 'Przypisz opiekunów', href: '/clients' });
		}
		const wszystkichRat = appState.payments.length;
		const oplaconych = appState.payments.filter((r) => ROZLICZONE.includes(r.status)).length;
		if (wszystkichRat >= 10 && oplaconych / wszystkichRat < 0.1) {
			out.push({ co: 'Inkaso składki', dlaczego: `${liczba(oplaconych)} z ${liczba(wszystkichRat)} rat oznaczono jako opłacone — kwota „po terminie” jest najpewniej zawyżona.`, akcja: 'Płatności', href: '/payments' });
		}
		if (isBroker() && appState.claims.length === 0) {
			out.push({ co: 'Szkodowość', dlaczego: 'W systemie nie ma zarejestrowanej żadnej szkody.', akcja: 'Szkody', href: '/claims' });
		}
		if (najstarsza) {
			const [r, m] = najstarsza.split('-').map(Number);
			const pelneRr = `${r + 1}-${String(m).padStart(2, '0')}`;
			if (`${pelneRr}-01` > dzis) {
				out.push({ co: 'Porównanie rok do roku', dlaczego: `Historia polis sięga ${dzien(najstarsza)} — pełne porównanie rok do roku będzie możliwe od ${miesiacPelny(pelneRr).toLowerCase()}.`, akcja: 'Import polis', href: '/policies/import' });
			}
		}
		return out;
	});

	const strzalka = (v: number | null | undefined) => (v == null ? '' : `${v >= 0 ? '+' : '−'}${proc(Math.abs(v))}`);
</script>

<svelte:head><title>Statystyki — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Statystyki portfela</h1>
		<p class="text-sm text-ink-3 mt-0.5">Polisy według daty początku ochrony · stan na {dzien(dzis)}</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/porownania" class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2"><GitCompare size={16} class="text-ink-3" /> Porównaj</a>
		<a href="/raporty" class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover"><FileChartColumn size={16} /> Raporty</a>
	</div>
</div>

<!-- Filtry -->
{#snippet filtr(etykieta: string, tekst: string | null, wyczysc: () => void, opcje: Snippet, wartosc: string, ustaw: (v: string) => void)}
	<span class="relative inline-flex items-center h-8 rounded-lg text-[13px] font-medium focus-within:ring-2 focus-within:ring-accent/40 {tekst ? 'border border-line bg-white text-ink pr-7' : 'border border-dashed border-[#C4CAD4] text-ink-2 hover:bg-surface-2'}">
		<span aria-hidden="true" class="px-2.5 max-w-[220px] truncate whitespace-nowrap">{tekst ?? `+ ${etykieta}`}</span>
		<select aria-label={etykieta} value={wartosc} onchange={(e) => ustaw((e.currentTarget as HTMLSelectElement).value)} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
			{@render opcje()}
		</select>
		{#if tekst}
			<button onclick={wyczysc} aria-label="Usuń filtr: {etykieta}" class="absolute right-1 z-10 w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={12} /></button>
		{/if}
	</span>
{/snippet}
{#snippet opcjeTu()}
	<option value="">Dowolne towarzystwo</option>
	{#each towarzystwa as t}<option value={t.id}>{t.skrot || t.nazwa}</option>{/each}
{/snippet}
{#snippet opcjeRodzaj()}
	<option value="">Dowolny rodzaj</option>
	{#each rodzaje as r}<option value={r}>{nazwaRodzaju(r)}</option>{/each}
{/snippet}
{#snippet opcjeOpiekun()}
	<option value="">Dowolny opiekun klienta</option>
	{#each opiekunowie as b}<option value={b.id}>{b.imie_nazwisko || b.email}</option>{/each}
	<option value="-">Klient bez opiekuna</option>
{/snippet}
<div role="group" aria-label="Filtry — obowiązują dla wszystkich sekcji" class="flex flex-wrap items-center gap-2 px-3 py-2.5 mb-4 bg-white border border-line rounded-xl">
	<label class="relative inline-flex items-center h-8 rounded-lg border border-ink text-[13px] font-semibold text-ink focus-within:ring-2 focus-within:ring-accent/40">
		<span aria-hidden="true" class="pl-2.5 pr-2 whitespace-nowrap">{okres.etykieta}</span>
		<span class="sr-only">Okres</span>
		<select bind:value={preset} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
			{#each PRESETY as [id, label]}<option value={id}>{label}</option>{/each}
		</select>
	</label>
	{@render filtr('Towarzystwo', fTu ? `TU: ${nazwaTuWg.get(fTu) ?? '—'}` : null, () => (fTu = ''), opcjeTu, fTu, (v) => (fTu = v))}
	{@render filtr('Rodzaj', fRodzaj ? `Rodzaj: ${nazwaRodzaju(fRodzaj)}` : null, () => (fRodzaj = ''), opcjeRodzaj, fRodzaj, (v) => (fRodzaj = v))}
	{@render filtr('Opiekun', fOpiekun ? (fOpiekun === '-' ? 'Klient bez opiekuna' : `Opiekun: ${opiekunWg.get(fOpiekun) ?? '—'}`) : null, () => (fOpiekun = ''), opcjeOpiekun, fOpiekun, (v) => (fOpiekun = v))}
	{#if ileFiltrow > 0}
		<button onclick={() => { fTu = ''; fRodzaj = ''; fOpiekun = ''; }} class="h-8 px-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść</button>
	{/if}
	{#if moznaUkryc}
		<label class="sm:ml-auto flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer">
			<input type="checkbox" bind:checked={bezNajwiekszych} class="w-4 h-4 accent-accent" />
			Bez 2 największych polis
		</label>
	{/if}
</div>

<!-- Wskaźniki -->
<section aria-label="Wskaźniki" class="grid grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] gap-3 mb-4">
	<div class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1">
		<span class="text-[13px] text-ink-2">Przypis składki</span>
		<span class="text-[26px] leading-8 font-semibold text-ink">{zl(sumy.przypis)}</span>
		{#if rr.dostepne && rr.przypis != null}
			<span class="flex items-center gap-1 text-xs font-semibold {rr.przypis >= 0 ? 'text-ok' : 'text-danger'}">
				{#if rr.przypis >= 0}<ArrowUpRight size={14} />{:else}<ArrowDownRight size={14} />{/if}
				{strzalka(rr.przypis)} <span class="font-normal text-ink-3">rok do roku</span>
			</span>
		{:else}
			<span class="flex items-start gap-1.5 text-xs text-ink-3"><Info size={14} class="shrink-0 mt-px" /> {rr.tekst}</span>
		{/if}
	</div>
	<div class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1">
		<span class="text-[13px] text-ink-2">Prowizja przypisana</span>
		<span class="text-[26px] leading-8 font-semibold text-ink">{zl(sumy.prowizja)}</span>
		<span class="text-xs text-ink-3">efektywna stawka {proc(stawka)}</span>
	</div>
	<div class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1">
		<span class="text-[13px] text-ink-2">Nowe polisy</span>
		<span class="text-[26px] leading-8 font-semibold text-ink">{liczba(sumy.polisy)}</span>
		<span class="text-xs text-ink-3">{sumy.polisy ? `mediana składki ${zl(medianaSkladki)}` : 'brak polis w okresie'}</span>
	</div>
	<div class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1">
		<span class="text-[13px] text-ink-2">Koncentracja przypisu</span>
		<span class="text-[26px] leading-8 font-semibold text-ink">{koncentracja ? proc(koncentracja.dwie, 0) : '—'}</span>
		<span class="flex items-start gap-1.5 text-xs text-ink-3">
			{#if koncentracja}
				{#if koncentracja.dwie >= 40}<Info size={14} class="shrink-0 mt-px text-warn" />{/if}
				z 2 największych polis{koncentracja.dziesiec != null ? ` · 10 największych to ${proc(koncentracja.dziesiec, 0)}` : ''}
			{:else}
				za mało polis w okresie
			{/if}
		</span>
	</div>
	<a href="/payments?filtr=po-terminie" class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1 hover:border-accent">
		<span class="text-[13px] text-ink-2">Należności po terminie</span>
		<span class="text-[26px] leading-8 font-semibold text-ink">{zl(rat.po.przypis)}</span>
		<span class="text-xs {rat.po.polisy ? 'text-danger font-semibold' : 'text-ink-3'}">{odmiana(rat.po.polisy, 'rata', 'raty', 'rat')} · {proc(udzialRat(rat.po.przypis), 0)} wartości rat</span>
	</a>
</section>

<!-- Wykres miesięczny -->
<section aria-labelledby="st-miesiace" class="bg-white border border-line rounded-xl px-4 pt-4 pb-3.5 mb-4 flex flex-col gap-3.5">
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex flex-col">
			<h2 id="st-miesiace" class="text-[15px] font-semibold text-ink">{TYTUL[miara]}</h2>
			<span class="text-xs text-ink-3">{okres.etykieta.split(' · ')[1]} · razem {sumaWykresu}</span>
		</div>
		<div role="group" aria-label="Miara" class="sm:ml-auto flex p-0.5 rounded-lg bg-surface-2 border border-line-soft">
			{#each [['przypis', 'Przypis'], ['prowizja', 'Prowizja'], ['polisy', 'Liczba polis']] as [k, l]}
				<button aria-pressed={miara === k} onclick={() => (miara = k as typeof miara)} class="h-7 px-3 rounded-md text-[13px] {miara === k ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">{l}</button>
			{/each}
		</div>
		<div role="group" aria-label="Widok" class="flex p-0.5 rounded-lg bg-surface-2 border border-line-soft">
			{#each [['wykres', 'Wykres'], ['tabela', 'Tabela']] as [k, l]}
				<button aria-pressed={widok === k} onclick={() => (widok = k as typeof widok)} class="h-7 px-3 rounded-md text-[13px] {widok === k ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">{l}</button>
			{/each}
		</div>
	</div>
	{#if widok === 'wykres'}
		<Kolumny dane={kolumny} pieniadze={miara !== 'polisy'} opis={TYTUL[miara]} />
		<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
			{#if kolumny.some((k) => k.jasna)}
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm" style="background: {KOLOR.seriaJasna}"></span>{miesiacPelny(dzis.slice(0, 7)).toLowerCase()} — miesiąc w toku</span>
			{/if}
			{#if notka}<span>{notka}</span>{/if}
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[480px] text-[13px]">
				<thead>
					<tr class="bg-surface-2 text-ink-2 text-left">
						<th class="px-3 py-2 font-semibold">Miesiąc</th>
						<th class="px-3 py-2 font-semibold text-right">Przypis składki</th>
						<th class="px-3 py-2 font-semibold text-right">Prowizja</th>
						<th class="px-3 py-2 font-semibold text-right">Polisy</th>
					</tr>
				</thead>
				<tbody>
					{#each miesieczne as { ym, s } (ym)}
						<tr class="border-t border-line-soft">
							<td class="px-3 py-1.5">{miesiacPelny(ym)}</td>
							<td class="px-3 py-1.5 text-right tabular-nums">{zl(s.przypis)}</td>
							<td class="px-3 py-1.5 text-right tabular-nums">{zl(s.prowizja)}</td>
							<td class="px-3 py-1.5 text-right tabular-nums">{liczba(s.polisy)}</td>
						</tr>
					{/each}
					<tr class="border-t border-line font-semibold bg-side">
						<td class="px-3 py-1.5">Razem</td>
						<td class="px-3 py-1.5 text-right tabular-nums">{zl(sumy.przypis)}</td>
						<td class="px-3 py-1.5 text-right tabular-nums">{zl(sumy.prowizja)}</td>
						<td class="px-3 py-1.5 text-right tabular-nums">{liczba(sumy.polisy)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	{/if}
</section>

<div class="grid gap-4 lg:grid-cols-2 mb-4">
	<!-- Towarzystwa -->
	<section aria-labelledby="st-tu" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
		<div>
			<h2 id="st-tu" class="text-[15px] font-semibold text-ink">Przypis według towarzystw</h2>
			<span class="text-xs text-ink-3">udział w przypisie · liczba polis · efektywna stawka prowizji</span>
		</div>
		{#if tuWidoczne.length === 0}
			<p class="py-6 text-center text-sm text-ink-3">Brak polis w okresie.</p>
		{:else}
			<ul class="flex flex-col gap-2.5">
				{#each tuWidoczne as t (t.id)}
					<li class="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)_120px] items-center gap-x-3 gap-y-0.5 text-[13px]" title="{t.nazwa}: {zl(t.przypis)}, prowizja {zl(t.prowizja)}">
						<span class="truncate text-ink">{t.nazwa}</span>
						<span class="flex items-center gap-2 min-w-0">
							<span class="h-3 rounded-r" style="width: max(2px, calc((100% - 96px) * {t.przypis / tuMaks})); background: {t.id === '_reszta' ? KOLOR.neutralny : KOLOR.seria}"></span>
							<span class="text-ink tabular-nums whitespace-nowrap">{zl(t.przypis)} <span class="text-ink-3">· {proc(sumy.przypis ? (t.przypis / sumy.przypis) * 100 : 0)}</span></span>
						</span>
						<span class="col-start-2 sm:col-start-auto text-xs text-ink-3 tabular-nums sm:text-right whitespace-nowrap">{odmiana(t.polisy, 'polisa', 'polisy', 'polis')} · {proc(t.przypis ? (t.prowizja / t.przypis) * 100 : 0)}</span>
					</li>
				{/each}
			</ul>
			{#if tuWniosek}<p class="text-[13px] text-ink-2 border-t border-line-soft pt-3">{tuWniosek}</p>{/if}
		{/if}
	</section>

	<!-- Rodzaje -->
	<section aria-labelledby="st-rodzaje" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
		<div class="flex flex-wrap items-start gap-2">
			<div class="flex-1 min-w-[200px]">
				<h2 id="st-rodzaje" class="text-[15px] font-semibold text-ink">Liczba polis a wartość — według rodzaju</h2>
				<span class="text-xs text-ink-3">udział w liczbie polis i w przypisie, skala 0–{skalaRodzajow}%</span>
			</div>
			<span class="flex gap-3 text-xs text-ink-2">
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background: {KOLOR.seria2}"></span>polisy</span>
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background: {KOLOR.seria}"></span>przypis</span>
			</span>
		</div>
		{#if wgRodzaju.length === 0}
			<p class="py-6 text-center text-sm text-ink-3">Brak polis w okresie.</p>
		{:else}
			<ul class="flex flex-col gap-2.5">
				{#each wgRodzaju as r (r.r)}
					{@const a = (r.a / skalaRodzajow) * 100}
					{@const b = (r.b / skalaRodzajow) * 100}
					<li class="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] sm:grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[13px]" title="{nazwaRodzaju(r.r)}: {proc(r.a)} polis, {proc(r.b)} przypisu">
						<span class="truncate text-ink">{nazwaRodzaju(r.r)}</span>
						<span aria-hidden="true" class="relative h-3">
							<span class="absolute inset-x-0 top-1/2 h-px" style="background: {KOLOR.siatka}"></span>
							<span class="absolute top-1/2 h-0.5 -translate-y-1/2" style="left: {Math.min(a, b)}%; width: {Math.abs(a - b)}%; background: {KOLOR.os}"></span>
							<span class="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style="left: {a}%; background: {KOLOR.seria2}"></span>
							<span class="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style="left: {b}%; background: {KOLOR.seria}"></span>
						</span>
						<span class="col-start-2 sm:col-start-auto text-xs text-ink-3 tabular-nums sm:text-right whitespace-nowrap">{proc(r.a)} polis · <span class="text-ink">{proc(r.b)} przypisu</span></span>
					</li>
				{/each}
			</ul>
			{#if rodzajWniosek}<p class="text-[13px] text-ink-2 border-t border-line-soft pt-3">{rodzajWniosek}</p>{/if}
		{/if}
	</section>
</div>

<div class="grid gap-4 lg:grid-cols-2 mb-4">
	<!-- Raty -->
	<section aria-labelledby="st-raty" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
		<div>
			<h2 id="st-raty" class="text-[15px] font-semibold text-ink">Raty według statusu</h2>
			<span class="text-xs text-ink-3">{odmiana(liczbaRat, 'rata', 'raty', 'rat')} na {zl(wartoscRat)} · stan na dziś, status liczony z daty</span>
		</div>
		{#if liczbaRat === 0}
			<p class="py-6 text-center text-sm text-ink-3">Brak rat dla wybranych filtrów.</p>
		{:else}
			<div role="img" aria-label="Opłacone {proc(udzialRat(rat.oplacone.przypis))}, przed terminem {proc(udzialRat(rat.przed.przypis))}, po terminie {proc(udzialRat(rat.po.przypis))} wartości rat" class="flex gap-0.5 h-3 rounded-full overflow-hidden bg-surface-2">
				{#if rat.oplacone.przypis > 0}<span class="min-w-1" style="width: {udzialRat(rat.oplacone.przypis)}%; background: {KOLOR.ok}"></span>{/if}
				{#if rat.przed.przypis > 0}<span class="min-w-1" style="width: {udzialRat(rat.przed.przypis)}%; background: {KOLOR.neutralny}"></span>{/if}
				{#if rat.po.przypis > 0}<span class="min-w-1" style="width: {udzialRat(rat.po.przypis)}%; background: {KOLOR.zly}"></span>{/if}
			</div>
			<ul class="flex flex-col gap-1.5 text-[13px]">
				<li class="flex items-center gap-2"><CheckCircle2 size={15} style="color: {KOLOR.ok}" /><span class="text-ink-2">Opłacone · {odmiana(rat.oplacone.polisy, 'rata', 'raty', 'rat')}</span><span class="ml-auto tabular-nums font-semibold text-ink">{zl(rat.oplacone.przypis)} <span class="font-normal text-ink-3">· {proc(udzialRat(rat.oplacone.przypis))}</span></span></li>
				<li class="flex items-center gap-2"><Clock size={15} style="color: {KOLOR.neutralny}" /><span class="text-ink-2">Przed terminem · {odmiana(rat.przed.polisy, 'rata', 'raty', 'rat')}</span><span class="ml-auto tabular-nums font-semibold text-ink">{zl(rat.przed.przypis)} <span class="font-normal text-ink-3">· {proc(udzialRat(rat.przed.przypis))}</span></span></li>
				<li class="flex items-center gap-2"><AlertCircle size={15} style="color: {KOLOR.zly}" /><span class="text-ink-2">Po terminie · {odmiana(rat.po.polisy, 'rata', 'raty', 'rat')}</span><span class="ml-auto tabular-nums font-semibold text-ink">{zl(rat.po.przypis)} <span class="font-normal text-ink-3">· {proc(udzialRat(rat.po.przypis))}</span></span></li>
			</ul>
			{#if liczbaRat >= 10 && rat.oplacone.polisy / liczbaRat < 0.1}
				<p class="flex items-start gap-2 text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2">
					<Info size={15} class="shrink-0 mt-0.5" />
					Tylko {rat.oplacone.polisy} z {liczbaRat} rat oznaczono jako opłacone. Najpewniej wpłaty nie są odnotowywane — kwoty po terminie czytaj ostrożnie.
				</p>
			{/if}
		{/if}
	</section>

	<!-- Lejek leadów -->
	<section aria-labelledby="st-lejek" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
		<div>
			<h2 id="st-lejek" class="text-[15px] font-semibold text-ink">Lejek leadów</h2>
			<span class="text-xs text-ink-3">{lejek ? `${liczba(leadowRazem)} ${leadowRazem === 1 ? 'lead' : 'leadów'} według obecnego statusu · bez filtrów` : lejekBlad ? 'nie udało się wczytać leadów — odśwież stronę' : 'wczytywanie…'}</span>
		</div>
		{#if lejek}
			<ul class="flex flex-col gap-2.5">
				{#each ETAPY as [k, l], i (k)}
					{@const n = lejek[k] ?? 0}
					<li class="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 text-[13px]">
						<span class="text-ink">{l}</span>
						<span class="flex items-center gap-2 min-w-0">
							<span class="h-3 rounded-r" style="width: {n > 0 ? `max(2px, calc((100% - 56px) * ${n / lejekMaks}))` : '0'}; background: {k === 'przegrany' ? KOLOR.neutralny : KOLOR.rampa[i]}"></span>
							<span class="text-ink tabular-nums">{liczba(n)}</span>
						</span>
						<span class="text-xs text-ink-3 text-right tabular-nums">{proc(leadowRazem ? (n / leadowRazem) * 100 : 0)}</span>
					</li>
				{/each}
			</ul>
			{#if leadowRazem > 0 && (lejek['nowy'] ?? 0) / leadowRazem > 0.5}
				<p class="text-[13px] text-ink-2 border-t border-line-soft pt-3">{proc(((lejek['nowy'] ?? 0) / leadowRazem) * 100)} leadów nie ma jeszcze żadnego kontaktu.</p>
			{/if}
		{/if}
	</section>
</div>

{#if braki.length > 0}
	<section aria-labelledby="st-braki" class="bg-white border border-line rounded-xl overflow-hidden">
		<div class="px-4 py-3 border-b border-line-soft">
			<h2 id="st-braki" class="text-[15px] font-semibold text-ink">Czego brakuje do pełnych statystyk</h2>
			<span class="text-xs text-ink-3">tych wskaźników nie da się dziś policzyć — brakuje danych, a nie wynik jest zerowy</span>
		</div>
		<ul>
			{#each braki as b}
				<li class="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-line-soft first:border-t-0">
					<span class="w-7 h-7 rounded-full bg-warn-soft text-warn flex items-center justify-center shrink-0"><Info size={15} /></span>
					<span class="flex-[1_1_320px] min-w-0">
						<span class="block text-[13px] font-semibold text-ink">{b.co}</span>
						<span class="block text-[13px] text-ink-2">{b.dlaczego}</span>
					</span>
					<a href={b.href} class="h-8 inline-flex items-center px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">{b.akcja}</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
