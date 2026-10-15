<script lang="ts">
	// Jedna karta zadania dla całego CRM: pulpit, kalendarz, karta klienta, karta leada.
	// Powiązanie („Dotyczy”) to jeden klient albo jeden lead — z karty przychodzi na sztywno (preset),
	// z pulpitu / kalendarza wybiera się je wyszukiwarką; lead z kartoteki niesie też swojego klienta.
	import { wczytajZadania } from '$lib/kolekcje';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { CrmTask } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import { onMount } from 'svelte';
	import { ExternalLink, FileText, Search, Target, User, X } from 'lucide-svelte';
	import { TYPY_ZADAN, zapiszHistorieZadania } from '$lib/zadania';
	import { adresWniosku, fmtData, wniosekNowy } from '$lib/components/renewal/crmRenewals';
	import { etykietaDecyzji } from '$lib/renewals/staffApi';
	import { ETAPY } from '$lib/sprzedaz';
	import { miastoZAdresu } from '$lib/utils';

	interface Props {
		open: boolean;
		onclose: () => void;
		onsaved?: () => void;
		editingTask?: CrmTask | null;
		/** Z karty klienta: zadanie dotyczy tego klienta (na sztywno). */
		presetKlientId?: string;
		presetKlientNazwa?: string;
		/** Z karty leada: zadanie dotyczy tego leada (na sztywno); lead z kartoteki podaje też presetKlientId. */
		presetProspectId?: string;
		presetProspectNazwa?: string;
		/** Nowe zadanie do wniosku online (pulpit: „+ Zadanie” przy wniosku, który czeka na polisę). */
		presetRenewalId?: string;
		presetTytul?: string;
		presetTermin?: string;
		/** Okno przeciągane / zmniejszane (kalendarz). */
		windowed?: boolean;
	}

	let {
		open,
		onclose,
		onsaved,
		editingTask = null,
		presetKlientId = '',
		presetKlientNazwa = '',
		presetProspectId = '',
		presetProspectNazwa = '',
		presetRenewalId = '',
		presetTytul = '',
		presetTermin = '',
		windowed = false
	}: Props = $props();

	type Lead = { id: string; nazwa: string; status: string; klient_id: string | null };
	let leady = $state<Lead[]>([]);
	onMount(async () => {
		const { data } = await sb.from('crm_prospects').select('id, nazwa, status, klient_id').order('nazwa');
		leady = (data ?? []) as Lead[];
	});
	const etapLeada = (status: string) => ETAPY.find((e) => e.key === status)?.label ?? status;

	let fTytul = $state('');
	let fOpis = $state('');
	let fTermin = $state('');
	let fGodzina = $state('');
	let fPriorytet = $state<CrmTask['priorytet']>('normalny');
	let fAssigned = $state('');
	let fKlient = $state('');
	let fPolisa = $state('');
	let fProspect = $state('');
	let fExtraAssignees = $state<string[]>([]);
	let fCzasTrwania = $state('');
	let fPostep = $state(0);
	let fStatus = $state<CrmTask['status']>('otwarte');
	let fTypy = $state<string[]>([]);
	let szukaj = $state('');
	let saving = $state(false);
	let formError = $state('');

	$effect(() => {
		if (open) {
			if (editingTask) {
				fTytul = editingTask.tytul;
				fOpis = editingTask.opis ?? '';
				fTermin = editingTask.termin ?? '';
				fGodzina = editingTask.godzina ? editingTask.godzina.slice(0, 5) : '';
				fPriorytet = editingTask.priorytet;
				fAssigned = editingTask.assigned_to ?? '';
				fKlient = editingTask.klient_id ?? presetKlientId;
				fPolisa = editingTask.polisa_id ?? '';
				fProspect = editingTask.prospect_id ?? presetProspectId;
				fStatus = editingTask.status;
				fExtraAssignees = editingTask.extra_assignees ?? [];
				fCzasTrwania = editingTask.czas_trwania_dni ? String(editingTask.czas_trwania_dni) : '';
				fPostep = editingTask.postep_pct ?? 0;
				fTypy = editingTask.typy ?? [];
			} else {
				fTytul = presetTytul; fOpis = ''; fTermin = presetTermin; fGodzina = ''; fPriorytet = 'normalny';
				fAssigned = appState.profile?.id ?? '';
				fKlient = presetKlientId; fPolisa = ''; fProspect = presetProspectId;
				fStatus = 'otwarte'; fExtraAssignees = []; fCzasTrwania = ''; fPostep = 0;
				fTypy = presetRenewalId ? ['wniosek'] : [];
			}
			szukaj = '';
			formError = '';
		}
	});

	// Wniosek online powiązany z zadaniem (zadanie z wniosku albo nowe zadanie do wniosku z pulpitu).
	const renewalId = $derived(editingTask ? (editingTask.renewal_id ?? '') : presetRenewalId);
	const wniosek = $derived(renewalId ? (appState.wnioskiOdnowien.find((w) => w.id === renewalId) ?? null) : null);
	const wniosekHref = $derived(wniosek ? adresWniosku(wniosek) : renewalId && fKlient ? `/clients/${fKlient}?tab=apk` : '');

	// Powiązanie z karty albo z wniosku jest na sztywno; wybrane wyszukiwarką można zmienić (✕).
	const naSztywno = $derived(!!presetKlientId || !!presetProspectId || !!renewalId);

	function nazwaKlienta(id: string): string {
		return appState.clients.find((c) => c.id === id)?.nazwa || (editingTask?.klient_id === id ? editingTask.crm_clients?.nazwa : '') || (presetKlientId === id ? presetKlientNazwa : '') || id;
	}
	function nazwaLeada(id: string): string {
		return leady.find((l) => l.id === id)?.nazwa || (editingTask?.prospect_id === id ? editingTask.crm_prospects?.nazwa : '') || (presetProspectId === id ? presetProspectNazwa : '') || id;
	}

	type Wynik = { typ: 'klient' | 'lead'; id: string; nazwa: string; opis: string; klientId: string | null };
	const wyniki = $derived.by((): Wynik[] => {
		const f = szukaj.trim().toLowerCase();
		if (f.length < 2) return [];
		const cyfry = f.replace(/\D/g, '');
		const klienci = appState.clients
			.filter((c) => c.nazwa.toLowerCase().includes(f) || (c.nazwa_skrocona ?? '').toLowerCase().includes(f) || (cyfry.length >= 3 && (c.nip ?? '').replace(/\D/g, '').includes(cyfry)))
			.slice(0, 6)
			.map((c): Wynik => ({ typ: 'klient', id: c.id, nazwa: c.nazwa, opis: [c.nip ? `NIP ${c.nip}` : '', miastoZAdresu(c.ulica)].filter(Boolean).join(' · '), klientId: c.id }));
		const leadyW = leady
			.filter((l) => l.nazwa.toLowerCase().includes(f))
			.slice(0, 5)
			.map((l): Wynik => ({ typ: 'lead', id: l.id, nazwa: l.nazwa, opis: etapLeada(l.status), klientId: l.klient_id }));
		return [...klienci, ...leadyW];
	});
	function wybierz(w: Wynik) {
		if (w.typ === 'klient') { fKlient = w.id; fProspect = ''; }
		else { fProspect = w.id; fKlient = w.klientId ?? ''; }
		fPolisa = '';
		szukaj = '';
	}
	function wyczyscPowiazanie() { fKlient = ''; fProspect = ''; fPolisa = ''; szukaj = ''; }

	// Polisy wybranego klienta (bez kosza); polisa już przypięta do zadania zostaje na liście.
	const polisyKlienta = $derived(fKlient ? appState.policies.filter((p) => (p.klient_id === fKlient && !p.deleted_at) || p.id === fPolisa) : []);

	function przelaczTyp(val: string) {
		fTypy = fTypy.includes(val) ? fTypy.filter((x) => x !== val) : [...fTypy, val];
	}

	async function saveTask() {
		if (!fTytul.trim()) { formError = 'Podaj tytuł zadania.'; return; }
		saving = true; formError = '';
		const zakonczone = fStatus === 'zakonczone';
		const bylZakonczony = editingTask?.status === 'zakonczone';
		const payload = {
			tenant_id: appState.profile!.tenant_id,
			created_by: editingTask?.created_by ?? appState.profile!.id,
			assigned_to: fAssigned || null,
			klient_id: fKlient || null,
			polisa_id: fPolisa || null,
			prospect_id: fProspect || null,
			renewal_id: renewalId || null,
			tytul: fTytul.trim(),
			opis: fOpis || null,
			termin: fTermin || null,
			godzina: fGodzina || null,
			priorytet: fPriorytet,
			status: fStatus,
			typy: fTypy,
			extra_assignees: fExtraAssignees.length > 0 ? fExtraAssignees : null,
			czas_trwania_dni: fCzasTrwania ? parseInt(fCzasTrwania) : null,
			postep_pct: zakonczone ? 100 : fPostep,
			zakonczone_at: zakonczone ? (bylZakonczony ? (editingTask?.zakonczone_at ?? new Date().toISOString()) : new Date().toISOString()) : null,
			updated_at: new Date().toISOString()
		};
		const { error } = editingTask
			? await sb.from('crm_tasks').update(payload as never).eq('id', editingTask.id)
			: await sb.from('crm_tasks').insert([payload] as never);
		if (error) {
			saving = false;
			formError = `Nie udało się zapisać zadania: ${error.message}`;
			return;
		}
		// Zmiana statusu z formularza trafia do rejestru jak kliknięcie w kółko przy zadaniu.
		if (editingTask && editingTask.status !== fStatus) await zapiszHistorieZadania(editingTask, fStatus, appState.profile!.id);
		const { data, error: e2 } = await wczytajZadania();
		if (!e2 && data) appState.tasks = data as typeof appState.tasks;
		saving = false;
		onsaved?.();
		onclose();
	}

	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
	const chip = 'flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50';
</script>

<Modal title={editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'} open={open} onclose={onclose} {windowed}>
	{#snippet footer()}
		<button onclick={onclose} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTask} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (editingTask ? 'Zapisz zmiany' : 'Dodaj zadanie')}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		{#if renewalId}
			<!-- Zadanie z wniosku online: wejście w wniosek (karta polisy albo karta klienta → APK) -->
			<a href={wniosekHref || '#'} data-testid="zadanie-wniosek" onclick={onclose} class="{chip} hover:bg-blue-100 transition-colors">
				<span class="flex items-center gap-2 min-w-0">
					<FileText size={16} class="text-blue-600 shrink-0" />
					<span class="text-xs uppercase font-semibold text-blue-500 shrink-0">{wniosek ? (wniosekNowy(wniosek) ? 'Pierwsza polisa' : 'Odnowienie') : 'Wniosek'}</span>
					<span class="text-sm text-slate-800 truncate">
						{#if wniosek}
							{etykietaDecyzji(wniosek.decyzja, wniosek.rodzaj)}{wniosek.nr_polisy ? ` · ${wniosek.nr_polisy}` : ''}{wniosek.zlozono_at ? ` · złożony ${fmtData(wniosek.zlozono_at)}` : ''}{wniosek.apk_at ? (wniosek.apk_odmowa ? ' · APK: odmowa' : ' · APK wypełniona') : ''}
						{:else}
							Wniosek klienta złożony online
						{/if}
					</span>
				</span>
				<span class="flex items-center gap-1 text-xs font-semibold text-blue-700 shrink-0 whitespace-nowrap">Otwórz wniosek <ExternalLink size={13} /></span>
			</a>
		{/if}

		<!-- Dotyczy: jeden klient albo jeden lead (z karty — na sztywno; z pulpitu / kalendarza — wyszukiwarka) -->
		<div data-testid="zadanie-dotyczy">
			<span class={lbl}>Dotyczy</span>
			{#if fProspect || fKlient}
				{@const lead = !!fProspect}
				<div class={chip}>
					<span class="flex items-center gap-2 min-w-0">
						{#if lead}<Target size={16} class="text-blue-600 shrink-0" />{:else}<User size={16} class="text-blue-600 shrink-0" />{/if}
						<span class="text-xs uppercase font-semibold text-blue-500 shrink-0">{lead ? 'Lead' : 'Klient'}</span>
						<span class="font-semibold text-slate-800 truncate">{lead ? nazwaLeada(fProspect) : nazwaKlienta(fKlient)}</span>
					</span>
					<span class="flex items-center gap-3 shrink-0">
						<a href={lead ? `/prospects/${fProspect}` : `/clients/${fKlient}`} onclick={onclose} class="flex items-center gap-1 text-xs font-semibold text-blue-700 whitespace-nowrap hover:underline">Otwórz kartę <ExternalLink size={13} /></a>
						{#if lead && fKlient}
							<a href="/clients/{fKlient}" onclick={onclose} class="text-xs font-semibold text-blue-700 whitespace-nowrap hover:underline">karta klienta</a>
						{/if}
						{#if !naSztywno}
							<button type="button" onclick={wyczyscPowiazanie} title="Zmień powiązanie" aria-label="Zmień powiązanie" class="text-blue-400 hover:text-blue-700"><X size={15} /></button>
						{/if}
					</span>
				</div>
			{:else}
				<div class="relative">
					<Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
					<input bind:value={szukaj} class="{inp} pl-8" placeholder="Klient albo lead — nazwa lub NIP (puste: zadanie bez powiązania)" autocomplete="off" aria-label="Szukaj klienta lub leada" />
				</div>
				{#if szukaj.trim().length >= 2}
					<ul class="mt-1 border border-line rounded-lg divide-y divide-line-soft max-h-56 overflow-y-auto" role="listbox" aria-label="Wyniki wyszukiwania">
						{#each wyniki as w (w.typ + w.id)}
							<li role="option" aria-selected="false">
								<button type="button" onclick={() => wybierz(w)} class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50">
									<span class="shrink-0 px-1.5 rounded text-[11px] font-semibold {w.typ === 'lead' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}">{w.typ === 'lead' ? 'Lead' : 'Klient'}</span>
									<span class="font-medium text-slate-800 truncate">{w.nazwa}</span>
									{#if w.opis}<span class="text-xs text-slate-400 truncate">{w.opis}</span>{/if}
								</button>
							</li>
						{:else}
							<li class="px-3 py-2 text-sm text-slate-400">Nic nie znaleziono.</li>
						{/each}
					</ul>
				{/if}
			{/if}
			{#if fKlient && polisyKlienta.length}
				<div class="mt-2 flex items-center gap-2">
					<label class="text-sm text-slate-600 shrink-0" for="zadanie-polisa">Polisa</label>
					<select id="zadanie-polisa" bind:value={fPolisa} class={inp}>
						<option value="">— bez polisy —</option>
						{#each polisyKlienta as p (p.id)}
							<option value={p.id}>{p.nr_polisy}{p.rodzaj ? ` · ${p.rodzaj}` : ''}</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>

		<div>
			<label class={lbl} for="zadanie-tytul">Tytuł *</label>
			<input id="zadanie-tytul" bind:value={fTytul} class={inp} placeholder="Co trzeba zrobić?" />
		</div>
		<div>
			<label class={lbl} for="zadanie-opis">Opis</label>
			<textarea id="zadanie-opis" bind:value={fOpis} class="{inp} resize-none" rows="2" placeholder="Szczegóły..."></textarea>
		</div>
		<div>
			<span class={lbl}>Rodzaj</span>
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Rodzaj zadania">
				{#each TYPY_ZADAN as typ (typ.val)}
					<button type="button" aria-pressed={fTypy.includes(typ.val)} onclick={() => przelaczTyp(typ.val)}
						class="h-7 px-2.5 rounded-full text-[13px] font-medium border transition-colors
							{fTypy.includes(typ.val) ? 'bg-accent text-white border-accent' : 'bg-white text-slate-600 border-line hover:bg-slate-50'}">
						{typ.label}
					</button>
				{/each}
			</div>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<div>
				<label class={lbl} for="zadanie-termin">Termin</label>
				<input id="zadanie-termin" type="date" bind:value={fTermin} class={inp} />
			</div>
			<div>
				<label class={lbl} for="zadanie-godzina">Godzina</label>
				<input id="zadanie-godzina" type="time" bind:value={fGodzina} class={inp} />
			</div>
			<div>
				<label class={lbl} for="zadanie-priorytet">Priorytet</label>
				<select id="zadanie-priorytet" bind:value={fPriorytet} class={inp}>
					<option value="niski">Niski</option>
					<option value="normalny">Normalny</option>
					<option value="wysoki">Wysoki</option>
					<option value="pilny">Pilny</option>
				</select>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="zadanie-status">Status</label>
				<select id="zadanie-status" bind:value={fStatus} class={inp}>
					<option value="otwarte">Otwarte</option>
					<option value="w_toku">W toku</option>
					<option value="zakonczone">Zakończone</option>
					<option value="anulowane">Anulowane</option>
				</select>
			</div>
			<div>
				<label class={lbl} for="zadanie-opiekun">Przypisz do</label>
				<select id="zadanie-opiekun" bind:value={fAssigned} class={inp}>
					<option value="">— nieprzypisane —</option>
					{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>{/each}
				</select>
			</div>
		</div>
		<div>
			<span class={lbl}>Dodatkowe osoby</span>
			<div class="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
				{#each appState.brokers.filter(b => b.id !== fAssigned) as b (b.id)}
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
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="zadanie-czas">Czas trwania (dni)</label>
				<input id="zadanie-czas" type="number" bind:value={fCzasTrwania} min="1" class={inp} placeholder="np. 7" />
			</div>
			<div>
				<label class={lbl} for="zadanie-postep">Postęp: {fPostep}%</label>
				<input id="zadanie-postep" type="range" bind:value={fPostep} min="0" max="100" step="5" class="w-full accent-blue-600 mt-3" />
			</div>
		</div>
	</div>
</Modal>
