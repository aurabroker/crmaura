<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ArrowLeft, Building2, Phone, Mail, MapPin, Tag, MessageSquare, FileText, Send, StickyNote, Pencil, UserPlus, Trash2, CheckCircle2, Circle, Clock, Plus, AlertCircle } from 'lucide-svelte';
	import type { CrmTask } from '$lib/types/database';

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
		zatrudnienie: number | null;
		broker_id: string | null;
		status: string;
		created_at: string;
		crm_profiles?: { imie_nazwisko: string } | null;
	};

	type Activity = {
		id: string;
		typ: 'notatka' | 'komentarz' | 'wiadomosc';
		tresc: string;
		created_at: string;
		author_id: string | null;
		crm_profiles?: { imie_nazwisko: string } | null;
	};

	const prospectId = $derived($page.params.id);

	let prospect = $state<Prospect | null>(null);
	let activities = $state<Activity[]>([]);
	let loading = $state(true);
	let activeTab = $state<'notatka' | 'komentarz' | 'wiadomosc'>('komentarz');
	let newText = $state('');
	let sending = $state(false);
	let editingProspect = $state(false);

	// edit form
	let fNazwa = $state('');
	let fNip = $state('');
	let fAdres = $state('');
	let fTelefon = $state('');
	let fEmail = $state('');
	let fBranza = $state('');
	let fNotatki = $state('');
	let fZatrudnienie = $state<number | ''>('');
	let fStatus = $state('nowy');
	let saving = $state(false);

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

	function extractZatrudnienie(prospect: Prospect) {
		if (prospect.zatrudnienie != null) return String(prospect.zatrudnienie);
		if (!prospect.notatki) return null;
		const m = prospect.notatki.match(/Zatrudnienie:\s*(\d[\d\s]*)/);
		return m ? m[1].trim() : null;
	}
	function extractWWW(notatki: string | null) {
		if (!notatki) return null;
		const m = notatki.match(/WWW:\s*(https?:\/\/\S+)/);
		return m ? m[1] : null;
	}

	async function load() {
		loading = true;
		const { data: p } = await sb.from('crm_prospects')
			.select('*, crm_profiles(imie_nazwisko)')
			.eq('id', prospectId)
			.single();
		prospect = p as Prospect | null;

		const { data: acts } = await sb.from('crm_prospect_activities')
			.select('*, crm_profiles(imie_nazwisko)')
			.eq('prospect_id', prospectId)
			.order('created_at', { ascending: true });
		activities = (acts ?? []) as Activity[];
		loading = false;
		await loadTasks();
	}

	onMount(load);

	async function addActivity() {
		if (!newText.trim() || !prospect) return;
		sending = true;
		await sb.from('crm_prospect_activities').insert([{
			tenant_id: prospect.tenant_id,
			prospect_id: prospect.id,
			author_id: appState.profile?.id ?? null,
			typ: activeTab,
			tresc: newText.trim()
		}]);
		newText = '';
		sending = false;
		await load();
	}

	async function deleteActivity(id: string) {
		if (!confirm('Usunąć wpis?')) return;
		await sb.from('crm_prospect_activities').delete().eq('id', id);
		await load();
	}

	function startEdit() {
		if (!prospect) return;
		fNazwa = prospect.nazwa; fNip = prospect.nip ?? ''; fAdres = prospect.adres ?? '';
		fTelefon = prospect.telefon ?? ''; fEmail = prospect.email ?? '';
		fBranza = prospect.branza ?? ''; fNotatki = prospect.notatki ?? '';
		fZatrudnienie = prospect.zatrudnienie ?? '';
		fStatus = prospect.status;
		editingProspect = true;
	}

	async function saveEdit() {
		if (!prospect || !fNazwa.trim()) return;
		saving = true;
		await sb.from('crm_prospects').update({
			nazwa: fNazwa.trim(), nip: fNip.trim() || null, adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null, email: fEmail.trim() || null,
			branza: fBranza.trim() || null, notatki: fNotatki.trim() || null,
			zatrudnienie: fZatrudnienie !== '' ? Number(fZatrudnienie) : null,
			status: fStatus
		}).eq('id', prospect.id);
		saving = false;
		editingProspect = false;
		await load();
	}

	async function convertToClient() {
		if (!prospect) return;
		if (!confirm(`Przenieść "${prospect.nazwa}" do Klientów?`)) return;
		const { error } = await sb.from('crm_clients').insert([{
			tenant_id: appState.profile!.tenant_id,
			opiekun_id: appState.profile!.id,
			nazwa: prospect.nazwa, nip: prospect.nip, ulica: prospect.adres
		}]);
		if (error) { alert('Błąd: ' + error.message); return; }
		await sb.from('crm_prospects').update({ status: 'wygrany' }).eq('id', prospect.id);
		goto('/prospects');
	}

	const typLabels = { notatka: 'Notatka', komentarz: 'Komentarz', wiadomosc: 'Wiadomość' };
	const typColors: Record<string, string> = {
		notatka: 'bg-amber-50 border-amber-200 text-amber-800',
		komentarz: 'bg-blue-50 border-blue-200 text-blue-800',
		wiadomosc: 'bg-emerald-50 border-emerald-200 text-emerald-800'
	};

	function formatDate(dt: string) {
		return new Date(dt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// ---- Tasks ----
	let tasks = $state<CrmTask[]>([]);
	let showTaskModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);

	const today = new Date().toISOString().slice(0, 10);

	async function loadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.eq('prospect_id', prospectId)
			.order('termin', { ascending: true, nullsFirst: false });
		tasks = (data ?? []) as CrmTask[];
	}

	function openNewTask() {
		editingTask = null;
		showTaskModal = true;
	}

	function openEditTask(t: CrmTask) {
		editingTask = t;
		showTaskModal = true;
	}

	async function toggleTaskStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		await sb.from('crm_tasks').update({ status: next }).eq('id', t.id);
		await loadTasks();
	}

	async function deleteTask(t: CrmTask) {
		if (!confirm(`Usunąć zadanie: "${t.tytul}"?`)) return;
		await sb.from('crm_tasks').delete().eq('id', t.id);
		await loadTasks();
	}

	function isOverdue(t: CrmTask) {
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < today;
	}

	const priorityDotMap: Record<CrmTask['priorytet'], string> = {
		pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300'
	};

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>{prospect?.nazwa ?? 'Prospect'} — CRM</title></svelte:head>

<div class="mb-5">
	<button onclick={() => goto('/prospects')} class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
		<ArrowLeft size={15} /> Powrót do Prospects
	</button>
</div>

{#if loading}
	<div class="text-center text-slate-400 py-16">Ładowanie...</div>
{:else if !prospect}
	<div class="text-center text-slate-400 py-16">Nie znaleziono prospect.</div>
{:else}
	{@const zatrud = extractZatrudnienie(prospect)}
	{@const www = extractWWW(prospect.notatki)}

	<!-- Header -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-5">
		{#if editingProspect}
			<div class="space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<div class="col-span-2">
						<label class={labelCls}>Nazwa *</label>
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
					<div class="col-span-2"><label class={labelCls}>Notatki</label><textarea bind:value={fNotatki} rows="2" class={inputCls}></textarea></div>
				</div>
				<div class="flex gap-2 pt-1">
					<button onclick={saveEdit} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
						{saving ? 'Zapisuję...' : 'Zapisz'}
					</button>
					<button onclick={() => editingProspect = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
						Anuluj
					</button>
				</div>
			</div>
		{:else}
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-3 flex-wrap mb-2">
						<h1 class="text-xl font-bold text-slate-900 leading-tight">{prospect.nazwa}</h1>
						<Badge variant={statusVariant(prospect.status)}>{statusLabels[prospect.status] ?? prospect.status}</Badge>
					</div>
					<div class="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm mt-3">
						{#if prospect.nip}
							<div class="flex items-center gap-2 text-slate-600">
								<Tag size={13} class="text-slate-400 shrink-0" />
								<span>NIP: <strong>{prospect.nip}</strong></span>
							</div>
						{/if}
						{#if prospect.branza}
							<div class="flex items-center gap-2 text-slate-600">
								<Building2 size={13} class="text-slate-400 shrink-0" />
								<span class="truncate">{prospect.branza}</span>
							</div>
						{/if}
						{#if zatrud}
							<div class="flex items-center gap-2 text-slate-600">
								<span class="text-slate-400 text-xs font-bold">👥</span>
								<span>Zatrudnienie: <strong>{zatrud} os.</strong></span>
							</div>
						{/if}
						{#if prospect.telefon}
							<div class="flex items-center gap-2 text-slate-600">
								<Phone size={13} class="text-slate-400 shrink-0" />
								<span>{prospect.telefon}</span>
							</div>
						{/if}
						{#if prospect.email}
							<div class="flex items-center gap-2 text-slate-600">
								<Mail size={13} class="text-slate-400 shrink-0" />
								<a href="mailto:{prospect.email}" class="text-blue-600 hover:underline truncate">{prospect.email}</a>
							</div>
						{/if}
						{#if prospect.adres}
							<div class="flex items-center gap-2 text-slate-600 col-span-2">
								<MapPin size={13} class="text-slate-400 shrink-0" />
								<span>{prospect.adres}</span>
							</div>
						{/if}
						{#if www}
							<div class="flex items-center gap-2 text-slate-600 col-span-2">
								<span class="text-slate-400 text-xs">🌐</span>
								<a href={www} target="_blank" rel="noopener" class="text-blue-600 hover:underline truncate">{www}</a>
							</div>
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-1 shrink-0">
					<button onclick={startEdit} title="Edytuj" class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
						<Pencil size={15} />
					</button>
					<button onclick={convertToClient} title="Konwertuj do Klienta" class="p-2 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
						<UserPlus size={15} />
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Tasks -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm mb-5">
		<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-slate-700 flex items-center gap-2">
				<CheckCircle2 size={15} class="text-blue-500" /> Zadania
				{#if tasks.filter(t => t.status !== 'zakonczone').length > 0}
					<span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{tasks.filter(t => t.status !== 'zakonczone').length}</span>
				{/if}
			</h2>
			<button onclick={openNewTask} class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700">
				<Plus size={12} /> Nowe zadanie
			</button>
		</div>
		{#if tasks.length === 0}
			<div class="px-6 py-6 text-center text-slate-400 text-sm">Brak zadań — dodaj pierwsze zadanie dla tej firmy</div>
		{:else}
			<ul class="divide-y divide-slate-100">
				{#each tasks as t}
					{@const done = t.status === 'zakonczone'}
					{@const overdue = isOverdue(t)}
					<li class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group {done ? 'opacity-60' : ''}">
						<button onclick={() => toggleTaskStatus(t)} class="shrink-0 text-slate-400 hover:text-emerald-600 transition-colors">
							{#if done}
								<CheckCircle2 size={16} class="text-emerald-500" />
							{:else if t.status === 'w_toku'}
								<Clock size={16} class="text-blue-400" />
							{:else}
								<Circle size={16} />
							{/if}
						</button>
						<span class="w-2 h-2 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
						<div class="flex-1 min-w-0">
							<span class="text-sm font-medium text-slate-900 {done ? 'line-through text-slate-400' : ''}">{t.tytul}</span>
							{#if t.opis}<p class="text-xs text-slate-400 truncate">{t.opis}</p>{/if}
							{#if t.extra_assignees && t.extra_assignees.length > 0}
								<div class="flex items-center gap-1 mt-0.5">
									{#each t.extra_assignees as uid}
										{@const p = appState.brokers.find(b => b.id === uid)}
										{#if p}<span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{p.imie_nazwisko ?? p.email}</span>{/if}
									{/each}
								</div>
							{/if}
							{#if t.czas_trwania_dni}
								{@const pct = t.postep_pct ?? 0}
								<div class="flex items-center gap-2 mt-1">
									<div class="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
										<div class="h-full rounded-full bg-blue-500" style="width:{pct}%"></div>
									</div>
									<span class="text-[10px] text-slate-400">{pct}%</span>
								</div>
							{/if}
						</div>
						{#if t.termin}
							<span class="text-xs shrink-0 {overdue ? 'text-red-500 font-semibold' : 'text-slate-400'}">
								{#if overdue}<AlertCircle size={11} class="inline mr-0.5" />{/if}
								{t.termin}
							</span>
						{/if}
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
							<button onclick={() => openEditTask(t)} class="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"><Pencil size={12} /></button>
							<button onclick={() => deleteTask(t)} class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Activity feed -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm">
		<div class="px-6 pt-5 pb-4 border-b border-slate-100">
			<h2 class="text-sm font-semibold text-slate-700 mb-3">Aktywność</h2>
			<!-- Tab selector -->
			<div class="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
				{#each ['komentarz', 'notatka', 'wiadomosc'] as typ}
					<button
						onclick={() => activeTab = typ as typeof activeTab}
						class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors {activeTab === typ ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}"
					>{typLabels[typ as keyof typeof typLabels]}</button>
				{/each}
			</div>
		</div>

		<!-- Feed -->
		<div class="divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
			{#if activities.length === 0}
				<div class="px-6 py-8 text-center text-slate-400 text-sm">Brak aktywności — dodaj pierwszy wpis poniżej</div>
			{/if}
			{#each activities as act}
				<div class="px-6 py-4 flex gap-3 group">
					<div class="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0 mt-0.5">
						{(act.crm_profiles?.imie_nazwisko ?? 'U').charAt(0).toUpperCase()}
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-1 flex-wrap">
							<span class="text-xs font-semibold text-slate-700">{act.crm_profiles?.imie_nazwisko ?? 'Użytkownik'}</span>
							<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border {typColors[act.typ]}">{typLabels[act.typ]}</span>
							<span class="text-[11px] text-slate-400">{formatDate(act.created_at)}</span>
						</div>
						<p class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{act.tresc}</p>
					</div>
					<button onclick={() => deleteActivity(act.id)} class="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-500 transition-all self-start shrink-0">
						<Trash2 size={12} />
					</button>
				</div>
			{/each}
		</div>

		<!-- Input -->
		<div class="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-xl">
			<textarea
				bind:value={newText}
				placeholder="Dodaj {typLabels[activeTab].toLowerCase()}..."
				rows="3"
				class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
				onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addActivity(); }}
			></textarea>
			<div class="flex items-center justify-between mt-2">
				<span class="text-xs text-slate-400">Ctrl+Enter aby wysłać</span>
				<button
					onclick={addActivity}
					disabled={sending || !newText.trim()}
					class="inline-flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-40 transition-colors"
				>
					<Send size={13} /> Dodaj {typLabels[activeTab]}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Task Modal -->
<TaskModal
	open={showTaskModal}
	onclose={() => { showTaskModal = false; }}
	onsaved={loadTasks}
	editingTask={editingTask}
	presetProspectId={prospectId}
	presetProspectNazwa={prospect?.nazwa ?? ''}
/>
