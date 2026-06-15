<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { CrmTask } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import { onMount } from 'svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
		onsaved?: () => void;
		editingTask?: CrmTask | null;
		presetKlientId?: string;
		presetKlientNazwa?: string;
		presetProspectId?: string;
		presetProspectNazwa?: string;
	}

	let { open, onclose, onsaved, editingTask = null, presetKlientId = '', presetKlientNazwa = '', presetProspectId = '', presetProspectNazwa = '' }: Props = $props();

	let prospects = $state<Array<{id: string; nazwa: string}>>([]);
	onMount(async () => {
		const { data } = await sb.from('crm_prospects').select('id, nazwa').order('nazwa');
		prospects = data ?? [];
	});

	let fTytul = $state('');
	let fOpis = $state('');
	let fTermin = $state('');
	let fPriorytet = $state<CrmTask['priorytet']>('normalny');
	let fAssigned = $state('');
	let fKlient = $state('');
	let fPolisa = $state('');
	let fProspect = $state('');
	let fExtraAssignees = $state<string[]>([]);
	let fCzasTrwania = $state('');
	let fPostep = $state(0);
	let fStatus = $state<CrmTask['status']>('otwarte');
	let saving = $state(false);
	let formError = $state('');

	$effect(() => {
		if (open) {
			if (editingTask) {
				fTytul = editingTask.tytul;
				fOpis = editingTask.opis ?? '';
				fTermin = editingTask.termin ?? '';
				fPriorytet = editingTask.priorytet;
				fAssigned = editingTask.assigned_to ?? '';
				fKlient = editingTask.klient_id ?? presetKlientId;
				fPolisa = editingTask.polisa_id ?? '';
				fProspect = editingTask.prospect_id ?? presetProspectId;
				fStatus = editingTask.status;
				fExtraAssignees = editingTask.extra_assignees ?? [];
				fCzasTrwania = editingTask.czas_trwania_dni ? String(editingTask.czas_trwania_dni) : '';
				fPostep = editingTask.postep_pct ?? 0;
			} else {
				fTytul = ''; fOpis = ''; fTermin = ''; fPriorytet = 'normalny';
				fAssigned = appState.profile?.id ?? '';
				fKlient = presetKlientId; fPolisa = ''; fProspect = presetProspectId;
				fStatus = 'otwarte'; fExtraAssignees = []; fCzasTrwania = ''; fPostep = 0;
			}
			formError = '';
		}
	});

	async function saveTask() {
		if (!fTytul.trim()) { formError = 'Podaj tytuł zadania.'; return; }
		saving = true; formError = '';
		const payload = {
			tenant_id: appState.profile!.tenant_id,
			created_by: appState.profile!.id,
			assigned_to: fAssigned || null,
			klient_id: fKlient || null,
			polisa_id: fPolisa || null,
			prospect_id: fProspect || null,
			tytul: fTytul.trim(),
			opis: fOpis || null,
			termin: fTermin || null,
			priorytet: fPriorytet,
			status: fStatus,
			extra_assignees: fExtraAssignees.length > 0 ? fExtraAssignees : null,
			czas_trwania_dni: fCzasTrwania ? parseInt(fCzasTrwania) : null,
			postep_pct: fPostep
		};
		if (editingTask) {
			await sb.from('crm_tasks').update(payload).eq('id', editingTask.id);
		} else {
			await sb.from('crm_tasks').insert([payload]);
		}
		// Refresh global tasks
		const { data } = await sb.from('crm_tasks')
			.select('*, crm_clients(nazwa), crm_policies(nr_polisy), crm_prospects(nazwa), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.order('termin', { ascending: true, nullsFirst: false });
		appState.tasks = (data ?? []) as typeof appState.tasks;
		saving = false;
		onsaved?.();
		onclose();
	}

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<Modal title={editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'} open={open} onclose={onclose}>
	{#snippet footer()}
		<button onclick={onclose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTask} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (editingTask ? 'Zapisz zmiany' : 'Dodaj zadanie')}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<!-- Tytuł (full width) -->
		<div>
			<label class={lbl}>Tytuł *</label>
			<input bind:value={fTytul} class={inp} placeholder="Co trzeba zrobić?" />
		</div>
		<!-- Opis -->
		<div>
			<label class={lbl}>Opis</label>
			<textarea bind:value={fOpis} class="{inp} resize-none" rows="2" placeholder="Szczegóły..."></textarea>
		</div>
		<!-- Termin | Priorytet -->
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl}>Termin</label>
				<input type="date" bind:value={fTermin} class={inp} />
			</div>
			<div>
				<label class={lbl}>Priorytet</label>
				<select bind:value={fPriorytet} class={inp}>
					<option value="niski">Niski</option>
					<option value="normalny">Normalny</option>
					<option value="wysoki">Wysoki</option>
					<option value="pilny">Pilny</option>
				</select>
			</div>
		</div>
		<!-- Status | Klient -->
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl}>Status</label>
				<select bind:value={fStatus} class={inp}>
					<option value="otwarte">Otwarte</option>
					<option value="w_toku">W toku</option>
					<option value="zakonczone">Zakończone</option>
					<option value="anulowane">Anulowane</option>
				</select>
			</div>
			<div>
				<label class={lbl}>Klient</label>
				{#if presetKlientId}
					<div class="text-sm font-medium text-slate-700 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">{presetKlientNazwa ?? presetKlientId}</div>
				{:else}
					<select bind:value={fKlient} class={inp}>
						<option value="">— brak —</option>
						{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
					</select>
				{/if}
			</div>
		</div>
		<!-- Prospect | Polisa -->
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl}>Prospect</label>
				{#if presetProspectId}
					<div class="text-sm font-medium text-slate-700 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">{presetProspectNazwa ?? presetProspectId}</div>
				{:else}
					<select bind:value={fProspect} class={inp}>
						<option value="">— brak —</option>
						{#each prospects as p}<option value={p.id}>{p.nazwa}</option>{/each}
					</select>
				{/if}
			</div>
			<div>
				<label class={lbl}>Polisa</label>
				<select bind:value={fPolisa} class={inp}>
					<option value="">— brak —</option>
					{#each appState.policies.filter(p => !fKlient || p.klient_id === fKlient) as p}
						<option value={p.id}>{p.nr_polisy}</option>
					{/each}
				</select>
			</div>
		</div>
		<!-- Przypisz do | Czas trwania -->
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl}>Przypisz do (główny)</label>
				<select bind:value={fAssigned} class={inp}>
					<option value="">— nieprzypisane —</option>
					{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>{/each}
				</select>
			</div>
			<div>
				<label class={lbl}>Czas trwania (dni)</label>
				<input type="number" bind:value={fCzasTrwania} min="1" class={inp} placeholder="np. 7" />
			</div>
		</div>
		<!-- Dodatkowe osoby -->
		<div>
			<label class={lbl}>Dodatkowe osoby</label>
			<div class="flex flex-wrap gap-2 mt-1">
				{#each appState.brokers.filter(b => b.id !== fAssigned) as b}
					<label class="flex items-center gap-1.5 cursor-pointer text-sm">
						<input type="checkbox"
							checked={fExtraAssignees.includes(b.id)}
							onchange={() => {
								if (fExtraAssignees.includes(b.id)) {
									fExtraAssignees = fExtraAssignees.filter(x => x !== b.id);
								} else {
									fExtraAssignees = [...fExtraAssignees, b.id];
								}
							}}
							class="w-4 h-4 accent-blue-600"
						/>
						{b.imie_nazwisko ?? b.email}
					</label>
				{/each}
			</div>
		</div>
		<!-- Postęp -->
		<div>
			<label class={lbl}>Postęp: {fPostep}%</label>
			<input type="range" bind:value={fPostep} min="0" max="100" step="5" class="w-full accent-blue-600" />
		</div>
	</div>
</Modal>
