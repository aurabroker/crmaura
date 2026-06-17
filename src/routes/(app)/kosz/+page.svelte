<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln } from '$lib/utils';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { RotateCcw, Trash2 } from 'lucide-svelte';

	onMount(() => {
		const rola = appState.profile?.rola ?? '';
		if (!['ADMIN GOD', 'ADMIN BROKER'].includes(rola)) goto('/dashboard');
		else loadDeleted();
	});

	interface DeletedPolicy {
		id: string;
		nr_polisy: string;
		rodzaj: string;
		data_od: string;
		data_do: string;
		skladka_przypisana: number;
		deleted_at: string;
		deletion_reason: string | null;
		crm_clients: { nazwa: string } | null;
		crm_insurers: { nazwa: string; skrot: string | null } | null;
	}

	let deletedPolicies = $state<DeletedPolicy[]>([]);
	let loading = $state(true);

	async function loadDeleted() {
		loading = true;
		const { data } = await sb
			.from('crm_policies')
			.select('id, nr_polisy, rodzaj, data_od, data_do, skladka_przypisana, deleted_at, deletion_reason, crm_clients!klient_id(nazwa), crm_insurers(nazwa, skrot)')
			.not('deleted_at', 'is', null)
			.order('deleted_at', { ascending: false });
		deletedPolicies = (data ?? []) as DeletedPolicy[];
		loading = false;
	}

	// Restore modal
	let showRestore = $state(false);
	let restoring = $state<DeletedPolicy | null>(null);
	let restoreError = $state('');

	function openRestore(p: DeletedPolicy) {
		restoring = p; restoreError = ''; showRestore = true;
	}

	async function confirmRestore() {
		if (!restoring) return;
		const { error } = await sb.from('crm_policies')
			.update({ deleted_at: null, deletion_reason: null })
			.eq('id', restoring.id);
		if (error) { restoreError = error.message; return; }
		showRestore = false;
		// Reload policies in app state
		const { data } = await sb.from('crm_policies')
			.select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))')
			.is('deleted_at', null);
		appState.policies = (data ?? []) as typeof appState.policies;
		await loadDeleted();
	}

	// Permanent delete modal
	let showPermDelete = $state(false);
	let permDeleting = $state<DeletedPolicy | null>(null);
	let permDeleteError = $state('');

	function openPermDelete(p: DeletedPolicy) {
		permDeleting = p; permDeleteError = ''; showPermDelete = true;
	}

	async function confirmPermDelete() {
		if (!permDeleting) return;
		const { error } = await sb.from('crm_policies').delete().eq('id', permDeleting.id);
		if (error) { permDeleteError = error.message; return; }
		showPermDelete = false;
		await loadDeleted();
	}

	function fmt(d: string) {
		return d ? new Date(d).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
</script>

<svelte:head><title>Kosz — Polisy — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900 flex items-center gap-2">
			<Trash2 size={22} class="text-red-500" /> Kosz — Usunięte polisy
		</h1>
		<p class="text-sm text-slate-500 mt-1">Polisy usunięte przez brokerów. Możesz przywrócić lub trwale usunąć.</p>
	</div>
</div>

{#if loading}
	<p class="text-slate-400 text-sm">Ładowanie...</p>
{:else if deletedPolicies.length === 0}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center">
		<Trash2 size={40} class="text-slate-300 mx-auto mb-3" />
		<p class="text-slate-500">Kosz jest pusty.</p>
	</div>
{:else}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">Rodzaj</th>
				<th class="px-5 py-3">Składka</th>
				<th class="px-5 py-3">Usunięto</th>
				<th class="px-5 py-3">Uzasadnienie</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each deletedPolicies as p}
				<tr class="border-t border-slate-100 hover:bg-slate-50 bg-red-50/30">
					<td class="px-5 py-3 font-medium text-slate-700">{p.nr_polisy}</td>
					<td class="px-5 py-3 text-slate-600">{p.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">
						{#if p.crm_insurers?.skrot}
							<span class="font-mono font-semibold text-blue-700" title={p.crm_insurers.nazwa}>{p.crm_insurers.skrot}</span>
						{:else}
							{p.crm_insurers?.nazwa ?? '—'}
						{/if}
					</td>
					<td class="px-5 py-3 text-slate-500">{p.rodzaj}</td>
					<td class="px-5 py-3 font-medium">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3 text-xs text-slate-500">{fmt(p.deleted_at)}</td>
					<td class="px-5 py-3 text-xs text-slate-500 max-w-xs">
						{#if p.deletion_reason}
							<span class="italic">„{p.deletion_reason}"</span>
						{:else}
							<span class="text-slate-300">—</span>
						{/if}
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<button onclick={() => openRestore(p)} title="Przywróć" class="flex items-center gap-1 px-2 py-1 text-xs text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-50">
								<RotateCcw size={12} /> Przywróć
							</button>
							<button onclick={() => openPermDelete(p)} title="Usuń trwale" class="flex items-center gap-1 px-2 py-1 text-xs text-red-600 border border-red-300 rounded-lg hover:bg-red-50">
								<Trash2 size={12} /> Usuń trwale
							</button>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}

<!-- Modal: Przywróć -->
{#if restoring}
<Modal title="Przywróć polisę" open={showRestore} onclose={() => showRestore = false}>
	{#snippet footer()}
		<button onclick={() => showRestore = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={confirmRestore} class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">Przywróć polisę</button>
	{/snippet}
	{#if restoreError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{restoreError}</div>{/if}
	<p class="text-sm text-slate-700">Czy na pewno chcesz przywrócić polisę <strong>{restoring.nr_polisy}</strong> ({restoring.crm_clients?.nazwa ?? '—'})?</p>
	<p class="text-xs text-slate-500 mt-2">Polisa wróci do aktywnego rejestru.</p>
</Modal>
{/if}

<!-- Modal: Trwałe usunięcie -->
{#if permDeleting}
<Modal title="Trwałe usunięcie polisy" open={showPermDelete} onclose={() => showPermDelete = false}>
	{#snippet footer()}
		<button onclick={() => showPermDelete = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={confirmPermDelete} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700">Usuń trwale</button>
	{/snippet}
	{#if permDeleteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{permDeleteError}</div>{/if}
	<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
		<strong>Uwaga:</strong> Trwałe usunięcie polisy <strong>{permDeleting.nr_polisy}</strong> jest nieodwracalne.
		Zostaną usunięte również powiązane płatności, aneksy i szkody.
	</div>
</Modal>
{/if}
