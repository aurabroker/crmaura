<script lang="ts">
	// Odnowienia: lista robocza polis kończących się w najbliższych tygodniach — do odnowienia,
	// już odnowione i te, które wygasły bez następczyni (ostatnie 90 dni).
	import { appState } from '$lib/stores/app.svelte';
	import { dateDiffDays, fmtDzien, fmtPln, fmtTermin, odmiana, todayStr } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import { Search, Eye, ExternalLink, RefreshCw, Pencil, User, Copy, X, Download, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, ctxToast, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import type { Policy, RenewalRow } from '$lib/types/database';
	import { sb } from '$lib/supabase';
	import CrmRenewalBadge from '$lib/components/renewal/CrmRenewalBadge.svelte';
	import { czyAktywny, wProgramieOcBeauty } from '$lib/components/renewal/crmRenewals';
	import { nazwaRodzaju, nazwaTu } from '$lib/statusPolisy';
	import { logAudit } from '$lib/utils/audit';

	const dzis = todayStr();
	/** Ile dni po końcu ochrony polisa bez następczyni zostaje na liście. */
	const WSTECZ = 90;

	// Wnioski o odnowienie (program OC beauty): najnowszy na polisę. Przed migracją tabeli
	// zapytanie zwraca błąd — wtedy kolumna i filtr się nie pokazują.
	type WniosekSkrot = Pick<RenewalRow, 'polisa_id' | 'status' | 'decyzja' | 'wyslano_at' | 'zlozono_at' | 'created_at'>;
	let wnioski = $state<Map<string, WniosekSkrot> | null>(null);

	$effect(() => {
		let anulowane = false;
		(async () => {
			try {
				let q = sb.from('crm_renewals').select('polisa_id,status,decyzja,wyslano_at,zlozono_at,created_at');
				const tid = appState.profile?.tenant_id;
				if (tid) q = q.eq('tenant_id', tid);
				const { data, error } = await q.order('created_at', { ascending: false });
				if (anulowane || error) return;
				const m = new Map<string, WniosekSkrot>();
				for (const r of (data ?? []) as WniosekSkrot[]) if (!m.has(r.polisa_id)) m.set(r.polisa_id, r);
				wnioski = m;
			} catch {
				// brak tabeli albo sieci — strona działa bez kolumny wniosków
			}
		})();
		return () => (anulowane = true);
	});

	const programIds = $derived(new Set(appState.policies.filter((p) => wProgramieOcBeauty(p, appState.policies)).map((p) => p.id)));
	/** Następczyni polisy: nieusunięta polisa z renewal_of wskazującym na nią. */
	const nastepczyni = $derived.by(() => {
		const m = new Map<string, Policy>();
		for (const q of appState.policies) if (q.renewal_of && !q.deleted_at) m.set(q.renewal_of, q);
		return m;
	});
	const dni = (p: Policy) => dateDiffDays(dzis, p.data_do);

	// Certyfikat programu kończący się w ciągu 45 dni, bez aktywnego wniosku i jeszcze nieodnowiony.
	function bezWniosku(p: Policy): boolean {
		if (!wnioski || !programIds.has(p.id) || nastepczyni.has(p.id)) return false;
		const d = dni(p);
		if (d < 0 || d > 45) return false;
		const w = wnioski.get(p.id);
		return !w || !czyAktywny(w.status) || (w.status === 'utworzony' && !w.wyslano_at);
	}

	type Stan = 'do_odnowienia' | 'wygasla' | 'odnowiona';
	function stan(p: Policy): Stan {
		if (nastepczyni.has(p.id)) return 'odnowiona';
		return dni(p) < 0 ? 'wygasla' : 'do_odnowienia';
	}
	function chip(p: Policy): { tekst: string; cls: string } {
		const s = stan(p);
		if (s === 'odnowiona') return { tekst: 'Odnowiona', cls: 'bg-ok-soft text-ok' };
		if (s === 'wygasla') return { tekst: 'Wygasła', cls: 'bg-danger-soft text-danger' };
		return dni(p) <= 30 ? { tekst: 'Do odnowienia', cls: 'bg-warn-soft text-warn' } : { tekst: 'Do odnowienia', cls: 'bg-surface-2 text-ink-2' };
	}
	function termin(p: Policy): { tekst: string; cls: string } {
		const d = dni(p);
		if (d < 0) return { tekst: `${odmiana(-d, 'dzień', 'dni', 'dni')} temu`, cls: stan(p) === 'odnowiona' ? 'text-ink-3' : 'text-danger font-semibold' };
		if (stan(p) === 'odnowiona') return { tekst: fmtTermin(p.data_do, dzis), cls: 'text-ink-3' };
		return { tekst: fmtTermin(p.data_do, dzis), cls: d <= 14 ? 'text-warn font-semibold' : 'text-ink-2' };
	}

	// Okno: ile dni naprzód patrzymy (wstecz zawsze WSTECZ dni).
	const OKNA = [30, 60, 90, 180] as const;
	type Okno = (typeof OKNA)[number];
	let okno = $state<Okno>(60);
	const kandydaci = $derived(
		appState.policies.filter((p) => !p.deleted_at && !!p.data_do && dni(p) >= -WSTECZ && dni(p) <= 180)
	);
	const wOknie = $derived(kandydaci.filter((p) => dni(p) <= okno));

	type Segment = Stan | 'wszystkie';
	let segment = $state<Segment>('do_odnowienia');
	const SEGMENTY: [Segment, string][] = [['do_odnowienia', 'Do odnowienia'], ['wygasla', 'Wygasłe bez odnowienia'], ['odnowiona', 'Odnowione'], ['wszystkie', 'Wszystkie']];
	const wSegmencie = (p: Policy, s: Segment) => s === 'wszystkie' || stan(p) === s;

	// Podsumowanie (stałe przedziały, niezależne od filtrów)
	const sumaSkladek = (lista: Policy[]) => lista.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0);
	const doOdnowienia = $derived(kandydaci.filter((p) => stan(p) === 'do_odnowienia'));
	const w30 = $derived(doOdnowienia.filter((p) => dni(p) <= 30));
	const w14 = $derived(w30.filter((p) => dni(p) <= 14));
	const w31_90 = $derived(doOdnowienia.filter((p) => dni(p) > 30 && dni(p) <= 90));
	const wygasle = $derived(kandydaci.filter((p) => stan(p) === 'wygasla'));
	const zakonczone90 = $derived(kandydaci.filter((p) => dni(p) < 0));
	const odnowione90 = $derived(zakonczone90.filter((p) => nastepczyni.has(p.id)));
	const wskaznik = $derived(zakonczone90.length ? Math.round((odnowione90.length / zakonczone90.length) * 100) : null);

	// Filtry
	let search = $state('');
	let fTu = $state('');
	let fRodzaj = $state('');
	let fOpiekun = $state('');
	let tylkoBezWniosku = $state(false);
	const ileFiltrow = $derived([fTu, fRodzaj, fOpiekun].filter(Boolean).length + (tylkoBezWniosku ? 1 : 0));
	function wyczyscFiltry() { fTu = ''; fRodzaj = ''; fOpiekun = ''; search = ''; tylkoBezWniosku = false; }
	const opiekunKlienta = $derived(new Map(appState.clients.map((c) => [c.id, c.opiekun_id])));
	const opiekunWg = $derived(new Map(appState.brokers.map((b) => [b.id, b.imie_nazwisko || b.email])));
	const nazwaOpiekuna = (p: Policy) => {
		const id = opiekunKlienta.get(p.klient_id);
		return id ? (opiekunWg.get(id) ?? null) : null;
	};
	const towarzystwa = $derived(
		appState.insurers.filter((i) => wOknie.some((p) => p.tu_id === i.id)).sort((a, b) => (a.skrot || a.nazwa).localeCompare(b.skrot || b.nazwa, 'pl'))
	);
	const rodzaje = $derived([...new Set(wOknie.map((p) => p.rodzaj).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')));
	const opiekunowie = $derived([...appState.brokers].sort((a, b) => (a.imie_nazwisko || a.email).localeCompare(b.imie_nazwisko || b.email, 'pl')));
	const bezWnioskuCount = $derived(wnioski ? kandydaci.filter(bezWniosku).length : 0);

	const poFiltrach = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return wOknie.filter((p) => {
			if (fTu && p.tu_id !== fTu) return false;
			if (fRodzaj && p.rodzaj !== fRodzaj) return false;
			if (fOpiekun && (fOpiekun === '-' ? !!opiekunKlienta.get(p.klient_id) : opiekunKlienta.get(p.klient_id) !== fOpiekun)) return false;
			if (tylkoBezWniosku && !bezWniosku(p)) return false;
			return !q || p.nr_polisy.toLowerCase().includes(q) || (p.crm_clients?.nazwa ?? '').toLowerCase().includes(q) || (p.przedmiot ?? '').toLowerCase().includes(q);
		});
	});
	const liczSeg = $derived(Object.fromEntries(SEGMENTY.map(([id]) => [id, poFiltrach.filter((p) => wSegmencie(p, id)).length])) as Record<Segment, number>);
	const widoczne = $derived(poFiltrach.filter((p) => wSegmencie(p, segment)));

	// Domyślnie wg daty końca rosnąco (najwcześniej kończące się na górze)
	const sort = new Sortowanie<Policy>({
		do: (p) => p.data_do,
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		opiekun: (p) => nazwaOpiekuna(p) ?? '',
		status: (p) => chip(p).tekst
	}, { klucz: 'do', kierunek: 'asc' }, 'odnowienia');
	const wiersze = $derived(sort.sortuj(widoczne));
	const sumaWidocznych = $derived(sumaSkladek(widoczne));

	const NA_STRONE = 50;
	let strona = $state(0);
	const stron = $derived(Math.max(1, Math.ceil(wiersze.length / NA_STRONE)));
	$effect(() => {
		void segment; void search; void fTu; void fRodzaj; void fOpiekun; void okno; void tylkoBezWniosku; void sort.klucz; void sort.kierunek;
		strona = 0;
	});
	const naStronie = $derived(wiersze.slice(strona * NA_STRONE, (strona + 1) * NA_STRONE));
	const zakres = $derived(wiersze.length === 0 ? '0 z 0' : `${strona * NA_STRONE + 1}–${Math.min((strona + 1) * NA_STRONE, wiersze.length)} z ${wiersze.length.toLocaleString('pl-PL')}`);

	function pokaz(s: Segment, o?: Okno) {
		segment = s;
		if (o) okno = o;
	}

	const odnowUrl = (p: Policy) => `/policies/${p.id}?odnow=1`;
	const moznaOdnowic = (p: Policy) => stan(p) !== 'odnowiona' && p.typ_umowy !== 'generalna';

	function renewalMenu(p: Policy): CtxItem[] {
		const n = nastepczyni.get(p.id);
		return [
			{ label: 'Otwórz polisę', icon: Eye, onSelect: () => goto(`/policies/${p.id}`) },
			{ label: 'Otwórz w nowej karcie', icon: ExternalLink, onSelect: () => window.open(`/policies/${p.id}`, '_blank', 'noopener') },
			{ separator: true },
			n
				? { label: `Otwórz odnowienie ${n.nr_polisy}`, icon: RefreshCw, onSelect: () => goto(`/policies/${n.id}`) }
				: { label: 'Odnów polisę', icon: RefreshCw, disabled: p.typ_umowy === 'generalna', onSelect: () => goto(odnowUrl(p)) },
			{ label: 'Edytuj', icon: Pencil, onSelect: () => goto(`/policies/${p.id}/edit`) },
			{ separator: true },
			{ label: 'Karta klienta', icon: User, disabled: !p.klient_id, onSelect: () => goto(`/clients/${p.klient_id}`) },
			{ label: 'Kopiuj nr polisy', icon: Copy, onSelect: () => ctxCopy(p.nr_polisy, 'nr polisy') }
		];
	}

	function eksportujCsv() {
		const pole = (v: string | number | null | undefined) => {
			const t = v == null ? '' : String(v);
			return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
		};
		const naglowek = ['Nr polisy', 'Klient', 'Towarzystwo', 'Rodzaj', 'Przedmiot', 'Od', 'Do', 'Dni do końca', 'Składka przypisana', 'Prowizja przypisana', 'Opiekun klienta', 'Status', 'Odnowiona polisą'];
		const linie = wiersze.map((p) => [
			p.nr_polisy, p.crm_clients?.nazwa, nazwaTu(p), nazwaRodzaju(p.rodzaj), p.przedmiot, p.data_od, p.data_do, dni(p),
			fmtPln(p.skladka_przypisana), fmtPln(p.prowizja_przypisana), nazwaOpiekuna(p), chip(p).tekst, nastepczyni.get(p.id)?.nr_polisy
		].map(pole).join(';'));
		const blob = new Blob(['﻿' + [naglowek.join(';'), ...linie].join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `odnowienia-${dzis}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		void logAudit('policies_exported', 'policy', null, odmiana(wiersze.length, 'polisa', 'polisy', 'polis'), { ids: wiersze.map((p) => p.id), widok: 'odnowienia' });
		ctxToast(`Wyeksportowano: ${odmiana(wiersze.length, 'polisa', 'polisy', 'polis')}`);
	}
</script>

<svelte:head><title>Odnowienia — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Odnowienia</h1>
		<p class="text-sm text-ink-3 mt-0.5">Polisy kończące się w najbliższych tygodniach i te, które wygasły bez odnowienia</p>
	</div>
	<button onclick={eksportujCsv} disabled={wiersze.length === 0} class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-50">
		<Download size={16} class="text-ink-3" /> Eksportuj CSV
	</button>
</div>

<!-- Podsumowanie -->
<section aria-label="Podsumowanie odnowień" class="grid grid-cols-2 lg:grid-cols-4 bg-white border border-line rounded-xl overflow-hidden mb-4">
	<button onclick={() => pokaz('do_odnowienia', 30)} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-r border-b lg:border-b-0 border-line-soft hover:bg-bg min-w-0">
		<span class="text-xs text-ink-3">Do odnowienia w 30 dni</span>
		<span class="text-xl font-semibold tabular-nums text-ink">{w30.length} <span class="text-[13px] font-normal text-ink-3 whitespace-nowrap">· {fmtPln(sumaSkladek(w30))} zł</span></span>
		{#if w14.length > 0}
			<span class="text-xs font-semibold text-warn">{odmiana(w14.length, 'polisa', 'polisy', 'polis')} w ciągu 14 dni</span>
		{:else}
			<span class="text-xs text-ink-2">nic w ciągu 14 dni</span>
		{/if}
	</button>
	<button onclick={() => pokaz('do_odnowienia', 90)} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-b lg:border-b-0 lg:border-r border-line-soft hover:bg-bg min-w-0">
		<span class="text-xs text-ink-3">Do odnowienia w 31–90 dni</span>
		<span class="text-xl font-semibold tabular-nums text-ink">{w31_90.length} <span class="text-[13px] font-normal text-ink-3 whitespace-nowrap">· {fmtPln(sumaSkladek(w31_90))} zł</span></span>
		<span class="text-xs text-ink-2">czas na zebranie ofert</span>
	</button>
	<button onclick={() => pokaz('wygasla')} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-r border-line-soft hover:bg-bg min-w-0">
		<span class="text-xs text-ink-3">Wygasłe bez odnowienia</span>
		<span class="text-xl font-semibold tabular-nums {wygasle.length ? 'text-danger' : 'text-ink'}">{wygasle.length} <span class="text-[13px] font-normal text-ink-3 whitespace-nowrap">· {fmtPln(sumaSkladek(wygasle))} zł</span></span>
		<span class="text-xs text-ink-2">w ostatnich {WSTECZ} dniach</span>
	</button>
	<button onclick={() => pokaz('odnowiona')} class="text-left px-4 py-3.5 flex flex-col gap-0.5 hover:bg-bg min-w-0" title="Udział polis zakończonych w ostatnich {WSTECZ} dniach, które mają w CRM polisę odnawiającą">
		<span class="text-xs text-ink-3">Wskaźnik odnowień</span>
		<span class="text-xl font-semibold tabular-nums text-ink">{wskaznik != null ? `${wskaznik}%` : '—'}</span>
		<span class="text-xs text-ink-2">{zakonczone90.length ? `${odnowione90.length} z ${odmiana(zakonczone90.length, 'polisy zakończonej', 'polis zakończonych', 'polis zakończonych')} w ${WSTECZ} dni` : `brak polis zakończonych w ${WSTECZ} dni`}</span>
	</button>
</section>

<!-- Segmenty -->
<div role="tablist" aria-label="Segmenty odnowień" class="flex gap-x-5 border-b border-line mb-3 overflow-x-auto">
	{#each SEGMENTY as [id, label]}
		<button
			role="tab"
			aria-selected={segment === id}
			onclick={() => (segment = id)}
			class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
				{segment === id ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
		>
			{label}
			{#if id === 'wygasla' && liczSeg[id] > 0}
				<span class="ml-0.5 px-1.5 rounded-full bg-danger-soft text-danger text-xs font-semibold leading-5 tabular-nums">{liczSeg[id]}</span>
			{:else}
				<span class="font-normal text-ink-3 tabular-nums">{liczSeg[id].toLocaleString('pl-PL')}</span>
			{/if}
		</button>
	{/each}
</div>

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<label class="w-full sm:w-auto sm:flex-[1_1_280px] sm:max-w-[420px] h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
		<Search size={16} class="text-ink-3 shrink-0" />
		<span class="sr-only">Filtruj listę</span>
		<input bind:value={search} placeholder="Nr polisy, klient, przedmiot…" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
		{#if search}
			<button onclick={() => (search = '')} aria-label="Wyczyść wyszukiwanie" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={14} /></button>
		{/if}
	</label>
	<!-- Okno czasu: zawsze ustawione, więc bez przycisku czyszczenia. -->
	<span class="relative inline-flex items-center h-9 rounded-lg text-[13px] font-medium border border-line bg-white text-ink focus-within:ring-2 focus-within:ring-accent/40">
		<span aria-hidden="true" class="px-2.5 whitespace-nowrap">Koniec w {okno} dni</span>
		<select aria-label="Koniec ochrony w ciągu" value={String(okno)} onchange={(e) => (okno = Number((e.currentTarget as HTMLSelectElement).value) as Okno)} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
			{#each OKNA as o}<option value={String(o)}>Koniec w {o} dni</option>{/each}
		</select>
	</span>
	{#snippet filtr(etykieta: string, tekst: string | null, wyczysc: () => void, opcje: Snippet, wartosc: string, ustaw: (v: string) => void)}
		<!-- Widoczna etykieta + niewidoczny natywny select na wierzchu: szerokość wybranej wartości, nie najdłuższej opcji. -->
		<span class="relative inline-flex items-center h-9 rounded-lg text-[13px] font-medium focus-within:ring-2 focus-within:ring-accent/40 {tekst ? 'border border-line bg-white text-ink pr-7' : 'border border-dashed border-[#C4CAD4] text-ink-2 hover:bg-white'}">
			<span aria-hidden="true" class="px-2.5 max-w-[240px] truncate whitespace-nowrap">{tekst ?? `+ ${etykieta}`}</span>
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
		{#each opiekunowie as b}<option value={b.id}>{b.imie_nazwisko || b.email}{b.id === appState.profile?.id ? ' (ja)' : ''}</option>{/each}
		<option value="-">Klient bez opiekuna</option>
	{/snippet}
	{@render filtr('Towarzystwo', fTu ? `TU: ${towarzystwa.find((t) => t.id === fTu)?.skrot || towarzystwa.find((t) => t.id === fTu)?.nazwa || '—'}` : null, () => (fTu = ''), opcjeTu, fTu, (v) => (fTu = v))}
	{@render filtr('Rodzaj', fRodzaj ? `Rodzaj: ${nazwaRodzaju(fRodzaj)}` : null, () => (fRodzaj = ''), opcjeRodzaj, fRodzaj, (v) => (fRodzaj = v))}
	{@render filtr('Opiekun', fOpiekun ? (fOpiekun === '-' ? 'Klient bez opiekuna' : `Opiekun: ${opiekunWg.get(fOpiekun) ?? '—'}`) : null, () => (fOpiekun = ''), opcjeOpiekun, fOpiekun, (v) => (fOpiekun = v))}
	{#if wnioski && programIds.size > 0}
		<button
			onclick={() => (tylkoBezWniosku = !tylkoBezWniosku)}
			aria-pressed={tylkoBezWniosku}
			title="Certyfikaty programu OC beauty kończące się w ciągu 45 dni, bez aktywnego wniosku o odnowienie"
			class="h-9 px-2.5 rounded-lg text-[13px] font-medium transition-colors
				{tylkoBezWniosku ? 'border border-warn bg-warn-soft text-warn' : 'border border-dashed border-[#C4CAD4] text-ink-2 hover:bg-white'}"
		>
			Bez wysłanego wniosku <span class="tabular-nums">({bezWnioskuCount})</span>
		</button>
	{/if}
	{#if ileFiltrow > 0}
		<button onclick={wyczyscFiltry} class="h-9 px-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść</button>
	{/if}
</div>

<section aria-label="Lista odnowień" class="bg-white border border-line rounded-xl overflow-hidden">
	{#if wiersze.length === 0}
		<div class="px-4 py-12 text-center">
			<p class="text-sm text-ink-3">
				{segment === 'do_odnowienia' ? `Żadna polisa nie czeka na odnowienie w ciągu ${okno} dni.` : segment === 'wygasla' ? `Brak polis wygasłych bez odnowienia w ostatnich ${WSTECZ} dniach.` : 'Brak polis dla wybranych filtrów.'}
			</p>
			{#if ileFiltrow > 0 || search}
				<button onclick={wyczyscFiltry} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść filtry</button>
			{:else if segment === 'do_odnowienia' && okno < 180}
				<button onclick={() => (okno = 180)} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Pokaż 180 dni naprzód</button>
			{/if}
		</div>
	{:else}
		<!-- Telefon: karty -->
		<ul class="md:hidden divide-y divide-line-soft">
			{#each naStronie as p (p.id)}
				{@const st = chip(p)}
				{@const t = termin(p)}
				{@const n = nastepczyni.get(p.id)}
				<li use:ctxMenu={{ items: () => renewalMenu(p), title: p.nr_polisy }} class="flex items-start gap-3 px-4 py-3">
					<a href="/policies/{p.id}" class="flex-1 min-w-0">
						<span class="flex items-start justify-between gap-2">
							<span class="font-mono text-xs font-medium text-accent-text truncate pt-0.5">{p.nr_polisy}</span>
							<span class="shrink-0 h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {st.cls}">{st.tekst}</span>
						</span>
						<span class="block font-medium text-ink truncate">{p.crm_clients?.nazwa ?? '—'}</span>
						<span class="block text-xs text-ink-3">{nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)}</span>
						<span class="block mt-1 text-[13px] text-ink-2 tabular-nums">do {fmtDzien(p.data_do, true)} · <span class={t.cls}>{t.tekst}</span> · {fmtPln(p.skladka_przypisana)} zł</span>
						{#if n}<span class="block text-xs text-ink-3">odnowiona polisą <span class="font-mono">{n.nr_polisy}</span></span>{/if}
						{#if wnioski && programIds.has(p.id) && !n}
							{@const w = wnioski.get(p.id)}
							<span class="block mt-1">{#if w}<CrmRenewalBadge status={w.status} decyzja={w.decyzja} />{:else}<span class="text-xs text-ink-3">wniosek nie wysłany</span>{/if}</span>
						{/if}
					</a>
					{#if moznaOdnowic(p)}
						<a href={odnowUrl(p)} aria-label="Odnów polisę {p.nr_polisy}" title="Odnów" class="shrink-0 w-9 h-9 flex items-center justify-center border border-line rounded-lg text-ink-2 hover:bg-surface-2"><RefreshCw size={15} /></a>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Komputer: tabela -->
		<div class="hidden md:block overflow-x-auto">
			<table class="w-full min-w-[920px] text-[13px] text-left">
				<thead>
					<tr class="bg-surface-2 text-ink-2">
						<SortTh s={sort} k="do" wersaliki={false} class="pl-4 pr-3 py-2.5 font-semibold whitespace-nowrap">Koniec ochrony</SortTh>
						<SortTh s={sort} k="nr" wersaliki={false} class="px-3 py-2.5 font-semibold">Polisa</SortTh>
						<SortTh s={sort} k="klient" wersaliki={false} class="px-3 py-2.5 font-semibold">Klient</SortTh>
						<SortTh s={sort} k="skladka" wersaliki={false} align="right" class="px-3 py-2.5 font-semibold text-right">Składka</SortTh>
						<SortTh s={sort} k="opiekun" wersaliki={false} class="hidden xl:table-cell px-3 py-2.5 font-semibold">Opiekun</SortTh>
						<SortTh s={sort} k="status" wersaliki={false} class="px-3 py-2.5 font-semibold">Status</SortTh>
						<th class="px-3 py-2.5"><span class="sr-only">Akcje</span></th>
					</tr>
				</thead>
				<tbody>
					{#each naStronie as p (p.id)}
						{@const st = chip(p)}
						{@const t = termin(p)}
						{@const n = nastepczyni.get(p.id)}
						<tr use:ctxMenu={{ items: () => renewalMenu(p), title: p.nr_polisy }} class="border-t border-line-soft hover:bg-bg">
							<td class="pl-4 pr-3 py-2 whitespace-nowrap">
								<span class="block tabular-nums text-ink">{fmtDzien(p.data_do, true)}</span>
								<span class="block text-xs {t.cls}">{t.tekst}</span>
							</td>
							<td class="px-3 py-2 whitespace-nowrap">
								<a href="/policies/{p.id}" class="font-mono text-xs font-medium text-accent-text hover:underline">{p.nr_polisy}</a>
								<span class="block text-xs text-ink-3">{nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)}</span>
							</td>
							<td class="px-3 py-2 min-w-[160px] max-w-[240px]">
								<a href="/clients/{p.klient_id}" class="block truncate font-medium text-ink hover:text-accent-text">{p.crm_clients?.nazwa ?? '—'}</a>
								{#if p.przedmiot}<span class="block truncate text-xs text-ink-3" title={p.przedmiot}>{p.przedmiot}</span>{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(p.skladka_przypisana)} zł</td>
							<td class="hidden xl:table-cell px-3 py-2 max-w-[160px] truncate {nazwaOpiekuna(p) ? 'text-ink-2' : 'italic text-ink-3'}">{nazwaOpiekuna(p) ?? 'brak'}</td>
							<td class="px-3 py-2">
								<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {st.cls}">{st.tekst}</span>
								{#if n}<a href="/policies/{n.id}" class="block text-xs text-accent-text hover:underline whitespace-nowrap">→ <span class="font-mono">{n.nr_polisy}</span></a>{/if}
								{#if wnioski && programIds.has(p.id) && !n}
									<!-- Program OC beauty: stan wniosku klienta o odnowienie. -->
									{@const w = wnioski.get(p.id)}
									<span class="block mt-1 whitespace-nowrap" data-testid="kolumna-wniosek">
										{#if w}<CrmRenewalBadge status={w.status} decyzja={w.decyzja} />{:else}<span class="text-xs text-ink-3">wniosek nie wysłany</span>{/if}
									</span>
								{/if}
							</td>
							<td class="px-3 py-1.5 text-right whitespace-nowrap">
								{#if moznaOdnowic(p)}
									<a href={odnowUrl(p)} class="inline-flex h-8 items-center gap-1.5 px-2.5 border border-line rounded-lg bg-white text-[13px] font-medium text-ink hover:bg-surface-2"><RefreshCw size={14} class="text-ink-3" /> Odnów</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-line-soft text-[13px] text-ink-2">
		<span class="w-full sm:w-auto sm:flex-1 min-w-0 tabular-nums">
			{odmiana(widoczne.length, 'polisa', 'polisy', 'polis')} · składka <span class="font-semibold text-ink">{fmtPln(sumaWidocznych)} zł</span>
		</span>
		<span class="tabular-nums">{zakres}</span>
		<span class="flex gap-1">
			<button onclick={() => (strona = Math.max(0, strona - 1))} disabled={strona === 0} aria-label="Poprzednia strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronLeft size={14} /></button>
			<button onclick={() => (strona = Math.min(stron - 1, strona + 1))} disabled={strona >= stron - 1} aria-label="Następna strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronRight size={14} /></button>
		</span>
	</div>
</section>
