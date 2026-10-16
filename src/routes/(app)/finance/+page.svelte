<script lang="ts">
	// Rozliczenia prowizji na poziomie rat: wiersz = rata składki (termin, polisa, klient, TU, kwota, stawka,
	// prowizja oczekiwana) i jej rozliczenie — z noty TU (import na Płatnościach) albo ręczne (tutaj).
	// Składka i prowizja przypisana całej polisy są na karcie polisy i w Prowizji — tu liczą się raty.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState, isFinance } from '$lib/stores/app.svelte';
	import { wczytajPlatnosci, wczytajPolisy } from '$lib/kolekcje';
	import { fmtPln, fmtDzien, fmtTermin, odmiana, todayStr } from '$lib/utils';
	import {
		FILTRY_STANU, OKRESY, STAN_RATY_ETYKIETA, pasujeStan, podsumujRaty, prowizjaOczekiwana, statusPoRozliczeniu,
		wOkresie, wierszeRozliczen, zakresOkresu, zaokr, type FiltrStanu, type Okres, type WierszRaty
	} from '$lib/rozliczenia';
	import { otworzPlikNoty } from '$lib/plikiPolis';
	import { openStoredFile } from '$lib/utils/storageLink';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import type { CrmNota } from '$lib/types/database';
	import { Search, FileUp, CheckCircle, Eye, User, Copy, Undo2, FileText, AlertTriangle, ChevronDown } from 'lucide-svelte';

	onMount(() => {
		if (!isFinance(appState.profile)) goto('/dashboard');
		void wczytajNoty();
	});

	const dzis = todayStr();

	// ── Noty TU (numer, data, plik) do opisu rozliczonych rat i do podpowiedzi przy ręcznym rozliczeniu ──
	type NotaSkrot = Pick<CrmNota, 'id' | 'numer_noty' | 'tu_skrot' | 'data_zestawienia' | 'data_importu' | 'pozycji_count' | 'razem_skladka' | 'razem_prowizja'> & {
		file_url: string | null; plik_klucz: string | null; plik_nazwa: string | null; plik_typ: string | null;
	};
	let noty = $state<NotaSkrot[]>([]);
	const notaWg = $derived(new Map(noty.map((n) => [n.id, n])));
	async function wczytajNoty() {
		const { data } = await sb
			.from('crm_noty')
			.select('id, numer_noty, tu_skrot, data_zestawienia, data_importu, pozycji_count, razem_skladka, razem_prowizja, file_url, plik_klucz, plik_nazwa, plik_typ')
			.order('data_importu', { ascending: false });
		noty = (data ?? []) as NotaSkrot[];
	}
	async function otworzNote(n: NotaSkrot) {
		try {
			if (n.plik_klucz) await otworzPlikNoty(n.id, n.plik_nazwa, n.plik_typ);
			else if (n.file_url) await openStoredFile('settlement-files', n.file_url);
		} catch (e) {
			toast = { tekst: `Nie udało się otworzyć pliku noty: ${(e as Error)?.message ?? e}`, blad: true };
		}
	}

	// ── Filtry: okres terminów rat, TU, stan, szukaj ──
	let okres = $state<Okres>('miesiac');
	let miesiac = $state('');
	let filtrTu = $state('');
	let filtrStanu = $state<FiltrStanu>('wszystkie');
	let search = $state('');

	const wszystkie = $derived(wierszeRozliczen(appState.payments, appState.policies, dzis));
	const zakres = $derived(zakresOkresu(okres, dzis));
	const wOkresieRaty = $derived(wszystkie.filter((w) => wOkresie(w.rata.data_platnosci, zakres) && (!filtrTu || w.tu === filtrTu)));
	const podsumowanie = $derived(podsumujRaty(wOkresieRaty));
	// Zaległe raty spoza wybranego okresu — nie mogą zniknąć z oczu przez sam filtr miesiąca.
	const zalegleSpoza = $derived(zakres ? wszystkie.filter((w) => w.stan === 'po_terminie' && !wOkresie(w.rata.data_platnosci, zakres) && (!filtrTu || w.tu === filtrTu)) : []);
	const zalegleSpozaKwota = $derived(zaokr(zalegleSpoza.reduce((s, w) => s + w.oczekiwana, 0)));
	const tuLista = $derived([...new Set(wszystkie.map((w) => w.tu))].filter((t) => t !== '—').sort((a, b) => a.localeCompare(b, 'pl')));
	const licznikStanu = (f: FiltrStanu) => wOkresieRaty.filter((w) => pasujeStan(w, f)).length;

	const nrPolisy = (w: WierszRaty) => w.polisa?.nr_polisy ?? w.rata.crm_policies?.nr_polisy ?? '—';
	const opisRaty = (w: WierszRaty) => `${w.rata.nr_raty}${w.rat > 1 ? `/${w.rat}` : ''}`;

	const widoczne = $derived(
		wOkresieRaty
			.filter((w) => pasujeStan(w, filtrStanu))
			.filter((w) => {
				if (!search.trim()) return true;
				const s = search.trim().toLowerCase();
				return nrPolisy(w).toLowerCase().includes(s) || w.klient.toLowerCase().includes(s) || (notaWg.get(w.rata.nota_id ?? '')?.numer_noty ?? '').toLowerCase().includes(s);
			})
	);
	const sort = new Sortowanie<WierszRaty>({
		termin: (w) => w.rata.data_platnosci,
		polisa: (w) => nrPolisy(w),
		klient: (w) => w.klient,
		tu: (w) => w.tu,
		kwota: (w) => Number(w.rata.kwota),
		pct: (w) => w.pct,
		oczek: (w) => w.oczekiwana,
		znoty: (w) => w.zaliczona,
		stan: (w) => w.stan
	}, { klucz: 'termin' }, 'rozliczenia-raty');
	const wiersze = $derived(sort.sortuj(widoczne));
	const sumy = $derived({
		kwota: zaokr(widoczne.reduce((s, w) => s + Number(w.rata.kwota), 0)),
		oczek: zaokr(widoczne.reduce((s, w) => s + w.oczekiwana, 0)),
		zaliczona: zaokr(widoczne.reduce((s, w) => s + w.zaliczona, 0))
	});

	function ustawOkres(o: Okres) { okres = o; miesiac = ''; }
	function ustawMiesiac(v: string) { miesiac = v; if (/^\d{4}-\d{2}$/.test(v)) okres = v as Okres; }
	function pokazZalegle() { ustawOkres('wszystko'); filtrStanu = 'po_terminie'; }

	const tonStanu: Record<WierszRaty['stan'], 'success' | 'info' | 'error' | 'neutral'> = { nota: 'success', oplacona: 'info', po_terminie: 'error', oczekujaca: 'neutral' };

	// ── Ręczne rozliczenie raty (nota TU, której nie importujemy plikiem) ──
	let rozliczana = $state<WierszRaty | null>(null);
	let fKwota = $state('');
	let fProwizja = $state('');
	let prowizjaReczna = $state(false);
	let fNumerNoty = $state('');
	let fDataZest = $state('');
	let fDataRozl = $state('');
	let zapisuje = $state(false);
	let bladRozl = $state('');
	let toast = $state<{ tekst: string; blad?: boolean; cofnij?: () => void } | null>(null);

	const liczba = (s: string) => parseFloat(String(s).replace(',', '.'));

	function otworzRozliczenie(w: WierszRaty) {
		rozliczana = w;
		fKwota = String(w.rata.kwota);
		fProwizja = String(w.oczekiwana);
		prowizjaReczna = false;
		fNumerNoty = '';
		fDataZest = '';
		fDataRozl = dzis;
		bladRozl = '';
	}
	function zmianaKwoty() {
		if (!rozliczana || prowizjaReczna) return;
		fProwizja = String(prowizjaOczekiwana(liczba(fKwota) || 0, rozliczana.pct));
	}
	const statusDocelowy = $derived(rozliczana ? statusPoRozliczeniu(Number(rozliczana.rata.kwota), liczba(fKwota) || 0) : 'Opłacona');
	const notyTu = $derived(rozliczana ? noty.filter((n) => !n.tu_skrot || rozliczana!.tu === '—' || n.tu_skrot === rozliczana!.tu) : []);
	const roznicaFormularza = $derived(rozliczana ? zaokr((liczba(fProwizja) || 0) - prowizjaOczekiwana(liczba(fKwota) || 0, rozliczana.pct)) : 0);

	async function odswiez() {
		const [rP, rPol] = await Promise.all([wczytajPlatnosci(), wczytajPolisy(), wczytajNoty()]);
		if (!rP.error && rP.data) appState.payments = rP.data as typeof appState.payments;
		if (!rPol.error && rPol.data) appState.policies = rPol.data as typeof appState.policies;
	}

	async function zapiszRozliczenie() {
		const w = rozliczana;
		if (!w) return;
		const kwota = liczba(fKwota);
		const prow = liczba(fProwizja);
		if (!(kwota > 0)) { bladRozl = 'Podaj kwotę składki wg noty TU.'; return; }
		if (!(prow >= 0)) { bladRozl = 'Podaj prowizję z noty (może być 0).'; return; }
		zapisuje = true; bladRozl = '';
		let notaId: string | null = w.rata.nota_id ?? null;
		const numer = fNumerNoty.trim();
		if (numer) {
			const tu = w.tu !== '—' ? w.tu : null;
			const istniejaca = noty.find((n) => n.numer_noty.trim().toLowerCase() === numer.toLowerCase() && (n.tu_skrot ?? null) === tu);
			if (istniejaca) {
				notaId = istniejaca.id;
				const { error } = await sb.from('crm_noty').update({
					pozycji_count: (istniejaca.pozycji_count ?? 0) + 1,
					razem_skladka: zaokr(Number(istniejaca.razem_skladka ?? 0) + kwota),
					razem_prowizja: zaokr(Number(istniejaca.razem_prowizja ?? 0) + prow)
				} as never).eq('id', istniejaca.id);
				if (error) { bladRozl = `Nota: ${error.message}`; zapisuje = false; return; }
			} else {
				const { data, error } = await sb.from('crm_noty').insert([{
					tenant_id: appState.profile!.tenant_id,
					numer_noty: numer,
					tu_skrot: tu,
					data_zestawienia: fDataZest || null,
					razem_skladka: kwota,
					razem_prowizja: prow,
					pozycji_count: 1
				}] as never).select('id').single();
				if (error || !data) { bladRozl = `Nota: ${error?.message ?? 'brak id'}`; zapisuje = false; return; }
				notaId = (data as { id: string }).id;
			}
		}
		const poprzednio = { status: w.rata.status, kwota: w.rata.kwota, prowizja_z_noty: w.rata.prowizja_z_noty, nota_id: w.rata.nota_id, data_oplacenia: w.rata.data_oplacenia };
		const { error } = await sb.from('crm_policy_payments').update({
			status: statusDocelowy,
			kwota,
			prowizja_z_noty: prow,
			nota_id: notaId,
			data_oplacenia: fDataRozl || dzis
		} as never).eq('id', w.rata.id);
		if (error) { bladRozl = error.message; zapisuje = false; return; }
		await odswiez();
		zapisuje = false;
		rozliczana = null;
		toast = {
			tekst: `Rozliczono ratę ${opisRaty(w)} polisy ${nrPolisy(w)} · prowizja ${fmtPln(prow)} zł${numer ? ` · nota ${numer}` : ''}`,
			cofnij: async () => {
				toast = null;
				const { error: e2 } = await sb.from('crm_policy_payments').update(poprzednio as never).eq('id', w.rata.id);
				if (e2) { toast = { tekst: `Nie udało się cofnąć: ${e2.message}`, blad: true }; return; }
				await odswiez();
			}
		};
	}

	// Cofnięcie rozliczenia: rata wraca do „Oczekująca” (kwota zostaje — jak przy imporcie noty).
	async function cofnijRozliczenie(w: WierszRaty) {
		const nota = w.rata.nota_id ? notaWg.get(w.rata.nota_id) : null;
		const ok = await askConfirm({
			title: 'Cofnąć rozliczenie raty?',
			message: `Rata ${opisRaty(w)} polisy ${nrPolisy(w)} · ${w.klient}`,
			detail: `${nota ? `Rozliczona z noty ${nota.numer_noty}. ` : ''}Rata wróci do „Oczekująca”, prowizja z noty zostanie wyzerowana. Nota zostaje w rejestrze.`,
			confirmLabel: 'Cofnij rozliczenie'
		});
		if (!ok) return;
		const poprzednio = { status: w.rata.status, prowizja_z_noty: w.rata.prowizja_z_noty, nota_id: w.rata.nota_id, data_oplacenia: w.rata.data_oplacenia };
		const { error } = await sb.from('crm_policy_payments').update({ status: 'Oczekująca', data_oplacenia: null, nota_id: null, prowizja_z_noty: null } as never).eq('id', w.rata.id);
		if (error) { toast = { tekst: `Nie udało się cofnąć rozliczenia: ${error.message}`, blad: true }; return; }
		await odswiez();
		toast = {
			tekst: `Cofnięto rozliczenie raty ${opisRaty(w)} polisy ${nrPolisy(w)}`,
			cofnij: async () => {
				toast = null;
				const { error: e2 } = await sb.from('crm_policy_payments').update(poprzednio as never).eq('id', w.rata.id);
				if (e2) { toast = { tekst: `Nie udało się przywrócić: ${e2.message}`, blad: true }; return; }
				await odswiez();
			}
		};
	}

	function menuRaty(w: WierszRaty): CtxItem[] {
		return [
			{ label: w.rozliczona ? 'Cofnij rozliczenie' : 'Rozlicz ratę', icon: w.rozliczona ? Undo2 : CheckCircle, onSelect: () => (w.rozliczona ? cofnijRozliczenie(w) : otworzRozliczenie(w)) },
			{ separator: true },
			{ label: 'Otwórz polisę', icon: Eye, disabled: !w.polisa, onSelect: () => goto(`/policies/${w.rata.polisa_id}`) },
			{ label: 'Karta klienta', icon: User, disabled: !w.polisa?.klient_id, onSelect: () => goto(`/clients/${w.polisa!.klient_id}`) },
			{ separator: true },
			{ label: 'Kopiuj nr polisy', icon: Copy, onSelect: () => ctxCopy(nrPolisy(w), 'nr polisy') }
		];
	}

	let importMenu = $state(false);
	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Rozliczenia — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Rozliczenia</h1>
		<p class="text-sm text-ink-3 mt-0.5">Prowizja z rat: co TU rozliczyło notą, co czeka na rozliczenie</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<div class="relative">
			<button onclick={() => (importMenu = !importMenu)} aria-expanded={importMenu} class="h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover">
				<FileUp size={15} /> Importuj notę TU <ChevronDown size={14} />
			</button>
			{#if importMenu}
				<div role="menu" class="absolute right-0 mt-1 w-56 bg-white border border-line rounded-xl shadow-lg overflow-hidden z-20">
					{#each [['ergo', 'Nota ERGO Hestia'], ['leadenhall', 'Nota Leadenhall'], ['colonnade', 'Nota Colonnade']] as [tryb, nazwa]}
						<a role="menuitem" href="/payments?import={tryb}" class="block px-4 py-2.5 text-sm text-ink hover:bg-surface-2">{nazwa}</a>
					{/each}
				</div>
			{/if}
		</div>
		<a href="/payments" class="h-9 flex items-center px-3 rounded-lg border border-line bg-white text-sm font-medium text-ink hover:bg-surface-2">Płatności →</a>
	</div>
</div>

<!-- Kafelki okresu -->
<section aria-label="Podsumowanie okresu" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
	<div class="p-4 rounded-xl bg-white border border-line">
		<p class="text-[13px] font-semibold text-ink-2">Prowizja oczekiwana</p>
		<p class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{fmtPln(podsumowanie.oczekiwana)} zł</p>
		<p class="text-sm text-ink-2">{odmiana(podsumowanie.rat, 'rata', 'raty', 'rat')} w okresie · wg stawek polis</p>
	</div>
	<button onclick={() => (filtrStanu = 'nota')} class="text-left p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<p class="text-[13px] font-semibold text-ok">Rozliczone</p>
		<p class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{fmtPln(podsumowanie.rozliczona)} zł</p>
		<p class="text-sm text-ink-2">{odmiana(podsumowanie.rozliczone, 'rata', 'raty', 'rat')} · z not TU i opłacone</p>
	</button>
	<button onclick={() => (filtrStanu = 'do_rozliczenia')} class="text-left p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<p class="text-[13px] font-semibold {podsumowanie.poTerminie ? 'text-danger' : 'text-warn'}">Do rozliczenia</p>
		<p class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{fmtPln(podsumowanie.doRozliczeniaKwota)} zł</p>
		<p class="text-sm text-ink-2">{odmiana(podsumowanie.doRozliczenia, 'rata', 'raty', 'rat')}{podsumowanie.poTerminie ? ` · ${podsumowanie.poTerminie} po terminie` : ''}</p>
	</button>
	<button onclick={() => (filtrStanu = 'rozjazd')} class="text-left p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<p class="text-[13px] font-semibold {podsumowanie.rozjazdy ? 'text-warn' : 'text-ok'}">Rozjazd z notami</p>
		<p class="text-[26px] leading-8 font-semibold tabular-nums {podsumowanie.rozjazdKwota < 0 ? 'text-danger' : 'text-ink'}">{podsumowanie.rozjazdKwota > 0 ? '+' : ''}{fmtPln(podsumowanie.rozjazdKwota)} zł</p>
		<p class="text-sm text-ink-2">{podsumowanie.rozjazdy ? `${odmiana(podsumowanie.rozjazdy, 'rata', 'raty', 'rat')} z prowizją inną niż wg stawki` : 'noty zgodne ze stawkami polis'}</p>
	</button>
</section>

{#if zalegleSpoza.length}
	<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 rounded-xl bg-danger-soft border border-red-200 text-sm text-danger">
		<AlertTriangle size={16} class="shrink-0" />
		<span class="font-semibold">Poza wybranym okresem: {odmiana(zalegleSpoza.length, 'rata po terminie', 'raty po terminie', 'rat po terminie')} · {fmtPln(zalegleSpozaKwota)} zł prowizji.</span>
		<button onclick={pokazZalegle} class="ml-auto h-7 px-2.5 rounded-lg bg-white border border-red-200 text-[13px] font-semibold text-danger hover:bg-red-50">Pokaż zaległe</button>
	</div>
{/if}

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<div class="flex items-center gap-2 flex-1 min-w-[220px] bg-white border border-line rounded-xl px-3 h-10">
		<Search size={15} class="text-ink-3" />
		<input bind:value={search} placeholder="Nr polisy, klient, numer noty…" class="flex-1 text-sm outline-none placeholder:text-ink-3 bg-transparent" />
	</div>
	<select aria-label="Okres terminów rat" value={/^\d{4}-\d{2}$/.test(okres) ? 'miesiac-wybrany' : okres} onchange={(e) => ustawOkres((e.currentTarget as HTMLSelectElement).value as Okres)} class="h-10 border border-line rounded-xl px-3 text-sm bg-white">
		{#each OKRESY as o (o.val)}<option value={o.val}>{o.label}</option>{/each}
		{#if /^\d{4}-\d{2}$/.test(okres)}<option value="miesiac-wybrany">Miesiąc: {okres}</option>{/if}
	</select>
	<input type="month" aria-label="Wybierz miesiąc" value={miesiac} onchange={(e) => ustawMiesiac((e.currentTarget as HTMLInputElement).value)} class="h-10 border border-line rounded-xl px-3 text-sm bg-white" />
	<select aria-label="Towarzystwo" bind:value={filtrTu} class="h-10 border border-line rounded-xl px-3 text-sm bg-white">
		<option value="">Wszystkie TU</option>
		{#each tuLista as tu (tu)}<option value={tu}>{tu}</option>{/each}
	</select>
</div>
<div role="group" aria-label="Stan rozliczenia" class="flex flex-wrap gap-1.5 mb-4">
	{#each FILTRY_STANU as f (f.val)}
		<button
			aria-pressed={filtrStanu === f.val}
			onclick={() => (filtrStanu = f.val)}
			class="h-8 px-3 rounded-full text-[13px] font-medium border transition-colors
				{filtrStanu === f.val ? 'bg-ink text-white border-ink' : 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
		>{f.label} <span class="tabular-nums">{licznikStanu(f.val)}</span></button>
	{/each}
</div>

<!-- Raty -->
<div class="bg-white border border-line rounded-xl overflow-hidden">
	<div class="overflow-x-auto">
		<table class="w-full min-w-[1040px] text-[13px] text-left">
			<thead>
				<tr class="bg-surface-2 text-ink-2">
					<SortTh s={sort} k="termin" wersaliki={false} class="px-4 py-2.5 font-semibold">Termin</SortTh>
					<SortTh s={sort} k="polisa" wersaliki={false} class="px-3 py-2.5 font-semibold">Polisa</SortTh>
					<SortTh s={sort} k="klient" wersaliki={false} class="px-3 py-2.5 font-semibold">Klient</SortTh>
					<SortTh s={sort} k="tu" wersaliki={false} class="px-3 py-2.5 font-semibold">TU</SortTh>
					<th class="px-3 py-2.5 font-semibold">Rata</th>
					<SortTh s={sort} k="kwota" wersaliki={false} class="px-3 py-2.5 font-semibold text-right" align="right">Kwota raty</SortTh>
					<SortTh s={sort} k="pct" wersaliki={false} class="px-3 py-2.5 font-semibold text-right" align="right">Stawka</SortTh>
					<SortTh s={sort} k="oczek" wersaliki={false} class="px-3 py-2.5 font-semibold text-right" align="right">Prow. oczekiwana</SortTh>
					<SortTh s={sort} k="stan" wersaliki={false} class="px-3 py-2.5 font-semibold">Rozliczenie</SortTh>
					<SortTh s={sort} k="znoty" wersaliki={false} class="px-3 py-2.5 font-semibold text-right" align="right">Prow. z noty</SortTh>
					<th class="px-4 py-2.5 font-semibold text-right">Akcje</th>
				</tr>
			</thead>
			<tbody>
				{#each wiersze as w (w.rata.id)}
					{@const nota = w.rata.nota_id ? notaWg.get(w.rata.nota_id) : undefined}
					{@const staryTryb = !w.rozliczona && w.polisa?.rozliczenie_status === 'rozliczona'}
					<tr use:ctxMenu={{ items: () => menuRaty(w), title: `Rata ${opisRaty(w)} · ${nrPolisy(w)}` }} class="border-t border-line-soft hover:bg-bg" data-testid="rata">
						<td class="px-4 py-2 whitespace-nowrap">
							<span class="block">{fmtDzien(w.rata.data_platnosci)}</span>
							{#if !w.rozliczona}<span class="block text-xs {w.stan === 'po_terminie' ? 'text-danger font-semibold' : 'text-ink-3'}">{w.dni === 0 ? 'dziś' : fmtTermin(w.rata.data_platnosci, dzis)}</span>{/if}
						</td>
						<td class="px-3 py-2">
							<a href="/policies/{w.rata.polisa_id}" class="font-mono text-xs text-accent-text hover:underline">{nrPolisy(w)}</a>
							<Kopiuj tekst={nrPolisy(w)} opis="nr polisy" />
							{#if w.polisa?.rodzaj}<span class="block text-xs text-ink-3">{w.polisa.rodzaj}</span>{/if}
						</td>
						<td class="px-3 py-2">
							{#if w.polisa?.klient_id}<a href="/clients/{w.polisa.klient_id}" class="font-medium text-ink hover:text-accent-text">{w.klient}</a>{:else}<span class="font-medium text-ink">{w.klient}</span>{/if}
						</td>
						<td class="px-3 py-2 text-ink-2 whitespace-nowrap">{w.tu}</td>
						<td class="px-3 py-2 tabular-nums whitespace-nowrap">{opisRaty(w)}</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(w.rata.kwota)} zł</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-2">{w.pct ? `${Number(w.pct).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%` : '—'}</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtPln(w.oczekiwana)} zł</td>
						<td class="px-3 py-2">
							<div class="flex flex-col gap-0.5">
								<span><Badge variant={tonStanu[w.stan]}>{STAN_RATY_ETYKIETA[w.stan]}</Badge></span>
								{#if w.rozliczona}
									<span class="text-xs text-ink-3 whitespace-nowrap">
										{#if nota}
											{#if nota.plik_klucz || nota.file_url}
												<button type="button" onclick={() => otworzNote(nota)} class="inline-flex items-center gap-1 text-accent-text hover:underline"><FileText size={11} /> {nota.numer_noty}</button>
											{:else}
												nota {nota.numer_noty}
											{/if}
											{nota.data_zestawienia ? ` · ${fmtDzien(nota.data_zestawienia)}` : w.rata.data_oplacenia ? ` · ${fmtDzien(w.rata.data_oplacenia)}` : ''}
										{:else if w.rata.data_oplacenia}
											{fmtDzien(w.rata.data_oplacenia)}
										{/if}
									</span>
								{:else if staryTryb}
									<span class="text-xs text-ink-3" title="Polisa rozliczona w całości w starym trybie (składka wg TU {fmtPln(w.polisa?.rozliczenie_kwota_tu)} zł). Rata nie ma własnego rozliczenia.">polisa rozliczona w starym trybie</span>
								{/if}
							</div>
						</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">
							{#if w.rozliczona}
								<span class="font-semibold {w.rozjazd ? 'text-warn' : 'text-ok'}">{fmtPln(w.zaliczona)} zł</span>
								{#if w.roznica != null && w.rozjazd}
									<span class="block text-xs text-warn" title="Różnica wobec prowizji wg stawki polisy">{w.roznica > 0 ? '+' : ''}{fmtPln(w.roznica)} zł</span>
								{:else if w.roznica == null}
									<span class="block text-xs text-ink-3">wg stawki</span>
								{/if}
							{:else}
								<span class="text-ink-3">—</span>
							{/if}
						</td>
						<td class="px-4 py-2 text-right whitespace-nowrap">
							{#if w.rozliczona}
								<button onclick={() => cofnijRozliczenie(w)} class="h-8 px-2.5 text-[13px] font-medium rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" title="Cofnij rozliczenie raty">Cofnij</button>
							{:else}
								<button onclick={() => otworzRozliczenie(w)} class="h-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 inline-flex items-center gap-1"><CheckCircle size={13} /> Rozlicz</button>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="11" class="px-4 py-10 text-center text-ink-3">Brak rat spełniających filtr{zakres ? ' w tym okresie' : ''}.</td></tr>
				{/each}
			</tbody>
			{#if widoczne.length > 1}
				<tfoot>
					<tr class="border-t border-line bg-surface-2 text-ink font-semibold">
						<td class="px-4 py-2.5" colspan="5">Razem {odmiana(widoczne.length, 'rata', 'raty', 'rat')}</td>
						<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(sumy.kwota)} zł</td>
						<td></td>
						<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(sumy.oczek)} zł</td>
						<td></td>
						<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(sumy.zaliczona)} zł</td>
						<td></td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
</div>

<!-- Ręczne rozliczenie raty -->
<Modal title="Rozlicz ratę {rozliczana ? `${opisRaty(rozliczana)} · ${nrPolisy(rozliczana)}` : ''}" open={!!rozliczana} onclose={() => (rozliczana = null)}>
	{#snippet footer()}
		<button onclick={() => (rozliczana = null)} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={zapiszRozliczenie} disabled={zapisuje} class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-60">
			{zapisuje ? 'Zapisywanie...' : statusDocelowy === 'Częściowo opłacona' ? 'Rozlicz częściowo' : 'Rozlicz ratę'}
		</button>
	{/snippet}
	{#if bladRozl}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{bladRozl}</div>{/if}
	{#if rozliczana}
		{@const w = rozliczana}
		<div class="space-y-4">
			<div class="bg-slate-50 rounded-lg p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
				<div><span class="text-slate-500">Klient:</span> <strong>{w.klient}</strong></div>
				<div><span class="text-slate-500">TU:</span> <strong>{w.tu}</strong></div>
				<div><span class="text-slate-500">Rata:</span> <strong>{opisRaty(w)}</strong> · termin {fmtDzien(w.rata.data_platnosci)}</div>
				<div><span class="text-slate-500">Kwota raty w CRM:</span> <strong>{fmtPln(w.rata.kwota)} zł</strong></div>
				<div><span class="text-slate-500">Stawka polisy:</span> <strong>{w.pct ? `${w.pct}%` : '—'}</strong></div>
				<div><span class="text-slate-500">Prowizja wg stawki:</span> <strong>{fmtPln(w.oczekiwana)} zł</strong></div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="rozl-kwota">Składka wg noty TU</label>
					<input id="rozl-kwota" type="number" step="0.01" min="0" bind:value={fKwota} oninput={zmianaKwoty} class={inp} />
					<p class="text-xs text-slate-400 mt-1">{statusDocelowy === 'Częściowo opłacona' ? 'Mniej niż rata w CRM — rozliczenie częściowe.' : 'Kwota raty zostanie zapisana wg noty.'}</p>
				</div>
				<div>
					<label class={lbl} for="rozl-prowizja">Prowizja z noty</label>
					<input id="rozl-prowizja" type="number" step="0.01" min="0" bind:value={fProwizja} oninput={() => (prowizjaReczna = true)} class={inp} />
					<p class="text-xs mt-1 {Math.abs(roznicaFormularza) > 0.5 ? 'text-warn' : 'text-slate-400'}">
						{Math.abs(roznicaFormularza) > 0.5 ? `Różnica wobec stawki: ${roznicaFormularza > 0 ? '+' : ''}${fmtPln(roznicaFormularza)} zł` : 'Zgodna ze stawką polisy.'}
					</p>
				</div>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div>
					<label class={lbl} for="rozl-nota">Numer noty TU</label>
					<input id="rozl-nota" bind:value={fNumerNoty} list="noty-tu" placeholder="opcjonalnie" class={inp} autocomplete="off" />
					<datalist id="noty-tu">{#each notyTu as n (n.id)}<option value={n.numer_noty}>{n.tu_skrot ?? ''} {n.data_zestawienia ? fmtDzien(n.data_zestawienia, true) : ''}</option>{/each}</datalist>
				</div>
				<div>
					<label class={lbl} for="rozl-zest">Data zestawienia</label>
					<input id="rozl-zest" type="date" bind:value={fDataZest} class={inp} disabled={!fNumerNoty.trim()} />
				</div>
				<div>
					<label class={lbl} for="rozl-data">Data rozliczenia</label>
					<input id="rozl-data" type="date" bind:value={fDataRozl} class={inp} />
				</div>
			</div>
			<p class="text-xs text-slate-400">Noty z plikiem importuje się na Płatnościach („Importuj notę TU”) — tam rata rozlicza się automatycznie. Tu rozliczasz pojedynczą ratę, np. z noty, której nie ma w pliku.</p>
		</div>
	{/if}
</Modal>

{#if toast}
	<Toast tekst={toast.tekst} blad={toast.blad} oncofnij={toast.cofnij} onzamknij={() => (toast = null)} />
{/if}
