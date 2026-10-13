<script lang="ts">
	// Sprzedaż → Leady: firmy bez polis (lead powiązany z klientem z kartoteki) i potencjalni klienci spoza kartoteki.
	// Dane firmy powiązanego leada pochodzą z klienta — jedno miejsce edycji. Lead trzyma etap sprzedaży,
	// zainteresowania z formularza, przychód i liczbę zgłoszeń; dodanie polisy klientowi zamyka go jako „Wygrany”.
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		Search, Pencil, UserPlus, ExternalLink, ChevronUp, ChevronDown, LayoutGrid, List, Eye, CircleDot, Copy,
		Mail, Phone, X, UserRound, MousePointerClick, MailOpen, MailX, Repeat
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, ctxToast, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { onMount, type Snippet } from 'svelte';
	import { fmtDzien, odmiana } from '$lib/utils';
	import {
		ETAPY, ETYKIETA_ETAPU, KLASA_ETAPU, ETYKIETA_ZAINTERESOWANIA, OPIS_ZAINTERESOWANIA, ZAINTERESOWANIA, ZRODLO_LEADA,
		nazwaKampanii, posortujZainteresowania, type PodsumowanieMaili
	} from '$lib/sprzedaz';
	import type { Prospect } from '$lib/types/database';

	// Lista korzysta ze wspólnego cache w appState — powrót z karty leada jest natychmiastowy.
	const prospects = $derived(appState.prospects);
	let loading = $state(false);
	let search = $state('');
	let statusFilter = $state('nowy');
	let letterFilter = $state('');
	let fZaint = $state('');
	let fMaile = $state('');
	let fZgloszenia = $state('');
	let view = $state<'tabela' | 'kanban'>('tabela');
	let limit = $state(100);
	let showModal = $state(false);
	let editingProspect = $state<Prospect | null>(null);
	let saving = $state(false);
	let formError = $state('');

	let fNazwa = $state('');
	let fNip = $state('');
	let fAdres = $state('');
	let fTelefon = $state('');
	let fEmail = $state('');
	let fBranza = $state('');
	let fNotatki = $state('');
	let fZatrudnienie = $state<number | ''>('');
	let fBrokerId = $state('');
	let fStatus = $state('nowy');
	let fZainteresowania = $state<string[]>([]);
	let fPrzychod = $state('');

	// Podsumowanie maili kampanii (BEAUTY) na klienta.
	let maile = $state(new Map<string, PodsumowanieMaili>());

	const STATUSY: [string, string][] = [...ETAPY.map((e) => [e.key, e.label] as [string, string]), ['', 'Wszystkie']];

	const nazwaLeada = (p: Prospect) => p.crm_clients?.nazwa_skrocona ?? p.crm_clients?.nazwa ?? p.nazwa;
	const nipLeada = (p: Prospect) => p.crm_clients?.nip ?? p.nip;
	const emailLeada = (p: Prospect) => p.crm_clients?.email ?? p.email;
	const telefonLeada = (p: Prospect) => p.crm_clients?.telefon ?? p.telefon;
	const mailKlienta = (p: Prospect) => (p.klient_id ? maile.get(p.klient_id) : undefined);
	const dataZgloszenia = (p: Prospect) => p.ostatnie_zgloszenie_at ?? p.data_zgloszenia ?? null;

	function getZatrudnienie(p: Prospect): number | null {
		if (p.zatrudnienie != null) return p.zatrudnienie;
		if (!p.notatki) return null;
		const m = p.notatki.match(/Zatrudnienie:\s*(\d[\d\s]*)/);
		return m ? parseInt(m[1].trim()) : null;
	}

	type SortCol = 'nazwa' | 'zainteresowania' | 'maile' | 'status' | 'zgloszenie' | 'created_at';
	let sortCol = $state<SortCol>('created_at');
	let sortAsc = $state(false);
	function toggleSort(col: SortCol) {
		if (sortCol === col) sortAsc = !sortAsc;
		else { sortCol = col; sortAsc = col === 'nazwa'; }
	}
	const statusOrder: Record<string, number> = { nowy: 0, w_kontakcie: 1, oferta_wyslana: 2, wygrany: 3, przegrany: 4 };

	// ---- Alfabet (cyfry pod „A”) ----
	function firstLetterOf(name: string): string {
		const c = (name ?? '').trim().charAt(0).toUpperCase();
		if (!c) return '#';
		if (c >= '0' && c <= '9') return 'A';
		return c;
	}
	const baseAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
	const lettersWithData = $derived.by(() => new Set(prospects.map((p) => firstLetterOf(nazwaLeada(p)))));
	const alphabet = $derived.by(() => {
		const set = new Set<string>(baseAlphabet);
		for (const l of lettersWithData) set.add(l);
		set.delete('#');
		return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'));
	});

	// Filtry wspólne dla tabeli i kanbanu (bez etapu — w kanbanie etapy są kolumnami).
	const poFiltrach = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return prospects.filter((p) => {
			if (letterFilter && firstLetterOf(nazwaLeada(p)) !== letterFilter) return false;
			if (fZaint && !(p.zainteresowania ?? []).includes(fZaint)) return false;
			if (fZgloszenia === 'ponowne' && (p.liczba_zgloszen ?? 0) < 2) return false;
			if (fZgloszenia === 'formularz' && !dataZgloszenia(p)) return false;
			if (fMaile) {
				const m = mailKlienta(p);
				if (fMaile === 'klik' && !m?.klikniete) return false;
				if (fMaile === 'otw' && !m?.otwarte) return false;
				if (fMaile === 'odbite' && !m?.odbite) return false;
				if (fMaile === 'brak' && m) return false;
			}
			if (q) {
				const pola = [nazwaLeada(p), p.nazwa, nipLeada(p), emailLeada(p), telefonLeada(p), p.branza];
				return pola.some((v) => (v ?? '').toLowerCase().includes(q));
			}
			return true;
		});
	});

	const liczEtapy = $derived.by(() => {
		const n: Record<string, number> = { '': poFiltrach.length };
		for (const p of poFiltrach) n[p.status] = (n[p.status] ?? 0) + 1;
		return n;
	});

	const filtered = $derived.by(() => {
		const list = statusFilter ? poFiltrach.filter((p) => p.status === statusFilter) : [...poFiltrach];
		const klucz = (p: Prospect): string | number => {
			switch (sortCol) {
				case 'nazwa': return nazwaLeada(p).toLowerCase();
				case 'zainteresowania': return posortujZainteresowania(p.zainteresowania).join(',') || '~';
				case 'maile': { const m = mailKlienta(p); return m ? m.klikniete * 10000 + m.otwarte * 100 + m.maile : -1; }
				case 'status': return statusOrder[p.status] ?? 99;
				case 'zgloszenie': return dataZgloszenia(p) ?? '';
				default: return p.created_at ?? '';
			}
		};
		list.sort((a, b) => {
			const av = klucz(a), bv = klucz(b);
			if (av < bv) return sortAsc ? -1 : 1;
			if (av > bv) return sortAsc ? 1 : -1;
			return 0;
		});
		return list;
	});
	const naStronie = $derived(filtered.slice(0, limit));

	// Kolumny pokazujemy tylko, gdy coś w nich jest (Aura Expert: zainteresowania i maile; B2B: branża i zatrudnienie).
	const maZainteresowania = $derived(prospects.some((p) => (p.zainteresowania ?? []).length > 0));
	const maMaile = $derived(maile.size > 0);
	const maBranze = $derived(prospects.some((p) => p.branza || getZatrudnienie(p) != null));

	const ileFiltrow = $derived([fZaint, fMaile, fZgloszenia, letterFilter].filter(Boolean).length);
	function wyczyscFiltry() { fZaint = ''; fMaile = ''; fZgloszenia = ''; letterFilter = ''; search = ''; }

	// ---- KANBAN ----
	const KANBAN_COLS = [
		{ key: 'nowy', label: 'Nowy', accent: 'bg-accent' },
		{ key: 'w_kontakcie', label: 'W kontakcie', accent: 'bg-[#9AA3B2]' },
		{ key: 'oferta_wyslana', label: 'Oferta wysłana', accent: 'bg-warn' },
		{ key: 'wygrany', label: 'Wygrany', accent: 'bg-ok' },
		{ key: 'przegrany', label: 'Przegrany', accent: 'bg-danger' }
	];
	const kanbanSource = $derived.by(() => {
		const g: Record<string, Prospect[]> = {};
		for (const c of KANBAN_COLS) g[c.key] = [];
		for (const p of poFiltrach) (g[p.status] ??= []).push(p);
		for (const k in g) g[k] = g[k].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 200);
		return g;
	});
	// Mutowalne kolumny dla svelte-dnd-action — przebudowywane, gdy nie trwa przeciąganie.
	let kanban = $state<Record<string, Prospect[]>>(Object.fromEntries(KANBAN_COLS.map((c) => [c.key, [] as Prospect[]])));
	let dragging = $state(false);
	$effect(() => {
		if (view !== 'kanban') return;
		const src = kanbanSource;
		if (dragging) return;
		const next: Record<string, Prospect[]> = {};
		for (const c of KANBAN_COLS) next[c.key] = [...(src[c.key] ?? [])];
		kanban = next;
	});
	function kanbanConsider(key: string, e: CustomEvent) {
		dragging = true;
		kanban[key] = e.detail.items;
	}
	async function kanbanFinalize(key: string, e: CustomEvent) {
		const items = e.detail.items as Prospect[];
		kanban[key] = items;
		dragging = false;
		for (const p of items.filter((x) => x.status !== key)) {
			p.status = key;
			const idx = appState.prospects.findIndex((x) => x.id === p.id);
			if (idx >= 0) appState.prospects[idx] = { ...appState.prospects[idx], status: key };
			await sb.from('crm_prospects').update({ status: key }).eq('id', p.id);
		}
	}

	const visibleCount = $derived(view === 'kanban' ? poFiltrach.length : filtered.length);

	// Kolejność widocznych leadów — karta leada pokazuje „Poprzedni / Następny”.
	const ORDER_KEY = 'prospects:order';
	const visibleOrder = $derived.by(() => {
		if (view === 'kanban') return KANBAN_COLS.flatMap((c) => (kanban[c.key] ?? []).map((p) => p.id));
		return filtered.map((p) => p.id);
	});
	$effect(() => {
		if (!stateRestored) return;
		try { sessionStorage.setItem(ORDER_KEY, JSON.stringify(visibleOrder)); } catch { /* ignore */ }
	});

	const PROSPECT_COLS =
		'id, tenant_id, nazwa, nip, adres, telefon, email, branza, notatki, zatrudnienie, broker_id, status, created_at, klient_id, zainteresowania, przychod, zrodlo, data_zgloszenia, ostatnie_zgloszenie_at, liczba_zgloszen, status_zmieniony_at, crm_profiles(imie_nazwisko), crm_clients(nazwa, nazwa_skrocona, nip, email, telefon, opiekun_id)';

	async function wszystkieStrony<T>(zapytanie: (od: number, do_: number) => PromiseLike<{ data: unknown; count?: number | null }>): Promise<T[]> {
		const pageSize = 1000;
		const { data: first, count } = await zapytanie(0, pageSize - 1);
		const all = [...((first ?? []) as T[])];
		const total = count ?? all.length;
		if (total > pageSize) {
			const reqs = [];
			for (let from = pageSize; from < total; from += pageSize) reqs.push(zapytanie(from, from + pageSize - 1));
			for (const r of await Promise.all(reqs)) all.push(...((r.data ?? []) as T[]));
		}
		return all;
	}

	async function loadProspects(background = false) {
		if (!background) loading = true;
		appState.prospects = await wszystkieStrony<Prospect>((od, do_) =>
			sb.from('crm_prospects').select(PROSPECT_COLS, { count: 'exact' })
				.order('created_at', { ascending: false }).order('id', { ascending: false }).range(od, do_)
		);
		appState.prospectsLoaded = true;
		loading = false;
	}

	async function loadMaile() {
		const wiersze = await wszystkieStrony<PodsumowanieMaili>((od, do_) =>
			sb.from('crm_kampanie_podsumowanie').select('*', { count: 'exact' }).order('klient_id').range(od, do_)
		).catch(() => [] as PodsumowanieMaili[]);
		maile = new Map(wiersze.map((m) => [m.klient_id, m]));
	}

	// --- Pamięć filtrów na czas sesji ---
	const FILTERS_KEY = 'prospects:filters:v2';
	let stateRestored = $state(false);
	onMount(() => {
		try {
			const raw = sessionStorage.getItem(FILTERS_KEY);
			if (raw) {
				const f = JSON.parse(raw);
				if (typeof f.search === 'string') search = f.search;
				if (typeof f.statusFilter === 'string') statusFilter = f.statusFilter;
				if (typeof f.letterFilter === 'string') letterFilter = f.letterFilter;
				if (typeof f.fZaint === 'string') fZaint = f.fZaint;
				if (typeof f.fMaile === 'string') fMaile = f.fMaile;
				if (typeof f.fZgloszenia === 'string') fZgloszenia = f.fZgloszenia;
				if (typeof f.sortCol === 'string') sortCol = f.sortCol as SortCol;
				if (typeof f.sortAsc === 'boolean') sortAsc = f.sortAsc;
				if (f.view === 'tabela' || f.view === 'kanban') view = f.view;
			}
		} catch { /* brak zapisanych filtrów */ }
		stateRestored = true;
		void loadProspects(appState.prospectsLoaded);
		void loadMaile();
	});
	$effect(() => {
		if (!stateRestored) return;
		const snapshot = JSON.stringify({ search, statusFilter, letterFilter, fZaint, fMaile, fZgloszenia, sortCol, sortAsc, view });
		try { sessionStorage.setItem(FILTERS_KEY, snapshot); } catch { /* ignore */ }
	});
	// Zmiana filtrów wraca do pierwszej strony listy.
	$effect(() => {
		void [search, statusFilter, letterFilter, fZaint, fMaile, fZgloszenia, sortCol, sortAsc];
		limit = 100;
	});

	function openNew() {
		editingProspect = null;
		fNazwa = ''; fNip = ''; fAdres = ''; fTelefon = ''; fEmail = '';
		fBranza = ''; fNotatki = ''; fZatrudnienie = ''; fStatus = 'nowy'; formError = '';
		fZainteresowania = []; fPrzychod = '';
		fBrokerId = appState.profile?.id ?? '';
		showModal = true;
	}
	function openEdit(p: Prospect) {
		editingProspect = p;
		fNazwa = p.nazwa; fNip = p.nip ?? ''; fAdres = p.adres ?? '';
		fTelefon = p.telefon ?? ''; fEmail = p.email ?? '';
		fBranza = p.branza ?? ''; fNotatki = p.notatki ?? '';
		fZatrudnienie = p.zatrudnienie ?? '';
		fBrokerId = p.broker_id ?? ''; fStatus = p.status; formError = '';
		fZainteresowania = [...(p.zainteresowania ?? [])]; fPrzychod = p.przychod ?? '';
		showModal = true;
	}
	function closeModal() { showModal = false; editingProspect = null; formError = ''; }
	function przelaczZainteresowanie(k: string) {
		fZainteresowania = fZainteresowania.includes(k) ? fZainteresowania.filter((x) => x !== k) : [...fZainteresowania, k];
	}

	async function save() {
		const powiazany = !!editingProspect?.klient_id;
		if (!powiazany && !fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const wspolne = {
			notatki: fNotatki.trim() || null,
			broker_id: fBrokerId || null,
			status: fStatus,
			zainteresowania: posortujZainteresowania(fZainteresowania),
			przychod: fPrzychod.trim() || null,
			branza: fBranza.trim() || null,
			zatrudnienie: fZatrudnienie !== '' ? Number(fZatrudnienie) : null
		};
		// Lead powiązany z klientem: dane firmy edytuje się w kartotece klienta.
		const payload = powiazany ? wspolne : {
			...wspolne,
			nazwa: fNazwa.trim(), nip: fNip.trim() || null, adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null, email: fEmail.trim() || null
		};
		let error;
		if (editingProspect) {
			({ error } = await sb.from('crm_prospects').update(payload).eq('id', editingProspect.id));
		} else {
			({ error } = await sb.from('crm_prospects').insert([{ tenant_id: appState.profile!.tenant_id, zrodlo: 'recznie', ...payload }]));
		}
		saving = false;
		if (error) { formError = error.message; return; }
		closeModal();
		await loadProspects(true);
	}

	// Lead spoza kartoteki → klient. Gdy klient z tym NIP już jest, lead zostaje tylko z nim powiązany.
	// Etap się nie zmienia: lead zamknie się jako „Wygrany” sam, gdy klient dostanie polisę.
	async function convertToClient(p: Prospect) {
		if (p.klient_id) { goto(`/clients/${p.klient_id}`); return; }
		const nip = (p.nip ?? '').replace(/\D/g, '');
		let klientId = nip.length === 10 ? appState.clients.find((c) => (c.nip ?? '').replace(/\D/g, '') === nip)?.id ?? null : null;
		if (!klientId) {
			const { data, error } = await sb.from('crm_clients').insert([{
				tenant_id: appState.profile!.tenant_id,
				opiekun_id: p.broker_id ?? appState.profile!.id,
				typ: 'firma',
				nazwa: p.nazwa, nip: p.nip, ulica: p.adres, email: p.email, telefon: p.telefon
			}] as never).select('id, tenant_id, typ, nazwa, nazwa_skrocona, nip, ulica, email, telefon, opiekun_id, rodo_zgoda, beauty_id, created_at').single();
			if (error || !data) { ctxToast(`Błąd: ${error?.message ?? 'nie udało się dodać klienta'}`); return; }
			klientId = (data as { id: string }).id;
			appState.clients = [...appState.clients, data as unknown as (typeof appState.clients)[number]];
			ctxToast('Dodano do Klientów — lead zostaje w Sprzedaży do pierwszej polisy');
		} else {
			ctxToast('Powiązano z istniejącym klientem o tym NIP');
		}
		const { error } = await sb.from('crm_prospects').update({ klient_id: klientId }).eq('id', p.id);
		if (error) { ctxToast(`Błąd: ${error.message}`); return; }
		await loadProspects(true);
	}

	async function setProspectStatus(p: Prospect, status: string) {
		const { error } = await sb.from('crm_prospects').update({ status }).eq('id', p.id);
		if (error) { ctxToast(`Błąd: ${error.message}`); return; }
		appState.prospects = appState.prospects.map((x) => (x.id === p.id ? { ...x, status } : x));
		ctxToast(`Etap: ${ETYKIETA_ETAPU[status] ?? status}`);
	}

	function prospectMenu(p: Prospect): CtxItem[] {
		const email = emailLeada(p), telefon = telefonLeada(p), nip = nipLeada(p);
		return [
			{ label: 'Otwórz leada', icon: Eye, onSelect: () => goto(`/prospects/${p.id}`) },
			...(p.klient_id ? [{ label: 'Otwórz klienta (Panel 360°)', icon: UserRound, onSelect: () => goto(`/clients/${p.klient_id}`) } as CtxItem] : []),
			{ label: 'Otwórz w nowej karcie', icon: ExternalLink, onSelect: () => window.open(`/prospects/${p.id}`, '_blank', 'noopener') },
			{ label: 'Edytuj', icon: Pencil, onSelect: () => openEdit(p) },
			{ separator: true },
			...KANBAN_COLS.filter((c) => c.key !== p.status).map((c): CtxItem => ({
				label: `Etap: ${c.label}`, icon: CircleDot, onSelect: () => setProspectStatus(p, c.key)
			})),
			...(p.klient_id ? [] : [{ separator: true } as CtxItem, { label: 'Dodaj do Klientów', icon: UserPlus, onSelect: () => convertToClient(p) } as CtxItem]),
			{ separator: true },
			{ label: 'Napisz e-mail', icon: Mail, disabled: !email, onSelect: () => window.open(`mailto:${email}`, '_self') },
			{ label: 'Zadzwoń', icon: Phone, disabled: !telefon, onSelect: () => window.open(`tel:${telefon}`, '_self') },
			{ separator: true },
			{ label: 'Kopiuj nazwę', icon: Copy, onSelect: () => ctxCopy(nazwaLeada(p), 'nazwę') },
			{ label: 'Kopiuj NIP', icon: Copy, disabled: !nip, onSelect: () => ctxCopy(nip, 'NIP') },
			{ label: 'Kopiuj e-mail', icon: Copy, disabled: !email, onSelect: () => ctxCopy(email, 'e-mail') },
			{ label: 'Kopiuj telefon', icon: Copy, disabled: !telefon, onSelect: () => ctxCopy(telefon, 'telefon') }
		];
	}

	const inputCls = 'w-full h-9 border border-line rounded-lg px-3 text-sm bg-white focus:outline-none focus:border-accent disabled:bg-surface-2 disabled:text-ink-2';
	const labelCls = 'block text-[13px] font-medium text-ink-2 mb-1';
</script>

<svelte:head><title>Leady — AuraCRM</title></svelte:head>

{#snippet chipy(kody: string[] | undefined)}
	{#each posortujZainteresowania(kody) as k}
		<span title={OPIS_ZAINTERESOWANIA[k]} class="h-5 leading-5 px-1.5 rounded-full bg-accent-soft text-accent-text text-[11px] font-semibold whitespace-nowrap">{ETYKIETA_ZAINTERESOWANIA[k] ?? k}</span>
	{/each}
{/snippet}

{#snippet stanMaili(p: Prospect)}
	{@const m = mailKlienta(p)}
	{#if m}
		{#if m.klikniete}
			<span class="inline-flex items-center gap-1 text-accent-text font-semibold" title="Kliknął link w mailu „{nazwaKampanii(m.ostatni_klik_kampania)}”{m.ostatni_klik_at ? ` · ${fmtDzien(m.ostatni_klik_at.slice(0, 10), true)}` : ''}"><MousePointerClick size={13} aria-hidden="true" /> kliknął · {nazwaKampanii(m.ostatni_klik_kampania)}</span>
		{:else if m.otwarte}
			<span class="inline-flex items-center gap-1 text-ok font-semibold"><MailOpen size={13} aria-hidden="true" /> otworzył {m.otwarte} z {m.maile}</span>
		{:else if m.odbite}
			<span class="inline-flex items-center gap-1 text-danger font-semibold" title="Mail nie doszedł — sprawdź adres"><MailX size={13} aria-hidden="true" /> adres odbity</span>
		{:else}
			<span class="text-ink-2">{odmiana(m.maile, 'mail', 'maile', 'maili')}, bez otwarcia</span>
		{/if}
	{:else}
		<span class="text-ink-3">—</span>
	{/if}
{/snippet}

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Leady <span class="font-normal text-ink-3 tabular-nums">{prospects.length.toLocaleString('pl-PL')}</span></h1>
		<p class="text-sm text-ink-3 mt-0.5">Firmy bez polis i potencjalni klienci — zainteresowania z formularza, maile kampanii, etap sprzedaży</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<div role="group" aria-label="Widok" class="flex p-0.5 rounded-lg bg-surface-2 border border-line-soft">
			<button aria-pressed={view === 'tabela'} onclick={() => (view = 'tabela')} class="h-[30px] flex items-center gap-1.5 px-3 rounded-md text-[13px] {view === 'tabela' ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}"><List size={15} /> Tabela</button>
			<button aria-pressed={view === 'kanban'} onclick={() => (view = 'kanban')} class="h-[30px] flex items-center gap-1.5 px-3 rounded-md text-[13px] {view === 'kanban' ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}"><LayoutGrid size={15} /> Kanban</button>
		</div>
		<button onclick={openNew} class="h-9 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">Nowy lead</button>
	</div>
</div>

{#if view === 'tabela'}
	<div role="tablist" aria-label="Etapy sprzedaży" class="flex gap-x-5 border-b border-line mb-3 overflow-x-auto">
		{#each STATUSY as [key, label]}
			<button
				role="tab"
				aria-selected={statusFilter === key}
				onclick={() => (statusFilter = key)}
				class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
					{statusFilter === key ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
			>
				{label} <span class="font-normal text-ink-3 tabular-nums">{(liczEtapy[key] ?? 0).toLocaleString('pl-PL')}</span>
			</button>
		{/each}
	</div>
{/if}

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<label class="w-full sm:w-auto sm:flex-[1_1_260px] sm:max-w-[380px] h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
		<Search size={16} class="text-ink-3 shrink-0" />
		<span class="sr-only">Szukaj leada</span>
		<input bind:value={search} placeholder="Nazwa, NIP, e-mail, telefon…" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
		{#if search}
			<button onclick={() => (search = '')} aria-label="Wyczyść wyszukiwanie" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={14} /></button>
		{/if}
	</label>
	{#snippet filtr(etykieta: string, tekst: string | null, wyczysc: () => void, opcje: Snippet, wartosc: string, ustaw: (v: string) => void)}
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
	{#snippet opcjeZaint()}
		<option value="">Dowolne zainteresowanie</option>
		{#each ZAINTERESOWANIA as k}<option value={k}>{OPIS_ZAINTERESOWANIA[k]}</option>{/each}
	{/snippet}
	{#snippet opcjeMaile()}
		<option value="">Dowolne</option>
		<option value="klik">Kliknęli link w mailu</option>
		<option value="otw">Otworzyli maila</option>
		<option value="odbite">Adres odbity</option>
		<option value="brak">Bez maili kampanii</option>
	{/snippet}
	{#snippet opcjeZgl()}
		<option value="">Dowolne</option>
		<option value="ponowne">Ponowne zgłoszenia</option>
		<option value="formularz">Ze zgłoszeniem z formularza</option>
	{/snippet}
	{#if maZainteresowania}
		{@render filtr('Zainteresowanie', fZaint ? `Zainteresowanie: ${ETYKIETA_ZAINTERESOWANIA[fZaint]}` : null, () => (fZaint = ''), opcjeZaint, fZaint, (v) => (fZaint = v))}
	{/if}
	{#if maMaile}
		{@render filtr('Maile kampanii', fMaile ? ({ klik: 'Kliknęli link', otw: 'Otworzyli maila', odbite: 'Adres odbity', brak: 'Bez maili' } as Record<string, string>)[fMaile] : null, () => (fMaile = ''), opcjeMaile, fMaile, (v) => (fMaile = v))}
	{/if}
	{@render filtr('Zgłoszenia', fZgloszenia ? (fZgloszenia === 'ponowne' ? 'Ponowne zgłoszenia' : 'Z formularza') : null, () => (fZgloszenia = ''), opcjeZgl, fZgloszenia, (v) => (fZgloszenia = v))}
	<label class="inline-flex items-center h-9 rounded-lg text-[13px] font-medium {letterFilter ? 'border border-line bg-white text-ink' : 'border border-dashed border-[#C4CAD4] text-ink-2'}">
		<span class="sr-only">Pierwsza litera nazwy</span>
		<select bind:value={letterFilter} class="h-full pl-2.5 pr-2 bg-transparent cursor-pointer outline-none">
			<option value="">+ Litera</option>
			{#each alphabet as L}<option value={L} disabled={!lettersWithData.has(L)}>Litera {L}</option>{/each}
		</select>
	</label>
	{#if ileFiltrow > 0 || search}
		<button onclick={wyczyscFiltry} class="h-9 px-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść</button>
	{/if}
	<span class="ml-auto text-[13px] text-ink-3 tabular-nums">{odmiana(visibleCount, 'lead', 'leady', 'leadów')}</span>
</div>

{#if view === 'tabela'}
	<section aria-label="Lista leadów" class="bg-white border border-line rounded-xl overflow-hidden">
		{#if filtered.length === 0}
			<div class="px-4 py-12 text-center">
				<p class="text-sm text-ink-3">{loading ? 'Wczytuję leady…' : 'Brak leadów dla wybranych filtrów.'}</p>
				{#if !loading && (ileFiltrow > 0 || search)}
					<button onclick={wyczyscFiltry} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść filtry</button>
				{/if}
			</div>
		{:else}
			<!-- Telefon: karty -->
			<ul class="md:hidden divide-y divide-line-soft">
				{#each naStronie as p (p.id)}
					<li use:ctxMenu={{ items: () => prospectMenu(p), title: nazwaLeada(p) }} class="px-4 py-3">
						<div class="flex items-start justify-between gap-2">
							<a href="/prospects/{p.id}" class="min-w-0 font-medium text-ink hover:text-accent-text truncate">{nazwaLeada(p)}</a>
							<span class="shrink-0 h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {KLASA_ETAPU[p.status] ?? 'bg-surface-2 text-ink-2'}">{ETYKIETA_ETAPU[p.status] ?? p.status}</span>
						</div>
						<div class="flex flex-wrap items-center gap-1 mt-1">
							{@render chipy(p.zainteresowania)}
							{#if (p.liczba_zgloszen ?? 0) >= 2}<span class="h-5 leading-5 px-1.5 rounded-full bg-warn-soft text-warn text-[11px] font-semibold">{p.liczba_zgloszen}× zgłoszenie</span>{/if}
						</div>
						<p class="mt-1 text-xs text-ink-3">{[nipLeada(p) ? `NIP ${nipLeada(p)}` : null, p.przychod, dataZgloszenia(p) ? `zgłoszenie ${fmtDzien(dataZgloszenia(p)!.slice(0, 10), true)}` : null].filter(Boolean).join(' · ')}</p>
						{#if mailKlienta(p)}<p class="mt-0.5 text-xs">{@render stanMaili(p)}</p>{/if}
						{#if telefonLeada(p)}<a href="tel:{telefonLeada(p)}" class="mt-1 inline-block text-[13px] text-accent-text">{telefonLeada(p)}</a>{/if}
					</li>
				{/each}
			</ul>

			<!-- Komputer: tabela -->
			<div class="hidden md:block overflow-x-auto">
				<table class="w-full min-w-[980px] text-[13px] text-left">
					<thead>
						<tr class="bg-surface-2 text-ink-2 select-none">
							{#snippet th(col: SortCol, label: string, cls = '')}
								<th class="px-3 py-2.5 font-semibold {cls}" aria-sort={sortCol === col ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
									<button onclick={() => toggleSort(col)} class="inline-flex items-center gap-1 hover:text-ink group">
										{label}
										<span class="flex flex-col leading-none {sortCol === col ? 'text-accent-text' : 'opacity-40 group-hover:opacity-100'}">
											<ChevronUp size={9} class={sortCol === col && !sortAsc ? 'opacity-30' : ''} />
											<ChevronDown size={9} class={sortCol === col && sortAsc ? 'opacity-30' : ''} />
										</span>
									</button>
								</th>
							{/snippet}
							{@render th('nazwa', 'Firma', 'pl-4')}
							{#if maZainteresowania}{@render th('zainteresowania', 'Zainteresowanie', 'w-[190px]')}{/if}
							{#if maMaile}{@render th('maile', 'Maile kampanii', 'w-[220px]')}{/if}
							{#if maBranze}<th class="px-3 py-2.5 font-semibold w-[170px]">Branża</th>{/if}
							<th class="px-3 py-2.5 font-semibold w-[190px]">Kontakt</th>
							{@render th('status', 'Etap', 'w-[130px]')}
							{@render th('zgloszenie', 'Zgłoszenie', 'w-[120px]')}
							<th class="pr-4 py-2.5 w-[84px]"><span class="sr-only">Akcje</span></th>
						</tr>
					</thead>
					<tbody>
						{#each naStronie as p (p.id)}
							{@const zatrud = getZatrudnienie(p)}
							{@const zgl = dataZgloszenia(p)}
							<tr use:ctxMenu={{ items: () => prospectMenu(p), title: nazwaLeada(p) }} class="border-t border-line-soft hover:bg-bg">
								<td class="pl-4 pr-3 py-2.5 max-w-[340px]">
									<a href="/prospects/{p.id}" class="block font-medium text-ink hover:text-accent-text truncate">{nazwaLeada(p)}</a>
									<span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
										{#if nipLeada(p)}<span class="font-mono">NIP {nipLeada(p)}</span>{/if}
										{#if p.przychod}<span>przychód {p.przychod}</span>{/if}
										{#if (p.liczba_zgloszen ?? 0) >= 2}<span class="inline-flex items-center gap-1 text-warn font-semibold"><Repeat size={11} aria-hidden="true" /> {p.liczba_zgloszen}× zgłoszenie</span>{/if}
									</span>
								</td>
								{#if maZainteresowania}
									<td class="px-3 py-2.5"><span class="flex flex-wrap gap-1">{@render chipy(p.zainteresowania)}</span>{#if !(p.zainteresowania ?? []).length}<span class="text-ink-3">—</span>{/if}</td>
								{/if}
								{#if maMaile}<td class="px-3 py-2.5 text-xs">{@render stanMaili(p)}</td>{/if}
								{#if maBranze}
									<td class="px-3 py-2.5 text-xs text-ink-2 max-w-[170px]">
										<span class="block truncate">{p.branza ?? '—'}</span>
										{#if zatrud != null}<span class="text-ink-3">{zatrud} os.</span>{/if}
									</td>
								{/if}
								<td class="px-3 py-2.5 text-xs leading-relaxed max-w-[190px]">
									{#if telefonLeada(p)}<a href="tel:{telefonLeada(p)}" class="block truncate text-ink-2 hover:text-accent-text">{telefonLeada(p)}</a>{/if}
									{#if emailLeada(p)}<a href="mailto:{emailLeada(p)}" class="block truncate text-accent-text hover:underline">{emailLeada(p)}</a>{/if}
									{#if !telefonLeada(p) && !emailLeada(p)}<span class="text-ink-3">—</span>{/if}
								</td>
								<td class="px-3 py-2.5">
									<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {KLASA_ETAPU[p.status] ?? 'bg-surface-2 text-ink-2'}">{ETYKIETA_ETAPU[p.status] ?? p.status}</span>
								</td>
								<td class="px-3 py-2.5 text-xs text-ink-2 whitespace-nowrap" title={p.zrodlo ? `Źródło: ${ZRODLO_LEADA[p.zrodlo] ?? p.zrodlo}` : undefined}>
									{zgl ? fmtDzien(zgl.slice(0, 10), true) : '—'}
								</td>
								<td class="pr-4 py-2.5">
									<span class="flex items-center justify-end gap-0.5">
										{#if p.klient_id}
											<a href="/clients/{p.klient_id}" title="Panel 360° klienta" aria-label="Panel 360° klienta {nazwaLeada(p)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-ink-3 hover:text-accent-text hover:bg-accent-soft"><UserRound size={14} /></a>
										{:else}
											<button onclick={() => convertToClient(p)} title="Dodaj do Klientów" aria-label="Dodaj do Klientów: {nazwaLeada(p)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-ok hover:bg-ok-soft"><UserPlus size={14} /></button>
										{/if}
										<button onclick={() => openEdit(p)} title="Edytuj" aria-label="Edytuj leada {nazwaLeada(p)}" class="w-7 h-7 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Pencil size={14} /></button>
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if filtered.length > limit}
				<div class="px-4 py-3 border-t border-line-soft text-center">
					<button onclick={() => (limit += 200)} class="text-[13px] font-semibold text-accent-text hover:underline">Pokaż więcej ({(filtered.length - limit).toLocaleString('pl-PL')})</button>
				</div>
			{/if}
		{/if}
	</section>
{:else}
	<!-- KANBAN -->
	<div class="flex gap-3 overflow-x-auto pb-4 items-start">
		{#each KANBAN_COLS as col}
			<div class="flex-1 min-w-[250px] bg-surface-2 border border-line-soft rounded-xl flex flex-col">
				<div class="px-3.5 py-2.5 border-b border-line-soft flex items-center gap-2">
					<span class="w-2 h-2 rounded-full {col.accent}" aria-hidden="true"></span>
					<h3 class="text-[13px] font-semibold text-ink">{col.label}</h3>
					<span class="ml-auto text-xs font-semibold text-ink-3 tabular-nums">{(liczEtapy[col.key] ?? 0).toLocaleString('pl-PL')}</span>
				</div>
				<div
					class="p-2 flex flex-col gap-2 min-h-[120px] flex-1"
					use:dndzone={{ items: kanban[col.key] ?? [], flipDurationMs: 150, dropTargetStyle: {} }}
					onconsider={(e) => kanbanConsider(col.key, e)}
					onfinalize={(e) => kanbanFinalize(col.key, e)}
				>
					{#each kanban[col.key] ?? [] as p (p.id)}
						<div use:ctxMenu={{ items: () => prospectMenu(p), title: nazwaLeada(p) }} class="bg-white border border-line rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-colors">
							<a href="/prospects/{p.id}" class="block font-medium text-ink hover:text-accent-text text-[13px] leading-snug break-words">{nazwaLeada(p)}</a>
							{#if nipLeada(p)}<div class="text-xs text-ink-3 mt-0.5 font-mono">NIP {nipLeada(p)}</div>{/if}
							<div class="flex flex-wrap gap-1 mt-1.5">
								{@render chipy(p.zainteresowania)}
								{#if (p.liczba_zgloszen ?? 0) >= 2}<span class="h-5 leading-5 px-1.5 rounded-full bg-warn-soft text-warn text-[11px] font-semibold">{p.liczba_zgloszen}× zgłoszenie</span>{/if}
							</div>
							{#if mailKlienta(p)}<div class="mt-1.5 text-xs">{@render stanMaili(p)}</div>{/if}
							{#if telefonLeada(p)}<div class="mt-1 text-xs text-ink-2 truncate">{telefonLeada(p)}</div>{/if}
						</div>
					{/each}
					{#if (kanban[col.key] ?? []).length === 0}
						<div class="text-center text-xs text-ink-3 py-6 select-none">{loading ? 'Wczytuję…' : 'Przeciągnij tutaj'}</div>
					{:else if (liczEtapy[col.key] ?? 0) > (kanban[col.key] ?? []).length}
						<p class="text-center text-xs text-ink-3 py-1">i {((liczEtapy[col.key] ?? 0) - (kanban[col.key] ?? []).length).toLocaleString('pl-PL')} kolejnych — zawęź filtrem</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<Modal title={editingProspect ? `Lead — ${nazwaLeada(editingProspect)}` : 'Nowy lead'} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="h-9 px-4 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Anuluj</button>
		<button onclick={save} disabled={saving} class="h-9 px-4 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie…' : editingProspect ? 'Zapisz zmiany' : 'Dodaj leada'}
		</button>
	{/snippet}

	{#if formError}<p class="mb-3 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{formError}</p>{/if}
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		{#if editingProspect?.klient_id}
			<div class="sm:col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
				<p class="font-semibold text-ink">{nazwaLeada(editingProspect)}</p>
				<p class="text-ink-2">{[nipLeada(editingProspect) ? `NIP ${nipLeada(editingProspect)}` : null, telefonLeada(editingProspect), emailLeada(editingProspect)].filter(Boolean).join(' · ') || 'brak danych kontaktowych'}</p>
				<p class="mt-1 text-xs text-ink-3">Dane firmy edytujesz w kartotece klienta — <a href="/clients/{editingProspect.klient_id}" class="font-semibold text-accent-text hover:underline">Panel 360°</a>.</p>
			</div>
		{:else}
			<div class="sm:col-span-2">
				<label class={labelCls} for="lead-nazwa">Nazwa firmy / imię i nazwisko *</label>
				<input id="lead-nazwa" bind:value={fNazwa} class={inputCls} />
			</div>
			<div><label class={labelCls} for="lead-nip">NIP</label><input id="lead-nip" bind:value={fNip} class={inputCls} /></div>
			<div><label class={labelCls} for="lead-adres">Adres</label><input id="lead-adres" bind:value={fAdres} class={inputCls} /></div>
			<div><label class={labelCls} for="lead-tel">Telefon</label><input id="lead-tel" bind:value={fTelefon} class={inputCls} /></div>
			<div><label class={labelCls} for="lead-email">E-mail</label><input id="lead-email" bind:value={fEmail} type="email" class={inputCls} /></div>
		{/if}
		<fieldset class="sm:col-span-2">
			<legend class={labelCls}>Zainteresowanie</legend>
			<div class="flex flex-wrap gap-1.5">
				{#each ZAINTERESOWANIA as k}
					{@const on = fZainteresowania.includes(k)}
					<button type="button" aria-pressed={on} onclick={() => przelaczZainteresowanie(k)} title={OPIS_ZAINTERESOWANIA[k]}
						class="h-8 px-3 rounded-full text-[13px] font-medium border {on ? 'bg-accent-soft border-accent text-accent-text' : 'bg-white border-line text-ink-2 hover:bg-surface-2'}">{ETYKIETA_ZAINTERESOWANIA[k]}</button>
				{/each}
			</div>
		</fieldset>
		<div><label class={labelCls} for="lead-przychod">Przychód roczny</label><input id="lead-przychod" bind:value={fPrzychod} placeholder="np. do 250 000 zł" class={inputCls} /></div>
		<div>
			<label class={labelCls} for="lead-etap">Etap</label>
			<select id="lead-etap" bind:value={fStatus} class={inputCls}>
				{#each ETAPY as e}<option value={e.key}>{e.label}</option>{/each}
			</select>
		</div>
		<div>
			<label class={labelCls} for="lead-broker">Opiekun leada</label>
			<select id="lead-broker" bind:value={fBrokerId} class={inputCls}>
				<option value="">— brak —</option>
				{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko}</option>{/each}
			</select>
		</div>
		<div><label class={labelCls} for="lead-branza">Branża</label><input id="lead-branza" bind:value={fBranza} class={inputCls} /></div>
		<div><label class={labelCls} for="lead-zatr">Zatrudnienie (os.)</label><input id="lead-zatr" type="number" bind:value={fZatrudnienie} class={inputCls} min="0" /></div>
		<div class="sm:col-span-2">
			<label class={labelCls} for="lead-notatki">Notatki</label>
			<textarea id="lead-notatki" bind:value={fNotatki} rows="3" class="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-accent"></textarea>
		</div>
	</div>
</Modal>
