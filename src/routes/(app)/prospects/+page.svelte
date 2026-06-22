<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil, UserPlus, ExternalLink, ChevronUp, ChevronDown } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { Prospect } from '$lib/types/database';

	// Lista korzysta ze wspólnego cache w appState — dzięki temu powrót z karty
	// prospekta jest natychmiastowy (bez ponownego pobierania ~5 tys. rekordów).
	const prospects = $derived(appState.prospects);
	let loading = $state(false);
	let search = $state('');
	let statusFilter = $state('Nowy');
	let letterFilter = $state('');
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

	const statuses = ['Nowy', 'W kontakcie', 'Oferta wysłana', 'Wygrany', 'Przegrany', 'Wszystkie'];
	const statusValues: Record<string, string> = {
		'Nowy': 'nowy', 'W kontakcie': 'w_kontakcie',
		'Oferta wysłana': 'oferta_wyslana', 'Wygrany': 'wygrany', 'Przegrany': 'przegrany'
	};
	const statusLabels: Record<string, string> = {
		'nowy': 'Nowy', 'w_kontakcie': 'W kontakcie',
		'oferta_wyslana': 'Oferta wysłana', 'wygrany': 'Wygrany', 'przegrany': 'Przegrany'
	};

	function statusVariant(s: string): 'info' | 'success' | 'error' | 'warning' {
		if (s === 'wygrany') return 'success';
		if (s === 'przegrany') return 'error';
		if (s === 'oferta_wyslana') return 'warning';
		return 'info';
	}

	function getZatrudnienie(p: Prospect): number | null {
		if (p.zatrudnienie != null) return p.zatrudnienie;
		if (!p.notatki) return null;
		const m = p.notatki.match(/Zatrudnienie:\s*(\d[\d\s]*)/);
		return m ? parseInt(m[1].trim()) : null;
	}

	type SortCol = 'nazwa' | 'branza' | 'zatrudnienie' | 'status' | 'created_at';
	let sortCol = $state<SortCol>('created_at');
	let sortAsc = $state(false);

	function toggleSort(col: SortCol) {
		if (sortCol === col) sortAsc = !sortAsc;
		else { sortCol = col; sortAsc = true; }
	}

	const statusOrder: Record<string, number> = { nowy: 0, w_kontakcie: 1, oferta_wyslana: 2, wygrany: 3, przegrany: 4 };

	// ---- Alfabet (filtr po pierwszej literze nazwy) ----
	// Nazwy zaczynające się od cyfry trafiają pod literę "A".
	function firstLetterOf(name: string): string {
		const c = (name ?? '').trim().charAt(0).toUpperCase();
		if (!c) return '#';
		if (c >= '0' && c <= '9') return 'A';
		return c;
	}
	const baseAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
	const lettersWithData = $derived.by(() => {
		const s = new Set<string>();
		for (const p of prospects) s.add(firstLetterOf(p.nazwa));
		return s;
	});
	const alphabet = $derived.by(() => {
		const set = new Set<string>(baseAlphabet);
		for (const p of prospects) set.add(firstLetterOf(p.nazwa));
		set.delete('#');
		return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'));
	});

	const filtered = $derived(() => {
		const list = prospects.filter((p) => {
			if (statusFilter !== 'Wszystkie' && p.status !== statusValues[statusFilter]) return false;
			if (letterFilter && firstLetterOf(p.nazwa) !== letterFilter) return false;
			if (search) {
				const q = search.toLowerCase();
				return p.nazwa.toLowerCase().includes(q) || (p.nip ?? '').includes(q) || (p.branza ?? '').toLowerCase().includes(q);
			}
			return true;
		});
		list.sort((a, b) => {
			let av: string | number = '', bv: string | number = '';
			if (sortCol === 'nazwa') { av = a.nazwa.toLowerCase(); bv = b.nazwa.toLowerCase(); }
			else if (sortCol === 'branza') { av = (a.branza ?? '').toLowerCase(); bv = (b.branza ?? '').toLowerCase(); }
			else if (sortCol === 'zatrudnienie') {
				av = getZatrudnienie(a) ?? 0;
				bv = getZatrudnienie(b) ?? 0;
			}
			else if (sortCol === 'status') { av = statusOrder[a.status] ?? 99; bv = statusOrder[b.status] ?? 99; }
			else if (sortCol === 'created_at') { av = a.created_at ?? ''; bv = b.created_at ?? ''; }
			if (av < bv) return sortAsc ? -1 : 1;
			if (av > bv) return sortAsc ? 1 : -1;
			return 0;
		});
		return list;
	});

	// Lista nie potrzebuje wszystkich ~28 kolumn (m.in. 12 pól ubez_*) — pobieramy
	// tylko to, co widać w tabeli. Mniej danych = szybsze ładowanie.
	const PROSPECT_COLS =
		'id, tenant_id, nazwa, nip, adres, telefon, email, branza, notatki, zatrudnienie, broker_id, status, created_at, crm_profiles(imie_nazwisko)';

	async function loadProspects(background = false) {
		// Pierwsza strona + dokładny licznik; resztę stron dociągamy równolegle
		// (zamiast jedna po drugiej), więc całość pobiera się znacznie szybciej.
		if (!background) loading = true;
		const pageSize = 1000;
		const { data: first, count } = await sb
			.from('crm_prospects')
			.select(PROSPECT_COLS, { count: 'exact' })
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.range(0, pageSize - 1);
		const all: Prospect[] = (first ?? []) as Prospect[];
		const total = count ?? all.length;
		if (total > pageSize) {
			const reqs = [];
			for (let from = pageSize; from < total; from += pageSize) {
				reqs.push(
					sb.from('crm_prospects')
						.select(PROSPECT_COLS)
						.order('created_at', { ascending: false })
						.order('id', { ascending: false })
						.range(from, from + pageSize - 1)
				);
			}
			const results = await Promise.all(reqs);
			for (const r of results) all.push(...((r.data ?? []) as Prospect[]));
		}
		appState.prospects = all;
		appState.prospectsLoaded = true;
		loading = false;
	}

	// --- Pamięć filtrów na czas sesji (status / litera / szukaj / sortowanie) ---
	const FILTERS_KEY = 'prospects:filters';
	let stateRestored = $state(false);

	onMount(() => {
		try {
			const raw = sessionStorage.getItem(FILTERS_KEY);
			if (raw) {
				const f = JSON.parse(raw);
				if (typeof f.search === 'string') search = f.search;
				if (typeof f.statusFilter === 'string') statusFilter = f.statusFilter;
				if (typeof f.letterFilter === 'string') letterFilter = f.letterFilter;
				if (typeof f.sortCol === 'string') sortCol = f.sortCol as SortCol;
				if (typeof f.sortAsc === 'boolean') sortAsc = f.sortAsc;
			}
		} catch { /* brak zapisanych filtrów — pomijamy */ }
		stateRestored = true;

		// Jeśli dane są już w cache — pokazujemy je od razu i odświeżamy w tle
		// (np. po edycji prospekta). Inaczej ładujemy z paskiem "Ładowanie".
		loadProspects(appState.prospectsLoaded);
	});

	// Zapis filtrów po każdej zmianie (dopiero po przywróceniu, by nie nadpisać).
	$effect(() => {
		if (!stateRestored) return;
		const snapshot = JSON.stringify({ search, statusFilter, letterFilter, sortCol, sortAsc });
		try { sessionStorage.setItem(FILTERS_KEY, snapshot); } catch { /* ignore */ }
	});

	function openNew() {
		editingProspect = null;
		fNazwa = ''; fNip = ''; fAdres = ''; fTelefon = ''; fEmail = '';
		fBranza = ''; fNotatki = ''; fZatrudnienie = ''; fStatus = 'nowy'; formError = '';
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
		showModal = true;
	}

	function closeModal() { showModal = false; editingProspect = null; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			nazwa: fNazwa.trim(), nip: fNip.trim() || null, adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null, email: fEmail.trim() || null,
			branza: fBranza.trim() || null, notatki: fNotatki.trim() || null,
			zatrudnienie: fZatrudnienie !== '' ? Number(fZatrudnienie) : null,
			broker_id: fBrokerId || null, status: fStatus
		};
		let error;
		if (editingProspect) {
			({ error } = await sb.from('crm_prospects').update(payload).eq('id', editingProspect.id));
		} else {
			({ error } = await sb.from('crm_prospects').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		}
		saving = false;
		if (error) { formError = error.message; return; }
		closeModal();
		await loadProspects();
	}

	async function convertToClient(p: Prospect) {
		const { error: insertError } = await sb.from('crm_clients').insert([{
			tenant_id: appState.profile!.tenant_id,
			opiekun_id: appState.profile!.id,
			nazwa: p.nazwa, nip: p.nip, ulica: p.adres
		}]);
		if (insertError) { alert('Błąd: ' + insertError.message); return; }
		await sb.from('crm_prospects').update({ status: 'wygrany' }).eq('id', p.id);
		await loadProspects();
		const { data } = await sb.from('crm_clients').select('*');
		appState.clients = (data ?? []) as typeof appState.clients;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Prospects — CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Prospects</h1>
		<p class="text-sm text-slate-500 mt-1">Potencjalni klienci — {filtered().length} rekordów</p>
	</div>
	<button onclick={openNew} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		+ Nowy Prospect
	</button>
</div>

<div class="flex items-center gap-2 mb-3 flex-wrap">
	{#each statuses as s}
		<button
			onclick={() => statusFilter = s}
			class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {statusFilter === s ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}"
		>{s}</button>
	{/each}
</div>

<!-- Alfabet — filtr po pierwszej literze nazwy (cyfry pod "A") -->
<div class="flex items-center gap-1 mb-4 flex-wrap">
	<button
		onclick={() => letterFilter = ''}
		class="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors {letterFilter === '' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}"
	>Wszystkie</button>
	{#each alphabet as L}
		{@const has = lettersWithData.has(L)}
		<button
			onclick={() => { if (has) letterFilter = letterFilter === L ? '' : L; }}
			disabled={!has}
			class="w-7 h-7 rounded-md text-xs font-semibold transition-colors {letterFilter === L ? 'bg-blue-600 text-white' : has ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50' : 'text-slate-300 cursor-default'}"
		>{L}</button>
	{/each}
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nazwie, NIP, branży..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	<div class="overflow-x-auto">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide select-none">
					{#snippet thSort(col: SortCol, label: string, cls?: string)}
						<th class="px-4 py-3 {cls ?? ''}">
							<button onclick={() => toggleSort(col)} class="flex items-center gap-1 hover:text-slate-800 transition-colors group">
								{label}
								<span class="flex flex-col leading-none opacity-40 group-hover:opacity-100">
									<ChevronUp size={9} class="{sortCol === col && sortAsc ? 'text-blue-600 opacity-100' : ''}" />
									<ChevronDown size={9} class="{sortCol === col && !sortAsc ? 'text-blue-600 opacity-100' : ''}" />
								</span>
							</button>
						</th>
					{/snippet}
					<th class="px-4 py-3 w-24">Akcje</th>
					{@render thSort('nazwa', 'Firma', 'min-w-[150px]')}
					{@render thSort('zatrudnienie', 'Zatrudnienie', 'w-32')}
					{@render thSort('branza', 'Branża', 'w-36')}
					<th class="px-4 py-3 w-44">Kontakt</th>
					{@render thSort('status', 'Status', 'w-28')}
					{@render thSort('created_at', 'Dodano', 'w-24')}
				</tr>
			</thead>
			<tbody>
				{#each filtered() as p}
					{@const zatrud = getZatrudnienie(p)}
					<tr class="border-t border-slate-100 hover:bg-slate-50 group">
						<td class="px-4 py-2.5">
							<div class="flex items-center gap-1">
								<a href={`/prospects/${p.id}`} title="Otwórz (Ctrl/⌘+klik = nowa karta)" class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
									<ExternalLink size={13} />
								</a>
								<button onclick={() => openEdit(p)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
									<Pencil size={13} />
								</button>
								<button onclick={() => convertToClient(p)} title="Dodaj do Klientów" class="p-1.5 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
									<UserPlus size={13} />
								</button>
							</div>
						</td>
						<td class="px-4 py-2.5">
							<a
								href={`/prospects/${p.id}`}
								class="block font-medium text-blue-700 hover:text-blue-900 hover:underline text-left leading-snug"
							>{p.nazwa}</a>
							<div class="flex items-center gap-2 mt-0.5 flex-wrap">
								{#if p.nip}<span class="text-[11px] text-slate-400">NIP: {p.nip}</span>{/if}
							</div>
						</td>
						<td class="px-4 py-2.5 text-sm text-slate-700">
							{#if zatrud != null}
								<span class="font-medium">{zatrud}</span>
								<span class="text-xs text-slate-400 ml-0.5">os.</span>
							{:else}
								<span class="text-slate-300">—</span>
							{/if}
						</td>
						<td class="px-4 py-2.5 text-xs text-slate-500 max-w-[140px]">
							{#if p.branza}<span class="truncate block">{p.branza}</span>{:else}<span class="text-slate-300">—</span>{/if}
						</td>
						<td class="px-4 py-2.5 text-xs text-slate-500 leading-relaxed">
							{#if p.telefon}<div class="truncate">{p.telefon}</div>{/if}
							{#if p.email}<div class="truncate text-blue-600">{p.email}</div>{/if}
							{#if !p.telefon && !p.email}<span class="text-slate-300">—</span>{/if}
						</td>
						<td class="px-4 py-2.5">
							<Badge variant={statusVariant(p.status)}>{statusLabels[p.status] ?? p.status}</Badge>
						</td>
						<td class="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">
							{p.created_at ? p.created_at.slice(0, 10) : '—'}
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">{loading ? 'Ładowanie…' : 'Brak prospectów'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<Modal title={editingProspect ? `Edytuj — ${editingProspect.nazwa}` : 'Nowy Prospect'} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingProspect ? 'Zapisz zmiany' : 'Zapisz Prospect'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<div class="col-span-2">
			<label class={labelCls}>Nazwa firmy / Imię i Nazwisko *</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
		<div><label class={labelCls}>Branża</label><input bind:value={fBranza} class={inputCls} /></div>
		<div class="col-span-2"><label class={labelCls}>Adres</label><input bind:value={fAdres} class={inputCls} /></div>
		<div><label class={labelCls}>Telefon</label><input bind:value={fTelefon} class={inputCls} /></div>
		<div><label class={labelCls}>Email</label><input bind:value={fEmail} type="email" class={inputCls} /></div>
		<div><label class={labelCls}>Zatrudnienie (os.)</label><input type="number" bind:value={fZatrudnienie} class={inputCls} placeholder="liczba osób" min="0" /></div>
		<div>
			<label class={labelCls}>Status</label>
			<select bind:value={fStatus} class={inputCls}>
				<option value="nowy">Nowy</option>
				<option value="w_kontakcie">W kontakcie</option>
				<option value="oferta_wyslana">Oferta wysłana</option>
				<option value="wygrany">Wygrany</option>
				<option value="przegrany">Przegrany</option>
			</select>
		</div>
		<div>
			<label class={labelCls}>Broker</label>
			<select bind:value={fBrokerId} class={inputCls}>
				<option value="">— brak —</option>
				{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko}</option>{/each}
			</select>
		</div>
		<div class="col-span-2">
			<label class={labelCls}>Notatki</label>
			<textarea bind:value={fNotatki} rows="3" class={inputCls}></textarea>
		</div>
	</div>
</Modal>
