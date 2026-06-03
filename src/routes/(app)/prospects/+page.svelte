<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil, UserPlus } from 'lucide-svelte';
	import { onMount } from 'svelte';

	type Prospect = {
		id: string;
		tenant_id: string;
		nazwa: string;
		nip: string | null;
		adres: string | null;
		telefon: string | null;
		email: string | null;
		branza: string | null;
		notatki: string | null;
		broker_id: string | null;
		status: string;
		created_at: string;
		crm_profiles?: { imie_nazwisko: string } | null;
	};

	let prospects = $state<Prospect[]>([]);
	let search = $state('');
	let statusFilter = $state('Wszystkie');
	let showModal = $state(false);
	let editingProspect = $state<Prospect | null>(null);
	let saving = $state(false);
	let formError = $state('');

	// Form fields
	let fNazwa = $state('');
	let fNip = $state('');
	let fAdres = $state('');
	let fTelefon = $state('');
	let fEmail = $state('');
	let fBranza = $state('');
	let fNotatki = $state('');
	let fBrokerId = $state('');
	let fStatus = $state('nowy');

	const statuses = ['Wszystkie', 'Nowy', 'W kontakcie', 'Oferta wysłana', 'Wygrany', 'Przegrany'];
	const statusValues: Record<string, string> = {
		'Nowy': 'nowy',
		'W kontakcie': 'w_kontakcie',
		'Oferta wysłana': 'oferta_wyslana',
		'Wygrany': 'wygrany',
		'Przegrany': 'przegrany'
	};
	const statusLabels: Record<string, string> = {
		'nowy': 'Nowy',
		'w_kontakcie': 'W kontakcie',
		'oferta_wyslana': 'Oferta wysłana',
		'wygrany': 'Wygrany',
		'przegrany': 'Przegrany'
	};

	function statusVariant(s: string): 'info' | 'success' | 'error' | 'warning' {
		if (s === 'wygrany') return 'success';
		if (s === 'przegrany') return 'error';
		if (s === 'oferta_wyslana') return 'warning';
		if (s === 'w_kontakcie') return 'info';
		return 'info';
	}

	const filtered = $derived(
		prospects
			.filter((p) => {
				if (statusFilter !== 'Wszystkie') {
					const val = statusValues[statusFilter];
					if (p.status !== val) return false;
				}
				if (search) {
					const q = search.toLowerCase();
					return p.nazwa.toLowerCase().includes(q) || (p.nip ?? '').includes(q);
				}
				return true;
			})
	);

	async function loadProspects() {
		const { data } = await sb
			.from('crm_prospects')
			.select('*, crm_profiles(imie_nazwisko)')
			.order('created_at', { ascending: false });
		prospects = (data ?? []) as Prospect[];
	}

	onMount(() => {
		loadProspects();
	});

	function openNew() {
		editingProspect = null;
		fNazwa = ''; fNip = ''; fAdres = ''; fTelefon = ''; fEmail = '';
		fBranza = ''; fNotatki = ''; fStatus = 'nowy'; formError = '';
		fBrokerId = appState.profile?.id ?? '';
		showModal = true;
	}

	function openEdit(p: Prospect) {
		editingProspect = p;
		fNazwa = p.nazwa; fNip = p.nip ?? ''; fAdres = p.adres ?? '';
		fTelefon = p.telefon ?? ''; fEmail = p.email ?? '';
		fBranza = p.branza ?? ''; fNotatki = p.notatki ?? '';
		fBrokerId = p.broker_id ?? ''; fStatus = p.status; formError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; editingProspect = null; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			nazwa: fNazwa.trim(),
			nip: fNip.trim() || null,
			adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null,
			email: fEmail.trim() || null,
			branza: fBranza.trim() || null,
			notatki: fNotatki.trim() || null,
			broker_id: fBrokerId || null,
			status: fStatus
		};

		let error;
		if (editingProspect) {
			({ error } = await sb.from('crm_prospects').update(payload).eq('id', editingProspect.id));
		} else {
			({ error } = await sb.from('crm_prospects').insert([{
				tenant_id: appState.profile!.tenant_id,
				...payload
			}]));
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
			nazwa: p.nazwa,
			nip: p.nip,
			ulica: p.adres
		}]);
		if (insertError) { alert('Błąd: ' + insertError.message); return; }

		await sb.from('crm_prospects').update({ status: 'wygrany' }).eq('id', p.id);

		// Refresh both lists
		await loadProspects();
		const { data } = await sb.from('crm_clients').select('*');
		appState.clients = (data ?? []) as typeof appState.clients;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Prospects — FRANK</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Prospects</h1>
		<p class="text-sm text-slate-500 mt-1">Potencjalni klienci i leady sprzedażowe</p>
	</div>
	<button onclick={openNew} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		+ Nowy Prospect
	</button>
</div>

<!-- Status filter buttons -->
<div class="flex items-center gap-2 mb-4 flex-wrap">
	{#each statuses as s}
		<button
			onclick={() => statusFilter = s}
			class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors {statusFilter === s ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}"
		>{s}</button>
	{/each}
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nazwie lub NIP..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nazwa</th>
				<th class="px-5 py-3">NIP</th>
				<th class="px-5 py-3">Kontakt</th>
				<th class="px-5 py-3">Broker</th>
				<th class="px-5 py-3">Status</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as p}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3">
						<div class="font-medium text-slate-900">{p.nazwa}</div>
						{#if p.branza}<div class="text-xs text-slate-400">{p.branza}</div>{/if}
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">{p.nip ?? '—'}</td>
					<td class="px-5 py-3 text-xs text-slate-500">
						{#if p.telefon}<div>{p.telefon}</div>{/if}
						{#if p.email}<div>{p.email}</div>{/if}
						{#if !p.telefon && !p.email}—{/if}
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">{p.crm_profiles?.imie_nazwisko ?? '—'}</td>
					<td class="px-5 py-3">
						<Badge variant={statusVariant(p.status)}>{statusLabels[p.status] ?? p.status}</Badge>
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<button onclick={() => openEdit(p)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</button>
							<button onclick={() => convertToClient(p)} title="Dodaj do Klientów" class="p-1.5 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
								<UserPlus size={14} />
							</button>
						</div>
					</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak prospectów</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title={editingProspect ? `Edytuj — ${editingProspect.nazwa}` : 'Nowy Prospect'} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingProspect ? 'Zapisz zmiany' : 'Zapisz Prospect'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Nazwa firmy / Imię i Nazwisko *</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
			<div><label class={labelCls}>Branża</label><input bind:value={fBranza} class={inputCls} /></div>
		</div>
		<div>
			<label class={labelCls}>Adres</label>
			<input bind:value={fAdres} class={inputCls} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Telefon</label><input bind:value={fTelefon} class={inputCls} /></div>
			<div><label class={labelCls}>Email</label><input bind:value={fEmail} type="email" class={inputCls} /></div>
		</div>
		<div>
			<label class={labelCls}>Notatki</label>
			<textarea bind:value={fNotatki} rows="3" class={inputCls}></textarea>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Broker</label>
				<select bind:value={fBrokerId} class={inputCls}>
					<option value="">— brak —</option>
					{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko}</option>{/each}
				</select>
			</div>
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
		</div>
	</div>
</Modal>
