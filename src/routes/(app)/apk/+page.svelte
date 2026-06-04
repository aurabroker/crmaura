<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { ApkForm } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { todayStr } from '$lib/utils';
	import { Plus, Copy, Check, ExternalLink, Search, ClipboardList } from 'lucide-svelte';

	const APK_APP_URL = 'https://apk.aurabroker.pl'; // adres React app

	let showNew = $state(false);
	let saving = $state(false);
	let err = $state('');

	// form state
	let fKlient = $state('');
	let fKlientSearch = $state('');
	let fKlientOpen = $state(false);
	let fAdvisor = $state(appState.profile?.imie_nazwisko ?? '');
	let fMode = $state<'client' | 'advisor'>('client');

	const filteredClients = $derived(
		fKlientSearch.trim()
			? appState.clients.filter(c => (c.nazwa + ' ' + (c.nazwa_skrocona ?? '')).toLowerCase().includes(fKlientSearch.toLowerCase()))
			: appState.clients
	);
	const selectedClientName = $derived(appState.clients.find(c => c.id === fKlient)?.nazwa ?? '');

	// result after create
	let createdToken = $state('');
	let createdFormId = $state('');
	let copied = $state(false);

	const tokenLink = $derived(createdToken ? `${APK_APP_URL}?token=${createdToken}` : '');

	function genRef(): string {
		return 'APK-' + Math.random().toString(36).slice(2, 10).toUpperCase();
	}
	function genToken(): string {
		return Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
	}

	async function createApk() {
		if (!fKlient) { err = 'Wybierz klienta'; return; }
		saving = true; err = '';
		const client = appState.clients.find(c => c.id === fKlient)!;
		const ref = genRef();
		const token = genToken();
		const today = todayStr();

		const { data: form, error: e1 } = await sb.from('apk_forms').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fKlient,
			ref_number: ref,
			client_name: client.nazwa,
			advisor_name: fAdvisor || null,
			form_date: today,
			mode: fMode,
			status: 'draft',
			form_data: {}
		}]).select('id').single();

		if (e1) { saving = false; err = e1.message; return; }

		const expires = new Date(); expires.setDate(expires.getDate() + 30);
		const { error: e2 } = await sb.from('apk_tokens').insert([{
			tenant_id: appState.profile!.tenant_id,
			token,
			form_id: form!.id,
			advisor_name: fAdvisor || null,
			status: 'pending',
			expires_at: expires.toISOString()
		}]);
		if (e2) { saving = false; err = e2.message; return; }

		// log audit
		await sb.from('apk_audit').insert([{ form_id: form!.id, event: 'created', actor: fAdvisor || 'system' }]);

		// refresh
		const { data } = await sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona)').order('created_at', { ascending: false });
		appState.apkForms = (data ?? []) as typeof appState.apkForms;

		saving = false;
		createdToken = token;
		createdFormId = form!.id;
	}

	async function copyLink() {
		await navigator.clipboard.writeText(tokenLink);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function closeNew() {
		showNew = false;
		err = '';
		fKlient = '';
		fKlientSearch = '';
		fAdvisor = appState.profile?.imie_nazwisko ?? '';
		fMode = 'client';
		createdToken = '';
		createdFormId = '';
	}

	let search = $state('');
	let filterStatus = $state('all');

	const filtered = $derived(
		appState.apkForms
			.filter(f => filterStatus === 'all' || f.status === filterStatus)
			.filter(f => {
				if (!search) return true;
				return (f.client_name + ' ' + (f.ref_number ?? '')).toLowerCase().includes(search.toLowerCase());
			})
	);

	const statusVariant = (s: string) => s === 'submitted' ? 'success' : 'neutral';
	const statusLabel = (s: string) => s === 'submitted' ? 'Złożony' : 'Szkic';

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>APK — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Analiza Potrzeb Klienta (APK)</h1>
		<p class="text-sm text-slate-500 mt-1">Formularze APK zgodne z KNF art. 8 UDU</p>
	</div>
	<button onclick={() => showNew = true}
		class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700">
		<Plus size={15} /> Nowy APK
	</button>
</div>

<!-- Filtry -->
<div class="flex gap-3 mb-5 flex-wrap">
	<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj klienta / ref..." class="text-sm outline-none placeholder:text-slate-400 w-44" />
	</div>
	{#each [['all','Wszystkie'],['draft','Szkice'],['submitted','Złożone']] as [val, label]}
		<button onclick={() => filterStatus = val}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
				{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}">
			{label}
		</button>
	{/each}
</div>

<!-- Stats -->
<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-slate-500 mb-1">Wszystkich APK</p>
		<p class="text-2xl font-bold text-slate-900">{appState.apkForms.length}</p>
	</div>
	<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-emerald-600 mb-1">Złożone</p>
		<p class="text-2xl font-bold text-emerald-700">{appState.apkForms.filter(f => f.status === 'submitted').length}</p>
	</div>
	<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-amber-600 mb-1">Szkice (oczekujące)</p>
		<p class="text-2xl font-bold text-amber-700">{appState.apkForms.filter(f => f.status === 'draft').length}</p>
	</div>
</div>

<!-- Lista -->
{#if filtered.length === 0}
	<div class="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
		<ClipboardList size={32} class="mx-auto mb-2 opacity-30" />
		Brak formularzy APK
	</div>
{:else}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<table class="w-full text-sm text-left">
			<thead class="bg-slate-50 border-b border-slate-200">
				<tr>
					<th class="px-5 py-3 font-semibold text-slate-600">Ref</th>
					<th class="px-5 py-3 font-semibold text-slate-600">Klient</th>
					<th class="px-5 py-3 font-semibold text-slate-600">Doradca</th>
					<th class="px-5 py-3 font-semibold text-slate-600">Data</th>
					<th class="px-5 py-3 font-semibold text-slate-600">Status</th>
					<th class="px-5 py-3 font-semibold text-slate-600">Złożony</th>
					<th class="px-5 py-3"></th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as f}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-3 font-mono text-xs text-slate-500">{f.ref_number}</td>
						<td class="px-5 py-3 font-medium">{f.crm_clients?.nazwa_skrocona ?? f.crm_clients?.nazwa ?? f.client_name}</td>
						<td class="px-5 py-3 text-slate-500">{f.advisor_name ?? '—'}</td>
						<td class="px-5 py-3 text-slate-500">{f.form_date}</td>
						<td class="px-5 py-3"><Badge variant={statusVariant(f.status)}>{statusLabel(f.status)}</Badge></td>
						<td class="px-5 py-3 text-slate-400 text-xs">{f.submitted_at ? f.submitted_at.slice(0,10) : '—'}</td>
						<td class="px-5 py-3">
							<a href="{APK_APP_URL}?form_id={f.id}" target="_blank"
								class="flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
								<ExternalLink size={12} /> Otwórz
							</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<!-- Modal: Nowy APK -->
<Modal title="Nowy formularz APK" open={showNew} onclose={closeNew}>
	{#snippet footer()}
		{#if createdToken}
			<button onclick={closeNew} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">Gotowe</button>
		{:else}
			<button onclick={closeNew} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			<button onclick={createApk} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				{saving ? 'Tworzenie...' : 'Utwórz i wygeneruj link'}
			</button>
		{/if}
	{/snippet}

	{#if createdToken}
		<!-- Sukces — pokaż link -->
		<div class="space-y-4">
			<div class="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
				<Check size={20} class="text-emerald-600 shrink-0" />
				<span class="text-sm text-emerald-700 font-medium">APK utworzone pomyślnie!</span>
			</div>
			<div>
				<label class={lbl}>Link dla klienta (ważny 30 dni)</label>
				<div class="flex gap-2">
					<input readonly value={tokenLink} class="{inp} bg-slate-50 font-mono text-xs" />
					<button onclick={copyLink}
						class="flex items-center gap-1 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0 {copied ? 'text-emerald-600 border-emerald-300' : 'text-slate-600'}">
						{#if copied}<Check size={14} /> Skopiowano{:else}<Copy size={14} /> Kopiuj{/if}
					</button>
				</div>
				<p class="text-xs text-slate-400 mt-1">Wyślij ten link klientowi — wypełni formularz APK online</p>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#if err}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>{/if}

			<!-- Klient -->
			<div>
				<label class={lbl}>Klient *</label>
				<div class="relative"
					onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { fKlientOpen = false; fKlientSearch = ''; } }}>
					<input type="text"
						value={fKlientOpen ? fKlientSearch : selectedClientName}
						placeholder="— wpisz nazwę klienta —"
						oninput={(e) => fKlientSearch = (e.target as HTMLInputElement).value}
						onfocus={() => { fKlientOpen = true; fKlientSearch = ''; }}
						class={inp}
					/>
					{#if fKlientOpen}
						<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-slate-300 rounded-lg shadow-xl max-h-52 overflow-y-auto">
							{#each filteredClients as c}
								<button tabindex="0" type="button" onclick={() => { fKlient = c.id; fKlientOpen = false; fKlientSearch = ''; }}
									class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
									{c.nazwa_skrocona ?? c.nazwa}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if fKlient && !fKlientOpen}
					<p class="text-[11px] text-emerald-600 mt-1">✓ {selectedClientName}</p>
				{/if}
			</div>

			<!-- Doradca -->
			<div>
				<label class={lbl}>Doradca</label>
				<input bind:value={fAdvisor} class={inp} placeholder="Imię i nazwisko doradcy" />
			</div>

			<!-- Tryb -->
			<div>
				<label class={lbl}>Tryb wypełniania</label>
				<div class="flex gap-2">
					{#each [['client','Klient wypełnia sam'],['advisor','Doradca wypełnia z klientem']] as [val, label]}
						<button type="button" onclick={() => fMode = val as typeof fMode}
							class="flex-1 py-2 text-sm rounded-lg border transition-colors
								{fMode === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
							{label}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</Modal>
