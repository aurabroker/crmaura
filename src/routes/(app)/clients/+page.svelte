<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil, Building2, User } from 'lucide-svelte';
	import RegonLookup from '$lib/components/RegonLookup.svelte';
	import { page } from '$app/stores';
	import { logAudit } from '$lib/utils/audit';

	let search = $state('');
	let compactView = $state(false);
	let showModal = $state(false);
	let modalTyp = $state<'firma' | 'osoba'>('firma');

	let fNazwa = $state('');
	let fNazwaSkrocona = $state('');
	let fUlica = $state('');
	let fNip = $state('');
	let fRegon = $state('');
	let fKrs = $state('');
	let fPesel = $state('');
	let fEmail = $state('');
	let fTelefon = $state('');
	let saving = $state(false);
	let formError = $state('');

	// Duplicate detection
	let showDuplicates = $state(false);
	type DupGroup = { reason: string; clients: typeof appState.clients };
	const duplicateGroups = $derived((): DupGroup[] => {
		const groups: DupGroup[] = [];
		const nipMap = new Map<string, typeof appState.clients>();
		const peselMap = new Map<string, typeof appState.clients>();
		for (const c of appState.clients) {
			if (c.nip) {
				const norm = c.nip.replace(/\s/g, '');
				const arr = nipMap.get(norm) ?? [];
				arr.push(c);
				nipMap.set(norm, arr);
			}
			if (c.pesel) {
				const arr = peselMap.get(c.pesel) ?? [];
				arr.push(c);
				peselMap.set(c.pesel, arr);
			}
		}
		for (const [nip, cs] of nipMap) if (cs.length > 1) groups.push({ reason: `Duplikat NIP: ${nip}`, clients: cs });
		for (const [pesel, cs] of peselMap) if (cs.length > 1) groups.push({ reason: `Duplikat PESEL: ${pesel}`, clients: cs });
		return groups;
	});

	// Merge / delete duplicates
	const KLIENT_ID_TABLES = ['crm_client_contacts', 'crm_policies', 'crm_claims', 'crm_vehicles', 'apk_forms', 'crm_tasks', 'crm_task_history'];
	let mergeTarget = $state<Record<string, string>>({});
	let mergeError = $state<Record<string, string>>({});
	let merging = $state<string | null>(null);

	function policyCount(clientId: string) {
		return appState.policies.filter(p => p.klient_id === clientId && !p.deleted_at).length;
	}
	function apkCount(clientId: string) {
		return appState.apkForms.filter(f => f.klient_id === clientId && f.status === 'submitted').length;
	}
	function mustKeep(clientId: string) {
		return policyCount(clientId) > 0 || apkCount(clientId) > 0;
	}

	async function mergeGroup(group: DupGroup) {
		const targetId = mergeTarget[group.reason];
		if (!targetId) { mergeError[group.reason] = 'Wybierz rekord, który ma zostać zachowany.'; return; }
		const others = group.clients.filter(c => c.id !== targetId);
		const blocked = others.find(c => mustKeep(c.id));
		if (blocked) {
			mergeError[group.reason] = `Rekord "${blocked.nazwa_skrocona ?? blocked.nazwa}" ma przypisaną polisę lub złożone APK i musi zostać zachowany w bazie — wybierz go jako rekord docelowy.`;
			return;
		}
		merging = group.reason;
		mergeError[group.reason] = '';
		const otherIds = others.map(c => c.id);

		for (const table of KLIENT_ID_TABLES) {
			await sb.from(table).update({ klient_id: targetId }).in('klient_id', otherIds);
		}
		await sb.from('crm_clients').delete().in('id', otherIds);
		await logAudit('clients_merged', 'client', targetId, group.reason, { merged_ids: otherIds });

		const [rC, rP, rCl, rV, rA, rT, rCc] = await Promise.all([
			sb.from('crm_clients').select('*').order('created_at', { ascending: false }),
			sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
			sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)'),
			sb.from('crm_vehicles').select('*'),
			sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona)').order('created_at', { ascending: false }),
			sb.from('crm_tasks').select('*, crm_clients(nazwa), crm_prospects(nazwa), crm_policies(nr_polisy), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)').order('termin', { ascending: true, nullsFirst: false }),
			sb.from('crm_client_contacts').select('*')
		]);
		appState.clients = (rC.data ?? []) as typeof appState.clients;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.claims = (rCl.data ?? []) as typeof appState.claims;
		appState.vehicles = (rV.data ?? []) as typeof appState.vehicles;
		appState.apkForms = (rA.data ?? []) as typeof appState.apkForms;
		appState.tasks = (rT.data ?? []) as typeof appState.tasks;
		appState.clientContacts = (rCc.data ?? []) as typeof appState.clientContacts;

		merging = null;
	}

	const filtered = $derived(
		appState.clients.filter(
			(c) =>
				!search ||
				c.nazwa.toLowerCase().includes(search.toLowerCase()) ||
				(c.nazwa_skrocona ?? '').toLowerCase().includes(search.toLowerCase()) ||
				(c.nip ?? '').includes(search)
		)
	);

	function openNew(typ: 'firma' | 'osoba') {
		modalTyp = typ;
		fNazwa = ''; fNazwaSkrocona = ''; fUlica = ''; fNip = ''; fRegon = ''; fKrs = ''; fPesel = '';
		fEmail = ''; fTelefon = ''; formError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			typ: modalTyp,
			nazwa: fNazwa.trim(),
			nazwa_skrocona: fNazwaSkrocona.trim() || null,
			ulica: fUlica.trim() || null,
			nip: modalTyp === 'firma' ? (fNip.trim() || null) : null,
			pesel: modalTyp === 'osoba' ? (fPesel.trim() || null) : null,
			regon: modalTyp === 'firma' ? (fRegon.trim() || null) : null,
			krs: modalTyp === 'firma' ? (fKrs.trim() || null) : null,
			email: fEmail.trim() || null,
			telefon: fTelefon.trim() || null
		};

		const { error } = await sb.from('crm_clients').insert([{
			tenant_id: appState.profile!.tenant_id,
			opiekun_id: appState.profile!.id,
			...payload
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		await logAudit('client_created', 'client', undefined, payload.nazwa as string);
		closeModal();
		const { data } = await sb.from('crm_clients').select('*').order('created_at', { ascending: false });
		appState.clients = (data ?? []) as typeof appState.clients;
	}

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('new') === '1') openNew('firma');
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const modalTitle = $derived(modalTyp === 'firma' ? 'Nowa Firma' : 'Nowa Osoba');
</script>

<svelte:head><title>Klienci — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Klienci <span class="text-slate-400 text-lg font-normal">({appState.clients.length})</span></h1>
		<p class="text-sm text-slate-500 mt-1">Zarządzanie portfelem i statusami RODO</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => showDuplicates = true} class="flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-100 transition-colors">
			Sprawdź duplikaty {#if duplicateGroups().length > 0}<span class="bg-amber-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[11px]">{duplicateGroups().length}</span>{/if}
		</button>
		<button onclick={() => openNew('firma')} class="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			<Building2 size={15} /> Dodaj Firmę
		</button>
		<button onclick={() => openNew('osoba')} class="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">
			<User size={15} /> Dodaj Osobę
		</button>
	</div>
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nazwie lub NIP..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
		<div class="flex items-center rounded-lg border border-slate-200 overflow-hidden shrink-0">
			<button onclick={() => compactView = false}
				class="px-3 py-1.5 text-xs font-medium transition-colors {!compactView ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}">
				Pełny
			</button>
			<button onclick={() => compactView = true}
				class="px-3 py-1.5 text-xs font-medium border-l border-slate-200 transition-colors {compactView ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}">
				Kompaktowy
			</button>
		</div>
	</div>
	{#if compactView}
		<div class="divide-y divide-slate-100">
			{#each filtered as c}
				<button onclick={() => goto(`/clients/${c.id}`)}
					class="w-full flex items-center gap-2 px-5 py-1 text-left hover:bg-slate-50 transition-colors">
					{#if c.typ === 'osoba'}
						<User size={12} class="text-slate-400 shrink-0" />
					{:else}
						<Building2 size={12} class="text-slate-400 shrink-0" />
					{/if}
					<span class="text-sm text-slate-900 truncate">{c.nazwa_skrocona ?? c.nazwa}</span>
				</button>
			{:else}
				<div class="px-5 py-6 text-center text-slate-400">Brak klientów</div>
			{/each}
		</div>
	{:else}
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nazwa / Adres</th>
				<th class="px-5 py-3">NIP / PESEL</th>
				<th class="px-5 py-3">Kontakt</th>
				<th class="px-5 py-3">RODO</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as c}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3">
						<div class="flex items-center gap-2">
							{#if c.typ === 'osoba'}
								<User size={13} class="text-slate-400 shrink-0" />
							{:else}
								<Building2 size={13} class="text-slate-400 shrink-0" />
							{/if}
							<div>
								<div class="font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}</div>
								{#if c.nazwa_skrocona}<div class="text-xs text-slate-400">{c.nazwa}</div>{/if}
								{#if c.ulica}<div class="text-xs text-slate-400">{c.ulica}</div>{/if}
							</div>
						</div>
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">
						{#if c.nip}NIP: {c.nip}<br/>{/if}
						{#if c.pesel}PESEL: {c.pesel}{/if}
						{#if c.krs}<br/>KRS: {c.krs}{/if}
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">
						{#if c.telefon}<a href="tel:{c.telefon}" class="hover:text-blue-600 block">📞 {c.telefon}</a>{/if}
						{#if c.email}<a href="mailto:{c.email}" class="hover:text-blue-600 block">✉ {c.email}</a>{/if}
					</td>
					<td class="px-5 py-3">
						{#if c.rodo_zgoda}
							<Badge variant="success">OK</Badge>
						{:else}
							<Badge variant="error">Brak zgody</Badge>
						{/if}
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<button onclick={() => goto(`/clients/${c.id}`)} class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors">
								Profil 360°
							</button>
							<button onclick={() => goto(`/clients/${c.id}/edit`)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</button>
						</div>
					</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="px-5 py-6 text-center text-slate-400">Brak klientów</td></tr>
			{/each}
		</tbody>
	</table>
	{/if}
</div>

<Modal title={modalTitle} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (modalTyp === 'firma' ? 'Zapisz Firmę' : 'Zapisz Osobę')}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<!-- Row 1: Nazwa (full width) -->
		<div class="col-span-2">
			<label class={labelCls}>{modalTyp === 'firma' ? 'Nazwa firmy *' : 'Imię i Nazwisko *'}</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		{#if modalTyp === 'firma'}
			<!-- Row 2: Nazwa skrócona | Ulica i miasto -->
			<div>
				<label class={labelCls}>Nazwa skrócona (wyświetlana domyślnie)</label>
				<input bind:value={fNazwaSkrocona} class={inputCls} placeholder="np. Kowalski sp. z o.o." />
			</div>
			<div>
				<label class={labelCls}>Ulica i miasto</label>
				<input bind:value={fUlica} class={inputCls} />
			</div>
			<!-- RegonLookup: full width -->
			<div class="col-span-2">
				<RegonLookup onResult={(d) => { fNazwa = fNazwa || d.nazwa; fNip = d.nip || fNip; fRegon = d.regon || fRegon; fUlica = fUlica || d.adres; }} />
			</div>
			<!-- Row 3: NIP | REGON -->
			<div>
				<label class={labelCls}>NIP</label>
				<input bind:value={fNip} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>REGON</label>
				<input bind:value={fRegon} class={inputCls} />
			</div>
			<!-- KRS: full width -->
			<div class="col-span-2">
				<label class={labelCls}>KRS</label>
				<input bind:value={fKrs} class={inputCls} />
			</div>
		{:else}
			<!-- Row 2: PESEL | Ulica i miasto -->
			<div>
				<label class={labelCls}>PESEL</label>
				<input bind:value={fPesel} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Ulica i miasto</label>
				<input bind:value={fUlica} class={inputCls} />
			</div>
		{/if}
		<!-- Row 4 (firma) / Row 3 (osoba): Telefon | E-mail -->
		<div>
			<label class={labelCls}>Telefon</label>
			<input bind:value={fTelefon} type="tel" class={inputCls} placeholder="+48 600 000 000" />
		</div>
		<div>
			<label class={labelCls}>E-mail</label>
			<input bind:value={fEmail} type="email" class={inputCls} placeholder="kontakt@firma.pl" />
		</div>
	</div>
</Modal>

<Modal title="Wykryte duplikaty klientów" open={showDuplicates} onclose={() => showDuplicates = false}>
	{#snippet footer()}
		<button onclick={() => showDuplicates = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
	{/snippet}
	{#if duplicateGroups().length === 0}
		<div class="text-center py-6 text-emerald-600 font-medium">✓ Brak wykrytych duplikatów (NIP / PESEL)</div>
	{:else}
		<div class="space-y-4">
			{#each duplicateGroups() as group}
			<div class="border border-amber-200 rounded-lg overflow-hidden">
				<div class="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 uppercase tracking-wide">{group.reason}</div>
				<div class="divide-y divide-slate-100">
					{#each group.clients as c}
					{@const pCount = policyCount(c.id)}
					{@const aCount = apkCount(c.id)}
					<div class="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="radio" name="merge-{group.reason}" value={c.id}
								checked={mergeTarget[group.reason] === c.id}
								onchange={() => { mergeTarget[group.reason] = c.id; mergeError[group.reason] = ''; }}
								class="accent-blue-600" />
							<div>
								<div class="text-sm font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}</div>
								{#if c.nazwa_skrocona}<div class="text-xs text-slate-400">{c.nazwa}</div>{/if}
								{#if pCount > 0 || aCount > 0}
									<div class="text-[11px] text-emerald-600 mt-0.5">
										{#if pCount > 0}{pCount} polis{pCount === 1 ? 'a' : ''}{/if}
										{#if pCount > 0 && aCount > 0} · {/if}
										{#if aCount > 0}{aCount} APK złożone{/if}
									</div>
								{/if}
							</div>
						</label>
						<a href="/clients/{c.id}" onclick={() => showDuplicates = false} class="text-xs text-blue-600 hover:underline">Otwórz →</a>
					</div>
					{/each}
				</div>
				<div class="px-4 py-3 bg-slate-50 border-t border-slate-100">
					{#if mergeError[group.reason]}
						<div class="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{mergeError[group.reason]}</div>
					{/if}
					<button onclick={() => mergeGroup(group)} disabled={merging === group.reason}
						class="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
						{merging === group.reason ? 'Scalanie...' : 'Scal i usuń pozostałe'}
					</button>
					<span class="text-[11px] text-slate-400 ml-2">Wybierz rekord do zachowania, pozostałe zostaną scalone i usunięte.</span>
				</div>
			</div>
			{/each}
		</div>
	{/if}
</Modal>
