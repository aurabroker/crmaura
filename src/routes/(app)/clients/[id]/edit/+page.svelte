<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import RegonLookup from '$lib/components/RegonLookup.svelte';
	import { ArrowLeft } from 'lucide-svelte';
	import { logAudit } from '$lib/utils/audit';

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find((c) => c.id === clientId) ?? null);
	let typ = $state<'firma' | 'osoba'>('firma');

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
	let loaded = $state(false);

	$effect(() => {
		if (client && !loaded) {
			typ = client.typ ?? 'firma';
			fNazwa = client.nazwa;
			fNazwaSkrocona = client.nazwa_skrocona ?? '';
			fUlica = client.ulica ?? '';
			fNip = client.nip ?? '';
			fRegon = client.regon ?? '';
			fKrs = client.krs ?? '';
			fPesel = client.pesel ?? '';
			fEmail = client.email ?? '';
			fTelefon = client.telefon ?? '';
			loaded = true;
		}
	});

	async function save() {
		if (!client) return;
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			nazwa: fNazwa.trim(),
			nazwa_skrocona: fNazwaSkrocona.trim() || null,
			ulica: fUlica.trim() || null,
			nip: typ === 'firma' ? (fNip.trim() || null) : null,
			pesel: typ === 'osoba' ? (fPesel.trim() || null) : null,
			regon: typ === 'firma' ? (fRegon.trim() || null) : null,
			krs: typ === 'firma' ? (fKrs.trim() || null) : null,
			email: fEmail.trim() || null,
			telefon: fTelefon.trim() || null
		};

		const { error } = await sb.from('crm_clients').update(payload).eq('id', client.id);
		saving = false;
		if (error) { formError = error.message; return; }
		await logAudit('client_updated', 'client', client.id, payload.nazwa);
		const { data } = await sb.from('crm_clients').select('*').order('created_at', { ascending: false });
		appState.clients = (data ?? []) as typeof appState.clients;
		goto(`/clients/${client.id}`);
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Edytuj klienta — FRANK67 CRM</title></svelte:head>

{#if !client}
	<p class="text-slate-400">Klient nie istnieje lub nie masz dostępu.</p>
{:else}
<div class="max-w-3xl">
	<div class="flex items-center gap-3 mb-6">
		<button onclick={() => goto(`/clients/${client.id}`)} class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Edytuj — {client.nazwa_skrocona ?? client.nazwa}</h1>
			<p class="text-sm text-slate-500 mt-0.5">Zmień dane klienta i zapisz</p>
		</div>
	</div>

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
		{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
		<div class="grid grid-cols-2 gap-3">
			<div class="col-span-2">
				<label class={labelCls}>{typ === 'firma' ? 'Nazwa firmy *' : 'Imię i Nazwisko *'}</label>
				<input bind:value={fNazwa} class={inputCls} />
			</div>
			{#if typ === 'firma'}
				<div>
					<label class={labelCls}>Nazwa skrócona (wyświetlana domyślnie)</label>
					<input bind:value={fNazwaSkrocona} class={inputCls} placeholder="np. Kowalski sp. z o.o." />
				</div>
				<div>
					<label class={labelCls}>Ulica i miasto</label>
					<input bind:value={fUlica} class={inputCls} />
				</div>
				<div class="col-span-2">
					<RegonLookup onResult={(d) => { fNazwa = fNazwa || d.nazwa; fNip = d.nip || fNip; fRegon = d.regon || fRegon; fUlica = fUlica || d.adres; }} />
				</div>
				<div>
					<label class={labelCls}>NIP</label>
					<input bind:value={fNip} class={inputCls} />
				</div>
				<div>
					<label class={labelCls}>REGON</label>
					<input bind:value={fRegon} class={inputCls} />
				</div>
				<div class="col-span-2">
					<label class={labelCls}>KRS</label>
					<input bind:value={fKrs} class={inputCls} />
				</div>
			{:else}
				<div>
					<label class={labelCls}>PESEL</label>
					<input bind:value={fPesel} class={inputCls} />
				</div>
				<div>
					<label class={labelCls}>Ulica i miasto</label>
					<input bind:value={fUlica} class={inputCls} />
				</div>
			{/if}
			<div>
				<label class={labelCls}>Telefon</label>
				<input bind:value={fTelefon} type="tel" class={inputCls} placeholder="+48 600 000 000" />
			</div>
			<div>
				<label class={labelCls}>E-mail</label>
				<input bind:value={fEmail} type="email" class={inputCls} placeholder="kontakt@firma.pl" />
			</div>
		</div>
	</div>

	<div class="flex justify-end gap-3 mt-4">
		<button onclick={() => goto(`/clients/${client.id}`)} class="px-5 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
			Anuluj
		</button>
		<button onclick={save} disabled={saving} class="px-6 py-2.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	</div>
</div>
{/if}
