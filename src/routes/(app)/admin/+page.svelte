<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState, isAdmin } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { Insurer } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Pencil } from 'lucide-svelte';

	onMount(() => {
		if (!isAdmin(appState.profile)) goto('/dashboard');
	});

	let showModal = $state(false);
	let editingTU = $state<Insurer | null>(null);
	let fNazwa = $state('');
	let fDzial = $state('Majątkowy');
	let fUlica = $state('');
	let fNip = $state('');
	let fKrs = $state('');
	let saving = $state(false);
	let formError = $state('');

	function openNew() {
		editingTU = null; fNazwa = ''; fDzial = 'Majątkowy'; fUlica = ''; fNip = ''; fKrs = ''; formError = '';
		showModal = true;
	}

	function openEdit(t: Insurer) {
		editingTU = t; fNazwa = t.nazwa; fDzial = t.dzial;
		fUlica = t.ulica ?? ''; fNip = t.nip ?? ''; fKrs = t.krs ?? '';
		formError = ''; showModal = true;
	}

	async function saveTU() {
		if (!fNazwa.trim()) { formError = 'Podaj nazwę TU'; return; }
		saving = true; formError = '';
		const payload = { nazwa: fNazwa.trim(), dzial: fDzial, ulica: fUlica || null, nip: fNip || null, krs: fKrs || null };
		let error;
		if (editingTU) {
			({ error } = await sb.from('crm_insurers').update(payload).eq('id', editingTU.id));
		} else {
			({ error } = await sb.from('crm_insurers').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		}
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		const { data } = await sb.from('crm_insurers').select('*').order('nazwa');
		appState.insurers = (data ?? []) as typeof appState.insurers;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Administracja — AuraCRM</title></svelte:head>

<h1 class="text-2xl font-semibold text-slate-900 mb-1">Administracja Systemem</h1>
<p class="text-sm text-slate-500 mb-6">Zarządzanie Towarzystwami i strukturą firmy</p>

<div class="grid grid-cols-2 gap-6">
	<!-- TU -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Towarzystwa Ubezpieczeniowe</h2>
			<button onclick={openNew} class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50">+ Dodaj TU</button>
		</div>
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-3">Nazwa</th>
					<th class="px-5 py-3">Dział</th>
					<th class="px-5 py-3">NIP / KRS</th>
				</tr>
			</thead>
			<tbody>
				{#each appState.insurers as t}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-3">
							<div class="font-medium">{t.nazwa}</div>
							{#if t.ulica}<div class="text-xs text-slate-400">{t.ulica}</div>{/if}
						</td>
						<td class="px-5 py-3"><Badge variant="info">{t.dzial}</Badge></td>
						<td class="px-5 py-3 text-xs text-slate-500">
							{#if t.nip}NIP: {t.nip}<br/>{/if}
							{#if t.krs}KRS: {t.krs}{/if}
						</td>
						<td class="px-5 py-3">
							<button onclick={() => openEdit(t)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak TU</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Brokerzy -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-5 py-4 border-b border-slate-200">
			<h2 class="font-semibold text-slate-900">Zespół (Brokerzy)</h2>
		</div>
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-3">Imię / Email</th>
					<th class="px-5 py-3">Rola</th>
					<th class="px-5 py-3">Stanowisko</th>
				</tr>
			</thead>
			<tbody>
				{#each appState.brokers as b}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-3">
							<div class="font-medium">{b.imie_nazwisko ?? b.email}</div>
							<div class="text-xs text-slate-400">{b.email}</div>
						</td>
						<td class="px-5 py-3"><Badge variant="warning">{b.rola}</Badge></td>
						<td class="px-5 py-3 text-sm text-slate-500">{b.stanowisko ?? '—'}</td>
					</tr>
				{:else}
					<tr><td colspan="3" class="px-5 py-6 text-center text-slate-400">Brak brokerów</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<Modal title={editingTU ? `Edytuj TU — ${editingTU.nazwa}` : 'Nowe Towarzystwo (TU)'} open={showModal} onclose={() => { showModal = false; editingTU = null; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; editingTU = null; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTU} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingTU ? 'Zapisz zmiany' : 'Zapisz TU'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nazwa TU *</label>
				<input bind:value={fNazwa} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Dział *</label>
				<select bind:value={fDzial} class={inputCls}>
					<option>Majątkowy</option>
					<option>Życiowy</option>
				</select>
			</div>
		</div>
		<div>
			<label class={labelCls}>Adres</label>
			<input bind:value={fUlica} class={inputCls} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>NIP</label>
				<input bind:value={fNip} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>KRS</label>
				<input bind:value={fKrs} class={inputCls} />
			</div>
		</div>
	</div>
</Modal>
