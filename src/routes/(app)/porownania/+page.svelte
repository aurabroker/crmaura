<script lang="ts">
	// Porównania: towarzystwa, opiekunowie (opiekun klienta) i rodzaje obok siebie albo dwa okresy.
	// Dane firmy z appState; polisy według daty początku ochrony, bez umów generalnych (ramek).
	import { appState } from '$lib/stores/app.svelte';
	import { dateDiffDays, odmiana, todayStr } from '$lib/utils';
	import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import { nazwaRodzaju, odnowionePolisy } from '$lib/statusPolisy';
	import type { Policy } from '$lib/types/database';
	import Kolumny from '$lib/components/wykresy/Kolumny.svelte';
	import {
		KOLOR, PRESETY, dzien, grupuj, liczba, liczonaPolisa, miesiacKrotko, miesiacPelny, miesiecznie, okresZPresetu,
		podzialki, etykietaOsi, proc, rokWczesniej, sumuj, wOkresie, zl, zlKrotko, zmiana, type Okres, type PresetOkresu
	} from '$lib/analityka';
	import { ArrowDownRight, ArrowUpRight, Award, AlertTriangle, X, Plus, FileChartColumn, ChartColumn } from 'lucide-svelte';

	const dzis = todayStr();
	type Wymiar = 'tu' | 'opiekun' | 'rodzaj' | 'okres';
	const WYMIARY: [Wymiar, string][] = [['tu', 'Towarzystwa'], ['opiekun', 'Opiekunowie'], ['rodzaj', 'Rodzaje'], ['okres', 'Okresy']];
	let wymiar = $state<Wymiar>('tu');
	let preset = $state<PresetOkresu>('rok');
	let wybrane = $state<Record<string, string[] | undefined>>({});
	let wspolnaSkala = $state(true);
	let widok = $state<'wykres' | 'tabela'>('wykres');

	const polisyLiczone = $derived(appState.policies.filter(liczonaPolisa));
	const najstarsza = $derived(polisyLiczone.reduce<string | null>((m, p) => (p.data_od && (!m || p.data_od < m) ? p.data_od : m), null));
	const okres = $derived(okresZPresetu(preset, dzis, najstarsza));
	const wOkr = $derived(polisyLiczone.filter((p) => wOkresie(p.data_od, okres)));
	const opiekunKlienta = $derived(new Map(appState.clients.map((c) => [c.id, c.opiekun_id])));
	const nazwaTuWg = $derived(new Map(appState.insurers.map((i) => [i.id, i.skrot || i.nazwa])));
	const opiekunWg = $derived(new Map(appState.brokers.map((b) => [b.id, b.imie_nazwisko || b.email])));

	// Klucz encji dla polisy w danym wymiarze („-” = klient bez opiekuna).
	function klucz(p: Policy, w: Wymiar): string | null {
		if (w === 'tu') return p.tu_id;
		if (w === 'rodzaj') return p.rodzaj || null;
		if (w === 'opiekun') return opiekunKlienta.get(p.klient_id) ?? '-';
		return null;
	}
	function nazwa(k: string, w: Wymiar): string {
		if (w === 'tu') return nazwaTuWg.get(k) ?? '—';
		if (w === 'rodzaj') return nazwaRodzaju(k);
		return k === '-' ? 'Bez opiekuna' : opiekunWg.get(k) ?? '—';
	}

	const grupy = $derived(wymiar === 'okres' ? new Map() : grupuj(wOkr, (p) => klucz(p, wymiar)));
	const dostepne = $derived([...grupy.entries()].sort((a, b) => b[1].przypis - a[1].przypis).map(([k]) => k as string));
	// Domyślnie 3 największe (według przypisu w okresie); wybór zapamiętany osobno dla każdego wymiaru.
	const encje = $derived((wybrane[wymiar] ?? dostepne.slice(0, 3)).filter((k) => dostepne.includes(k)).slice(0, 4));
	function usun(k: string) { wybrane = { ...wybrane, [wymiar]: encje.filter((x) => x !== k) }; }
	function dodaj(k: string) { if (k) wybrane = { ...wybrane, [wymiar]: [...encje, k].slice(0, 4) }; }

	// ── Macierz wskaźników ──
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	const odnowione = $derived(odnowionePolisy(appState.policies));
	const sumaPrzypisu = $derived(sumuj(wOkr).przypis);
	type Kolumna = { k: string; nazwa: string; przypis: number; prowizja: number; stawka: number; polisy: number; srednia: number; klienci: number; zaleglosc: number; ratZaleglych: number; odnowienia60: number };
	const kolumnyMacierzy = $derived<Kolumna[]>(
		encje.map((k) => {
			const s = grupy.get(k)!;
			const polisyEncji = polisyLiczone.filter((p) => klucz(p, wymiar) === k);
			const ids = new Set(polisyEncji.map((p) => p.id));
			const zalegle = appState.payments.filter((r) => ids.has(r.polisa_id) && !ROZLICZONE.includes(r.status) && poTerminie(r, dzis, ugBez));
			return {
				k, nazwa: nazwa(k, wymiar),
				przypis: s.przypis, prowizja: s.prowizja, stawka: s.przypis ? (s.prowizja / s.przypis) * 100 : 0,
				polisy: s.polisy, srednia: s.polisy ? s.przypis / s.polisy : 0, klienci: s.klienci.size,
				zaleglosc: zalegle.reduce((a, r) => a + Number(r.kwota ?? 0), 0), ratZaleglych: zalegle.length,
				odnowienia60: polisyEncji.filter((p) => p.data_do && p.data_do >= dzis && dateDiffDays(dzis, p.data_do) <= 60 && !odnowione.has(p.id)).length
			};
		})
	);
	type Wiersz = { etykieta: string; podpowiedz: string; wartosc: (c: Kolumna) => number; fmt: (c: Kolumna) => string; pod?: (c: Kolumna) => string; lepiej: 'wiecej' | 'mniej' | null };
	const WIERSZE: Wiersz[] = [
		{ etykieta: 'Przypis składki', podpowiedz: 'w okresie', wartosc: (c) => c.przypis, fmt: (c) => zl(c.przypis), pod: (c) => `${proc(sumaPrzypisu ? (c.przypis / sumaPrzypisu) * 100 : 0)} całości`, lepiej: 'wiecej' },
		{ etykieta: 'Prowizja przypisana', podpowiedz: 'w okresie', wartosc: (c) => c.prowizja, fmt: (c) => zl(c.prowizja), lepiej: 'wiecej' },
		{ etykieta: 'Efektywna stawka', podpowiedz: 'prowizja / przypis', wartosc: (c) => c.stawka, fmt: (c) => proc(c.stawka), lepiej: 'wiecej' },
		{ etykieta: 'Nowe polisy', podpowiedz: 'w okresie', wartosc: (c) => c.polisy, fmt: (c) => liczba(c.polisy), lepiej: 'wiecej' },
		{ etykieta: 'Średnia składka', podpowiedz: 'przypis / polisy', wartosc: (c) => c.srednia, fmt: (c) => zl(c.srednia), lepiej: null },
		{ etykieta: 'Klienci', podpowiedz: 'z polisą w okresie', wartosc: (c) => c.klienci, fmt: (c) => liczba(c.klienci), lepiej: 'wiecej' },
		{ etykieta: 'Należności po terminie', podpowiedz: 'stan na dziś, wszystkie polisy', wartosc: (c) => c.zaleglosc, fmt: (c) => zl(c.zaleglosc), pod: (c) => odmiana(c.ratZaleglych, 'rata', 'raty', 'rat'), lepiej: 'mniej' },
		{ etykieta: 'Odnowienia w 60 dni', podpowiedz: 'polisy kończące się, bez następczyni', wartosc: (c) => c.odnowienia60, fmt: (c) => liczba(c.odnowienia60), lepiej: null }
	];
	function ocena(w: Wiersz, c: Kolumna): 'best' | 'warn' | null {
		if (kolumnyMacierzy.length < 2 || !w.lepiej) return null;
		const v = kolumnyMacierzy.map(w.wartosc);
		const x = w.wartosc(c);
		if (w.lepiej === 'mniej') return x > 0 && x === Math.max(...v) && v.some((y) => y < x) ? 'warn' : null;
		return x > 0 && x === Math.max(...v) && v.some((y) => y < x) ? 'best' : null;
	}
	const wnioski = $derived.by(() => {
		const c = kolumnyMacierzy;
		if (c.length < 2) return [] as string[];
		const out: string[] = [];
		const lider = [...c].sort((a, b) => b.przypis - a.przypis)[0];
		if (lider.przypis > 0) out.push(`${lider.nazwa} ma największy przypis: ${zl(lider.przypis)} (${proc(sumaPrzypisu ? (lider.przypis / sumaPrzypisu) * 100 : 0)} całego okresu).`);
		const zeStawka = c.filter((x) => x.przypis > 0).sort((a, b) => b.stawka - a.stawka);
		if (zeStawka.length >= 2 && zeStawka[0].stawka - zeStawka[zeStawka.length - 1].stawka >= 1) {
			out.push(`Stawka prowizji: od ${proc(zeStawka[zeStawka.length - 1].stawka)} (${zeStawka[zeStawka.length - 1].nazwa}) do ${proc(zeStawka[0].stawka)} (${zeStawka[0].nazwa}).`);
		}
		const dluznik = [...c].sort((a, b) => b.zaleglosc - a.zaleglosc)[0];
		if (dluznik.zaleglosc > 0) out.push(`Najwięcej należności po terminie: ${dluznik.nazwa} — ${zl(dluznik.zaleglosc)} (${odmiana(dluznik.ratZaleglych, 'rata', 'raty', 'rat')}).`);
		return out;
	});

	// ── Małe wykresy miesięczne ──
	const kilkaLat = $derived(okres.od.slice(0, 4) !== okres.do.slice(0, 4));
	const seriaMies = $derived(
		encje.map((k) => ({
			k,
			nazwa: nazwa(k, wymiar),
			mies: miesiecznie(wOkr.filter((p) => klucz(p, wymiar) === k), okres)
		}))
	);
	const goraWspolna = $derived(Math.max(0, ...seriaMies.flatMap((s) => s.mies.map((m) => m.s.przypis))));

	// ── Okresy ──
	type Para = 'kwartal' | 'miesiac' | 'rok';
	let para = $state<Para>('kwartal');
	function przesun(od: string, miesiecy: number): string {
		const [r, m] = od.split('-').map(Number);
		const t = new Date(Date.UTC(r, m - 1 + miesiecy, 1));
		return t.toISOString().slice(0, 10);
	}
	function dodajDni(d: string, n: number): string {
		const t = new Date(d + 'T00:00:00Z');
		t.setUTCDate(t.getUTCDate() + n);
		return t.toISOString().slice(0, 10);
	}
	const okresyPary = $derived.by((): { a: Okres; b: Okres } => {
		const [r, m] = dzis.split('-').map(Number);
		if (para === 'rok') {
			const b: Okres = { od: `${r}-01-01`, do: dzis, etykieta: `${r} do ${dzien(dzis, false)}` };
			return { a: { ...rokWczesniej(b), etykieta: `${r - 1} do ${dzien(dzis, false)}` }, b };
		}
		const krok = para === 'kwartal' ? 3 : 1;
		const startB = para === 'kwartal' ? `${r}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01` : `${r}-${String(m).padStart(2, '0')}-01`;
		const startA = przesun(startB, -krok);
		const dni = dateDiffDays(startB, dzis);
		const koniecA = dodajDni(startA, dni) < startB ? dodajDni(startA, dni) : dodajDni(startB, -1);
		const nazwaOkresu = (od: string) => (para === 'kwartal' ? `${Math.floor((Number(od.slice(5, 7)) - 1) / 3) + 1} kw. ${od.slice(0, 4)}` : miesiacPelny(od.slice(0, 7)).toLowerCase());
		return {
			a: { od: startA, do: koniecA, etykieta: `${nazwaOkresu(startA)} (do ${dzien(koniecA, false)})` },
			b: { od: startB, do: dzis, etykieta: `${nazwaOkresu(startB)} (do ${dzien(dzis, false)})` }
		};
	});
	const rokDostepny = $derived(!!najstarsza && najstarsza <= `${Number(dzis.slice(0, 4)) - 1}-01-01`);
	const sA = $derived(sumuj(polisyLiczone.filter((p) => wOkresie(p.data_od, okresyPary.a))));
	const sB = $derived(sumuj(polisyLiczone.filter((p) => wOkresie(p.data_od, okresyPary.b))));
	const kpiOkresow = $derived([
		{ etykieta: 'Przypis składki', teraz: zl(sB.przypis), wczesniej: zl(sA.przypis), d: zmiana(sB.przypis, sA.przypis) },
		{ etykieta: 'Prowizja przypisana', teraz: zl(sB.prowizja), wczesniej: zl(sA.prowizja), d: zmiana(sB.prowizja, sA.prowizja) },
		{ etykieta: 'Nowe polisy', teraz: liczba(sB.polisy), wczesniej: liczba(sA.polisy), d: zmiana(sB.polisy, sA.polisy) },
		{ etykieta: 'Efektywna stawka', teraz: proc(sB.przypis ? (sB.prowizja / sB.przypis) * 100 : 0), wczesniej: proc(sA.przypis ? (sA.prowizja / sA.przypis) * 100 : 0), d: null }
	]);
	const tuOkresow = $derived.by(() => {
		const ga = grupuj(polisyLiczone.filter((p) => wOkresie(p.data_od, okresyPary.a)), (p) => p.tu_id);
		const gb = grupuj(polisyLiczone.filter((p) => wOkresie(p.data_od, okresyPary.b)), (p) => p.tu_id);
		const klucze = [...new Set([...ga.keys(), ...gb.keys()])];
		return klucze
			.map((k) => ({ k, nazwa: nazwaTuWg.get(k) ?? '—', a: ga.get(k)?.przypis ?? 0, b: gb.get(k)?.przypis ?? 0 }))
			.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
			.slice(0, 10);
	});
	const skalaOkresow = $derived(podzialki(Math.max(0, ...tuOkresow.flatMap((t) => [t.a, t.b]))));
	const zmianaTekst = (d: number | null) => (d == null ? 'nowe' : `${d >= 0 ? '+' : '−'}${proc(Math.abs(d), 0)}`);
</script>

<svelte:head><title>Porównania — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Porównania</h1>
		<p class="text-sm text-ink-3 mt-0.5">
			{wymiar === 'okres' ? `${okresyPary.b.etykieta} wobec ${okresyPary.a.etykieta}` : `${WYMIARY.find((w) => w[0] === wymiar)?.[1]} obok siebie · ${okres.etykieta}`}
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/statystyki" class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2"><ChartColumn size={16} class="text-ink-3" /> Statystyki</a>
		<a href="/raporty" class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover"><FileChartColumn size={16} /> Raporty</a>
	</div>
</div>

<!-- Sterowanie -->
<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 mb-4 bg-white border border-line rounded-xl">
	<span class="text-[13px] font-semibold text-ink-2">Porównuj</span>
	<div role="group" aria-label="Co porównujesz" class="flex p-0.5 rounded-lg bg-surface-2 border border-line-soft overflow-x-auto">
		{#each WYMIARY as [k, l]}
			<button aria-pressed={wymiar === k} onclick={() => (wymiar = k)} class="h-7 px-3 rounded-md text-[13px] whitespace-nowrap {wymiar === k ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">{l}</button>
		{/each}
	</div>
	{#if wymiar !== 'okres'}
		<span aria-hidden="true" class="hidden sm:block w-px h-6 bg-line"></span>
		<div class="flex flex-wrap items-center gap-1.5">
			{#each encje as k (k)}
				<span class="inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-lg border border-line bg-white text-[13px] font-medium text-ink">
					{nazwa(k, wymiar)}
					<button onclick={() => usun(k)} aria-label="Usuń z porównania: {nazwa(k, wymiar)}" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={12} /></button>
				</span>
			{/each}
			{#if encje.length < 4 && dostepne.some((k) => !encje.includes(k))}
				<label class="relative inline-flex items-center h-8 px-2.5 rounded-lg border border-dashed border-[#C4CAD4] text-[13px] font-medium text-ink-2 hover:bg-surface-2 focus-within:ring-2 focus-within:ring-accent/40">
					<Plus size={14} class="mr-1" /> Dodaj
					<select aria-label="Dodaj do porównania" value="" onchange={(e) => { dodaj((e.currentTarget as HTMLSelectElement).value); (e.currentTarget as HTMLSelectElement).value = ''; }} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
						<option value="">Wybierz…</option>
						{#each dostepne.filter((k) => !encje.includes(k)) as k}<option value={k}>{nazwa(k, wymiar)}</option>{/each}
					</select>
				</label>
			{/if}
		</div>
		<label class="sm:ml-auto relative inline-flex items-center h-8 rounded-lg border border-line bg-white text-[13px] font-medium text-ink focus-within:ring-2 focus-within:ring-accent/40">
			<span aria-hidden="true" class="px-2.5 whitespace-nowrap">{PRESETY.find((p) => p[0] === preset)?.[1]}</span>
			<span class="sr-only">Okres</span>
			<select bind:value={preset} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
				{#each PRESETY as [id, label]}<option value={id}>{label}</option>{/each}
			</select>
		</label>
	{:else}
		<span aria-hidden="true" class="hidden sm:block w-px h-6 bg-line"></span>
		<div role="group" aria-label="Okresy" class="flex flex-wrap gap-1.5">
			{#each [['kwartal', 'Kwartał do kwartału'], ['miesiac', 'Miesiąc do miesiąca'], ['rok', 'Rok do roku']] as [k, l]}
				{@const zablokowany = k === 'rok' && !rokDostepny}
				<button
					aria-pressed={para === k}
					disabled={zablokowany}
					title={zablokowany && najstarsza ? `Historia polis sięga ${dzien(najstarsza)}` : undefined}
					onclick={() => (para = k as Para)}
					class="h-8 px-3 rounded-lg text-[13px] border disabled:opacity-50 disabled:cursor-not-allowed {para === k ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-ink-2 border-line font-medium hover:bg-surface-2'}"
				>{l}{zablokowany ? ' · brak danych' : ''}</button>
			{/each}
		</div>
	{/if}
</div>

{#if wymiar !== 'okres'}
	{#if encje.length === 0}
		<div class="bg-white border border-line rounded-xl px-4 py-12 text-center text-sm text-ink-3">Brak polis w okresie — wybierz dłuższy okres.</div>
	{:else}
		<!-- Macierz -->
		<section aria-labelledby="por-macierz" class="bg-white border border-line rounded-xl overflow-hidden mb-4">
			<div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-soft">
				<div class="flex-1 min-w-[220px]">
					<h2 id="por-macierz" class="text-[15px] font-semibold text-ink">Wskaźniki obok siebie</h2>
					<span class="text-xs text-ink-3">pasek pokazuje wartość względem najwyższej w wierszu</span>
				</div>
				<span class="flex gap-3 text-xs text-ink-2">
					<span class="flex items-center gap-1"><Award size={14} class="text-ok" /> najlepszy w wierszu</span>
					<span class="flex items-center gap-1"><AlertTriangle size={14} class="text-warn" /> wymaga uwagi</span>
				</span>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full min-w-[640px] table-fixed text-[13px]">
					<thead>
						<tr class="bg-surface-2 text-ink-2 text-left">
							<th class="px-4 py-2.5 font-semibold w-[200px]">Wskaźnik</th>
							{#each kolumnyMacierzy as c (c.k)}
								<th class="px-4 py-2.5 font-semibold">
									<span class="block text-ink">{c.nazwa}</span>
									<span class="block text-xs font-normal text-ink-3">{odmiana(c.polisy, 'polisa', 'polisy', 'polis')}</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each WIERSZE as w}
							{@const maks = Math.max(0, ...kolumnyMacierzy.map(w.wartosc))}
							<tr class="border-t border-line-soft align-top">
								<th scope="row" class="px-4 py-2.5 text-left font-normal">
									<span class="block font-medium text-ink">{w.etykieta}</span>
									<span class="block text-xs text-ink-3">{w.podpowiedz}</span>
								</th>
								{#each kolumnyMacierzy as c (c.k)}
									{@const o = ocena(w, c)}
									<td class="px-4 py-2.5">
										<span class="flex flex-wrap items-baseline gap-x-2">
											<span class="font-semibold text-ink tabular-nums">{w.fmt(c)}</span>
											{#if w.pod}<span class="text-xs text-ink-3">{w.pod(c)}</span>{/if}
											{#if o === 'best'}<span class="inline-flex items-center gap-0.5 text-xs font-semibold text-ok"><Award size={12} />najwyższa</span>{/if}
											{#if o === 'warn'}<span class="inline-flex items-center gap-0.5 text-xs font-semibold text-warn"><AlertTriangle size={12} />najwyższa</span>{/if}
										</span>
										<span aria-hidden="true" class="block mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
											<span class="block h-full rounded-full" style="width: {maks ? (w.wartosc(c) / maks) * 100 : 0}%; background: {o === 'warn' ? KOLOR.zly : KOLOR.seria}"></span>
										</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if wnioski.length}
				<div class="px-4 py-3 border-t border-line-soft bg-side flex flex-col gap-1.5">
					<span class="text-xs font-semibold text-ink-2">Wnioski</span>
					{#each wnioski as t}
						<span class="flex gap-2 text-[13px] text-ink"><span aria-hidden="true" class="w-1.5 h-1.5 rounded-full bg-accent mt-[7px] shrink-0"></span>{t}</span>
					{/each}
				</div>
			{/if}
			{#if wymiar === 'opiekun' && encje.includes('-')}
				<p class="px-4 py-2.5 border-t border-line-soft text-xs text-ink-3">„Bez opiekuna” to polisy klientów, którym nie przypisano opiekuna — przypisz ich na liście Klientów, żeby porównanie było pełne.</p>
			{/if}
		</section>

		<!-- Małe wykresy -->
		<section aria-labelledby="por-miesiace" class="bg-white border border-line rounded-xl px-4 pt-4 pb-3.5 flex flex-col gap-3.5">
			<div class="flex flex-wrap items-center gap-3">
				<div class="flex flex-col">
					<h2 id="por-miesiace" class="text-[15px] font-semibold text-ink">Przypis miesięcznie — obok siebie</h2>
					<span class="text-xs text-ink-3">{wspolnaSkala ? 'wspólna skala — wysokości porównywalne między wykresami' : 'własna skala każdego wykresu — widać rytm, nie wielkość'}</span>
				</div>
				<div role="group" aria-label="Skala" class="sm:ml-auto flex p-0.5 rounded-lg bg-surface-2 border border-line-soft">
					<button aria-pressed={wspolnaSkala} onclick={() => (wspolnaSkala = true)} class="h-7 px-3 rounded-md text-[13px] {wspolnaSkala ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">Wspólna</button>
					<button aria-pressed={!wspolnaSkala} onclick={() => (wspolnaSkala = false)} class="h-7 px-3 rounded-md text-[13px] {!wspolnaSkala ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">Własna</button>
				</div>
				<div role="group" aria-label="Widok" class="flex p-0.5 rounded-lg bg-surface-2 border border-line-soft">
					{#each [['wykres', 'Wykres'], ['tabela', 'Tabela']] as [k, l]}
						<button aria-pressed={widok === k} onclick={() => (widok = k as typeof widok)} class="h-7 px-3 rounded-md text-[13px] {widok === k ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">{l}</button>
					{/each}
				</div>
			</div>
			{#if widok === 'wykres'}
				<div class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))]">
					{#each seriaMies as s (s.k)}
						{@const razem = s.mies.reduce((a, m) => a + m.s.przypis, 0)}
						<div class="flex flex-col gap-2 min-w-0">
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-[13px] font-semibold text-ink truncate">{s.nazwa}</span>
								<span class="text-xs text-ink-2 tabular-nums whitespace-nowrap">{zlKrotko(razem)}</span>
							</div>
							<Kolumny
								opis="Przypis miesięcznie: {s.nazwa}"
								wysokosc={150}
								gora={wspolnaSkala ? goraWspolna : undefined}
								dane={s.mies.map(({ ym, s: m }) => ({
									klucz: ym,
									etykieta: miesiacKrotko(ym, kilkaLat).slice(0, kilkaLat ? 6 : 3),
									pelna: miesiacPelny(ym),
									wartosc: m.przypis,
									dodatek: odmiana(m.polisy, 'polisa', 'polisy', 'polis'),
									jasna: ym === dzis.slice(0, 7) && okres.do === dzis
								}))}
							/>
						</div>
					{/each}
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[480px] text-[13px]">
						<thead>
							<tr class="bg-surface-2 text-ink-2 text-left">
								<th class="px-3 py-2 font-semibold">Miesiąc</th>
								{#each seriaMies as s (s.k)}<th class="px-3 py-2 font-semibold text-right">{s.nazwa}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each seriaMies[0]?.mies ?? [] as m, i (m.ym)}
								<tr class="border-t border-line-soft">
									<td class="px-3 py-1.5">{miesiacPelny(m.ym)}</td>
									{#each seriaMies as s (s.k)}<td class="px-3 py-1.5 text-right tabular-nums">{zl(s.mies[i].s.przypis)}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
{:else}
	<!-- Dwa okresy -->
	<section aria-label="Wskaźniki okresów" class="grid grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] gap-3 mb-4">
		{#each kpiOkresow as k}
			<div class="px-4 py-3.5 rounded-xl bg-white border border-line flex flex-col gap-1">
				<span class="text-[13px] text-ink-2">{k.etykieta}</span>
				<span class="flex items-baseline gap-2 flex-wrap">
					<span class="text-[26px] leading-8 font-semibold text-ink">{k.teraz}</span>
					{#if k.d != null}
						<span class="inline-flex items-center gap-0.5 text-xs font-semibold {k.d >= 0 ? 'text-ok' : 'text-danger'}">
							{#if k.d >= 0}<ArrowUpRight size={14} />{:else}<ArrowDownRight size={14} />{/if}{zmianaTekst(k.d)}
						</span>
					{/if}
				</span>
				<span class="text-xs text-ink-3">wcześniej {k.wczesniej}</span>
			</div>
		{/each}
	</section>

	<section aria-labelledby="por-okresy" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
		<div class="flex flex-wrap items-start gap-2">
			<div class="flex-1 min-w-[220px]">
				<h2 id="por-okresy" class="text-[15px] font-semibold text-ink">Przypis według towarzystw</h2>
				<span class="text-xs text-ink-3">towarzystwa z przypisem w którymkolwiek z dwóch okresów · ten sam odcinek czasu</span>
			</div>
			<span class="flex gap-3 text-xs text-ink-2">
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background: {KOLOR.seriaJasna}"></span>{okresyPary.a.etykieta}</span>
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background: {KOLOR.seria}"></span>{okresyPary.b.etykieta}</span>
			</span>
		</div>
		{#if tuOkresow.length === 0}
			<p class="py-6 text-center text-sm text-ink-3">W obu okresach nie ma polis.</p>
		{:else}
			<div aria-hidden="true" class="hidden sm:grid grid-cols-[130px_minmax(0,1fr)_190px] gap-3">
				<span></span>
				<span class="relative h-4">
					{#each skalaOkresow.kroki as t}
						<span class="absolute -translate-x-1/2 text-xs text-ink-3 tabular-nums whitespace-nowrap" style="left: {(t / skalaOkresow.gora) * 100}%">{etykietaOsi(t, true)}</span>
					{/each}
				</span>
				<span></span>
			</div>
			<ul class="flex flex-col gap-2.5">
				{#each tuOkresow as t (t.k)}
					{@const a = (t.a / skalaOkresow.gora) * 100}
					{@const b = (t.b / skalaOkresow.gora) * 100}
					{@const d = zmiana(t.b, t.a)}
					<li class="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)_190px] items-center gap-x-3 gap-y-0.5 text-[13px]" title="{t.nazwa}: {zl(t.a)} → {zl(t.b)}">
						<span class="truncate text-ink">{t.nazwa}</span>
						<span aria-hidden="true" class="relative h-4">
							{#each skalaOkresow.kroki as k}
								<span class="absolute inset-y-0 w-px" style="left: {(k / skalaOkresow.gora) * 100}%; background: {KOLOR.siatka}"></span>
							{/each}
							<span class="absolute top-1/2 h-0.5 -translate-y-1/2" style="left: {Math.min(a, b)}%; width: {Math.abs(a - b)}%; background: {KOLOR.os}"></span>
							<span class="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style="left: {a}%; background: {KOLOR.seriaJasna}"></span>
							<span class="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style="left: {b}%; background: {KOLOR.seria}"></span>
						</span>
						<span class="col-start-2 sm:col-start-auto text-xs tabular-nums sm:text-right whitespace-nowrap text-ink-2">
							{zlKrotko(t.a)} → <span class="font-semibold text-ink">{zlKrotko(t.b)}</span>
							<span class="{d == null ? 'text-ink-3' : d >= 0 ? 'text-ok' : 'text-danger'} font-semibold">{d == null ? (t.b > 0 ? 'nowe' : '') : zmianaTekst(d)}</span>
						</span>
					</li>
				{/each}
			</ul>
			<div class="flex flex-wrap justify-between gap-2 border-t border-line-soft pt-3 text-[13px] text-ink-2">
				<span>Razem: {zl(sA.przypis)} → <span class="font-semibold text-ink">{zl(sB.przypis)}</span></span>
				<span>{odmiana(sA.polisy, 'polisa', 'polisy', 'polis')} → {odmiana(sB.polisy, 'polisa', 'polisy', 'polis')}</span>
			</div>
		{/if}
	</section>
{/if}
