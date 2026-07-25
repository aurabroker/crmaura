<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { CrmTask } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import { CalendarDays, List, Plus, CheckCircle2, Circle, Clock, AlertCircle, Search, Pencil, Trash2, History, Sun, Moon, Target, User, ExternalLink } from 'lucide-svelte';
	import { onMount } from 'svelte';

	// Schedule-X — komponent-wrapper (izomorficzny) importujemy statycznie,
	// a ciężki rdzeń (referuje DOM) ładujemy dynamicznie w onMount (SPA, ssr=false).
	import { ScheduleXCalendar } from '@schedule-x/svelte';
	import '@schedule-x/theme-default/dist/index.css';

	type FilterStatus = 'all' | 'otwarte' | 'w_toku' | 'zakonczone';
	type FilterPriority = 'all' | 'pilny' | 'wysoki' | 'normalny' | 'niski';
	type Tab = 'calendar' | 'list' | 'rejestr';

	let tab = $state<Tab>('calendar');
	let filterStatus = $state<FilterStatus>('all');
	let filterPriority = $state<FilterPriority>('all');
	let search = $state('');
	let showModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	let saving = $state(false);
	let formError = $state('');

	// Prospects list for modal
	let prospects = $state<Array<{id: string; nazwa: string}>>([]);

	// form fields
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

	// Zadanie powiązane z Prospektem/Klientem — powiązanie jest "na sztywno":
	// pokazujemy je jako klikalny link do karty, a selecty przypisania chowamy.
	const isProspectTask = $derived(!!editingTask?.prospect_id);
	const isLinkedTask = $derived(!!editingTask && (!!editingTask.prospect_id || !!editingTask.klient_id));
	const editingProspectName = $derived(
		editingTask?.crm_prospects?.nazwa
		?? prospects.find(p => p.id === editingTask?.prospect_id)?.nazwa
		?? ''
	);
	const editingClientName = $derived(
		editingTask?.crm_clients?.nazwa
		?? appState.clients.find(c => c.id === editingTask?.klient_id)?.nazwa
		?? ''
	);
	const linkedName = $derived(isProspectTask ? editingProspectName : editingClientName);
	const linkedHref = $derived(
		editingTask?.prospect_id ? `/prospects/${editingTask.prospect_id}`
		: editingTask?.klient_id ? `/clients/${editingTask.klient_id}`
		: ''
	);

	let history = $state<import('$lib/types/database').CrmTaskHistory[]>([]);
	async function loadHistory() {
		const { data } = await sb.from('crm_task_history')
			.select('*, crm_profiles:autor_id(imie_nazwisko)')
			.order('created_at', { ascending: false })
			.limit(100);
		history = (data ?? []) as any;
	}

	const today = new Date().toISOString().slice(0, 10);

	// ---- Filtry (widok Lista) ----
	const filteredTasks = $derived(
		appState.tasks
			.filter(t => filterStatus === 'all' || t.status === filterStatus)
			.filter(t => filterPriority === 'all' || t.priorytet === filterPriority)
			.filter(t =>
				!search ||
				t.tytul.toLowerCase().includes(search.toLowerCase()) ||
				(t.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase())
			)
	);

	// ---- KPI ----
	const openCount = $derived(appState.tasks.filter(t => t.status === 'otwarte' || t.status === 'w_toku').length);
	const overdueCount = $derived(appState.tasks.filter(t =>
		(t.status === 'otwarte' || t.status === 'w_toku') && t.termin && t.termin < today
	).length);
	const doneCount = $derived(appState.tasks.filter(t => t.status === 'zakonczone').length);

	function isOverdue(t: CrmTask) {
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < today;
	}

	// =========================================================================
	//  Schedule-X — mapowanie zadań na eventy + integracja
	// =========================================================================

	// Kolory kalendarzy per priorytet/stan (dopasowane do palety aplikacji).
	const sxCalendars = {
		pilny:    { colorName: 'pilny',    lightColors: { main: '#dc2626', container: '#fee2e2', onContainer: '#7f1d1d' } },
		wysoki:   { colorName: 'wysoki',   lightColors: { main: '#ea580c', container: '#ffedd5', onContainer: '#7c2d12' } },
		normalny: { colorName: 'normalny', lightColors: { main: '#2563eb', container: '#dbeafe', onContainer: '#1e3a8a' } },
		niski:    { colorName: 'niski',    lightColors: { main: '#64748b', container: '#f1f5f9', onContainer: '#334155' } },
		overdue:  { colorName: 'overdue',  lightColors: { main: '#dc2626', container: '#fecaca', onContainer: '#7f1d1d' } },
		done:     { colorName: 'done',     lightColors: { main: '#94a3b8', container: '#f1f5f9', onContainer: '#64748b' } }
	};

	function calId(t: CrmTask): string {
		if (t.status === 'zakonczone') return 'done';
		if (isOverdue(t)) return 'overdue';
		return t.priorytet;
	}

	// Godzina + 1h (koniec eventu), przycięte do końca dnia — bez przechodzenia na kolejny.
	function plusHour(hm: string): string {
		const [h, m] = hm.split(':').map(Number);
		const nh = Math.min((h || 0) + 1, 23);
		return `${String(nh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
	}

	function taskToEvent(t: CrmTask) {
		const d = t.termin!.slice(0, 10);
		const who = t.assigned_profile?.imie_nazwisko ?? t.assigned_profile?.email ?? '';
		const rel = t.crm_clients?.nazwa ?? t.crm_prospects?.nazwa ?? '';
		// Znacznik na kafelku: 🎯 dla zadań prospektowych, 👤 dla klienckich.
		const marker = t.prospect_id ? '🎯 ' : t.klient_id ? '👤 ' : '';
		const base = {
			id: t.id,
			title: marker + t.tytul,
			calendarId: calId(t),
			description: [rel, who ? `→ ${who}` : ''].filter(Boolean).join('  ')
		};
		// Z godziną -> event czasowy 'YYYY-MM-DD HH:mm' (siatka godzin). Bez -> całodniowy 'YYYY-MM-DD'.
		if (t.godzina) {
			const hm = t.godzina.slice(0, 5);
			return { ...base, start: `${d} ${hm}`, end: `${d} ${plusHour(hm)}` };
		}
		return { ...base, start: d, end: d };
	}

	// Buduje eventy z przefiltrowanych zadań (tylko z terminem) — filtry działają też na kalendarzu.
	function buildEvents() {
		return filteredTasks.filter(t => t.termin).map(taskToEvent);
	}

	let calendarApp = $state<any>(null);
	let eventsService: any = null;

	onMount(async () => {
		const { data } = await sb.from('crm_prospects').select('id, nazwa').order('nazwa');
		prospects = data ?? [];
		await loadHistory();

		// Rdzeń Schedule-X — dynamiczny import (browser-only).
		const [{ createCalendar, viewMonthGrid, viewWeek, viewDay, viewMonthAgenda },
			{ createEventsServicePlugin },
			{ createDragAndDropPlugin }] = await Promise.all([
			import('@schedule-x/calendar'),
			import('@schedule-x/events-service'),
			import('@schedule-x/drag-and-drop')
		]);

		eventsService = createEventsServicePlugin();

		calendarApp = createCalendar({
			locale: 'pl-PL',
			firstDayOfWeek: 1,
			views: [viewMonthGrid, viewWeek, viewDay, viewMonthAgenda],
			defaultView: viewMonthGrid.name,
			selectedDate: today,
			calendars: sxCalendars,
			events: buildEvents(),
			plugins: [eventsService, createDragAndDropPlugin()],
			callbacks: {
				onEventClick(event: any) {
					const t = appState.tasks.find(x => x.id === String(event.id));
					if (t) openEdit(t);
				},
				onClickDate(date: string) {
					openNew(date);
				},
				onDoubleClickDate(date: string) {
					openNew(date);
				},
				async onEventUpdate(event: any) {
					const id = String(event.id);
					const s = String(event.start); // 'YYYY-MM-DD' (całodniowe) lub 'YYYY-MM-DD HH:mm' (czasowe)
					const patch: Record<string, string> = { termin: s.slice(0, 10) };
					if (s.length > 10) patch.godzina = s.slice(11, 16); // przeciągnięcie w siatce godzin
					await sb.from('crm_tasks').update(patch).eq('id', id);
					appState.tasks = appState.tasks.map(t => t.id === id ? { ...t, ...patch } : t);
				}
			}
		});
	});

	// Synchronizacja eventów przy każdej zmianie zadań/filtrów (dodanie/edycja/status/DnD).
	$effect(() => {
		const evts = buildEvents(); // czyta filteredTasks -> zależność reaktywna
		if (eventsService && calendarApp) eventsService.set(evts);
	});

	// Dark mode kalendarza (opcjonalny, domyślnie jasny — spójnie z resztą aplikacji).
	let calDark = $state(false);
	function toggleCalDark() {
		calDark = !calDark;
		calendarApp?.setTheme(calDark ? 'dark' : 'light');
	}

	// =========================================================================
	//  CRUD zadań (logika bez zmian względem wersji custom)
	// =========================================================================

	function openNew(date?: string) {
		editingTask = null;
		fTytul = ''; fOpis = ''; fTermin = date ?? ''; fPriorytet = 'normalny';
		fAssigned = appState.profile?.id ?? '';
		fKlient = ''; fPolisa = ''; fProspect = ''; fStatus = 'otwarte';
		fExtraAssignees = []; fCzasTrwania = ''; fPostep = 0; fGodzina = '';
		formError = ''; showModal = true;
	}

	function openEdit(t: CrmTask) {
		editingTask = t;
		fTytul = t.tytul; fOpis = t.opis ?? ''; fTermin = t.termin ?? '';
		fGodzina = t.godzina ? t.godzina.slice(0, 5) : '';
		fPriorytet = t.priorytet; fAssigned = t.assigned_to ?? '';
		fKlient = t.klient_id ?? ''; fPolisa = t.polisa_id ?? '';
		fProspect = t.prospect_id ?? '';
		fStatus = t.status;
		fExtraAssignees = t.extra_assignees ?? [];
		fCzasTrwania = t.czas_trwania_dni ? String(t.czas_trwania_dni) : '';
		fPostep = t.postep_pct ?? 0;
		formError = ''; showModal = true;
	}

	async function reloadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, crm_clients(nazwa), crm_policies(nr_polisy), crm_prospects(nazwa), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.order('termin', { ascending: true, nullsFirst: false });
		appState.tasks = (data ?? []) as typeof appState.tasks;
		await loadHistory();
	}

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
			godzina: fGodzina || null,
			priorytet: fPriorytet,
			status: fStatus,
			extra_assignees: fExtraAssignees,
			czas_trwania_dni: fCzasTrwania ? parseInt(fCzasTrwania) : null,
			postep_pct: fPostep,
			zakonczone_at: fStatus === 'zakonczone' ? new Date().toISOString() : null,
		};
		const { error } = editingTask
			? await sb.from('crm_tasks').update(payload).eq('id', editingTask.id)
			: await sb.from('crm_tasks').insert([payload]);
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		await reloadTasks();
	}

	async function toggleStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		const updates: Record<string, unknown> = {
			status: next,
			zakonczone_at: next === 'zakonczone' ? new Date().toISOString() : null,
			postep_pct: next === 'zakonczone' ? 100 : t.postep_pct
		};
		await sb.from('crm_tasks').update(updates).eq('id', t.id);
		// Record history
		await sb.from('crm_task_history').insert([{
			tenant_id: appState.profile!.tenant_id,
			task_id: t.id,
			tytul_zadania: t.tytul,
			zmiana: next === 'zakonczone' ? 'zakonczone' : 'wznowione',
			stary_status: t.status,
			nowy_status: next,
			autor_id: appState.profile!.id,
			klient_id: t.klient_id,
			prospect_id: t.prospect_id
		}]);
		await reloadTasks();
	}

	async function deleteTask(t: CrmTask) {
		if (!confirm(`Usunąć zadanie: "${t.tytul}"?`)) return;
		await sb.from('crm_tasks').delete().eq('id', t.id);
		await reloadTasks();
	}

	const priorityClsMap: Record<CrmTask['priorytet'], string> = {
		pilny:   'bg-red-100 text-red-700',
		wysoki:  'bg-orange-100 text-orange-700',
		normalny:'bg-blue-100 text-blue-700',
		niski:   'bg-slate-100 text-slate-500'
	};

	const statusIcon = (t: CrmTask) => t.status === 'zakonczone' ? CheckCircle2 : t.status === 'w_toku' ? Clock : Circle;

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Kalendarz — CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900 flex items-center gap-2">
			<CalendarDays size={22} class="text-blue-500" /> Kalendarz / Zadania
		</h1>
		<p class="text-sm text-slate-500 mt-1">Zadania i przypomnienia zespołu</p>
	</div>
	<div class="flex items-center gap-2">
		<!-- Przełącznik zakładek -->
		<div class="flex bg-slate-100 rounded-lg p-1">
			{#each [['calendar','Kalendarz'],['list','Lista'],['rejestr','Rejestr']] as [v, lbl]}
				<button onclick={() => tab = v as Tab}
					class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1
						{tab === v ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">
					{#if v === 'calendar'}<CalendarDays size={13} />{:else if v === 'list'}<List size={13} />{:else}<History size={13} />{/if}
					{lbl}
				</button>
			{/each}
		</div>
		<button onclick={() => openNew()} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center gap-2">
			<Plus size={15} /> Nowe zadanie
		</button>
	</div>
</div>

<!-- KPI strip -->
<div class="grid grid-cols-3 gap-4 mb-5">
	<div class="bg-white border border-line rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Otwarte</div>
		<div class="text-2xl font-bold text-slate-900">{openCount}</div>
	</div>
	<div class="bg-white border border-line rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Przeterminowane</div>
		<div class="text-2xl font-bold {overdueCount > 0 ? 'text-red-600' : 'text-slate-400'}">{overdueCount}</div>
	</div>
	<div class="bg-white border border-line rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Zakończone</div>
		<div class="text-2xl font-bold text-emerald-600">{doneCount}</div>
	</div>
</div>

<!-- Pasek filtrów — wspólny dla Kalendarza i Listy -->
{#if tab !== 'rejestr'}
	<div class="flex gap-3 mb-4 flex-wrap">
		<div class="flex items-center gap-2 flex-1 min-w-[220px] bg-white border border-line rounded-xl px-4 py-2">
			<Search size={15} class="text-slate-400" />
			<input bind:value={search} placeholder="Szukaj zadania lub klienta..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
		</div>
		{#each [['all','Wszystkie'],['otwarte','Otwarte'],['w_toku','W toku'],['zakonczone','Zakończone']] as [val, label]}
			<button onclick={() => filterStatus = val as FilterStatus}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-line hover:bg-slate-50'}">
				{label}
			</button>
		{/each}
		{#each [['all','Priorytety'],['pilny','Pilne'],['wysoki','Wysokie']] as [val, label]}
			<button onclick={() => filterPriority = val as FilterPriority}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterPriority === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-line hover:bg-slate-50'}">
				{label}
			</button>
		{/each}
	</div>
{/if}

<!-- ===== KALENDARZ (Schedule-X) ===== -->
{#if tab === 'calendar'}
<div class="border border-line rounded-xl shadow-sm p-3 sx-app-calendar {calDark ? 'sx-dark' : 'bg-white'}">
	<div class="flex justify-end mb-2">
		<button onclick={toggleCalDark} title="Motyw kalendarza"
			class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-line {calDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-50'} transition-colors">
			{#if calDark}<Sun size={14} /> Jasny{:else}<Moon size={14} /> Ciemny{/if}
		</button>
	</div>
	{#if calendarApp}
		<ScheduleXCalendar {calendarApp} />
	{:else}
		<div class="px-5 py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
			<CalendarDays size={18} class="text-slate-300" /> Ładowanie kalendarza…
		</div>
	{/if}
	<div class="cal-legend flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-3 pb-1 text-[11px] text-slate-500 border-t border-line-soft mt-3">
		<span class="font-semibold text-slate-400 uppercase tracking-wide">Priorytet:</span>
		<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#dc2626]"></span> Pilny</span>
		<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#ea580c]"></span> Wysoki</span>
		<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#2563eb]"></span> Normalny</span>
		<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#64748b]"></span> Niski</span>
		<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-[#94a3b8]"></span> Zakończone</span>
		<span class="text-slate-400">· Przeciągnij zadanie, aby zmienić termin · Kliknij dzień, aby dodać</span>
	</div>
</div>

<!-- ===== LISTA ===== -->
{:else if tab === 'list'}
	<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
		{#if filteredTasks.length === 0}
			<div class="px-5 py-12 text-center text-slate-400">Brak zadań</div>
		{:else}
			<ul class="divide-y divide-line-soft">
				{#each filteredTasks as t}
					{@const done = t.status === 'zakonczone'}
					{@const overdue = isOverdue(t)}
					{@const Icon = statusIcon(t)}
					<li class="flex items-start gap-3 px-5 py-4 hover:bg-slate-50 group {done ? 'opacity-60' : ''}">
						<button onclick={() => toggleStatus(t)} class="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-600 transition-colors">
							<Icon size={18} class={done ? 'text-emerald-500' : t.status === 'w_toku' ? 'text-blue-400' : ''} />
						</button>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-medium text-slate-900 {done ? 'line-through text-slate-400' : ''}">{t.tytul}</span>
								<span class="text-xs px-2 py-0.5 rounded-full font-semibold {priorityClsMap[t.priorytet]}">{t.priorytet}</span>
								{#if overdue}
									<span class="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 flex items-center gap-1">
										<AlertCircle size={11} /> Przeterminowane
									</span>
								{/if}
							</div>
							{#if t.opis}<p class="text-sm text-slate-500 mt-0.5 truncate">{t.opis}</p>{/if}
							<div class="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
								{#if t.termin}<span class="{overdue ? 'text-red-500 font-semibold' : ''}">📅 {t.termin}</span>{/if}
								{#if t.crm_clients}<a href="/clients/{t.klient_id}" class="hover:text-blue-600 hover:underline">{t.crm_clients.nazwa}</a>{/if}
								{#if t.crm_prospects}<a href="/prospects/{t.prospect_id}" class="hover:text-blue-600 hover:underline">{t.crm_prospects.nazwa}</a>{/if}
								{#if t.assigned_profile}<span>→ {t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}</span>{/if}
							</div>
						</div>
						<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
							<button onclick={() => openEdit(t)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
							<button onclick={() => deleteTask(t)} class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

<!-- ===== REJESTR ===== -->
{:else}
<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-line-soft">
		<h2 class="text-sm font-semibold text-slate-700">Rejestr ukończonych zadań</h2>
	</div>
	{#if history.length === 0}
		<div class="px-5 py-10 text-center text-slate-400">Brak wpisów w rejestrze</div>
	{:else}
		<ul class="divide-y divide-line-soft">
			{#each history as h}
				<li class="px-5 py-3 flex items-center gap-3">
					<span class="w-2 h-2 rounded-full shrink-0 {h.nowy_status === 'zakonczone' ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
					<div class="flex-1 min-w-0">
						<span class="text-sm font-medium text-slate-800">{h.tytul_zadania ?? '—'}</span>
						<span class="ml-2 text-xs text-slate-400">
							{h.stary_status ?? '?'} → <strong class="{h.nowy_status === 'zakonczone' ? 'text-emerald-600' : 'text-slate-600'}">{h.nowy_status ?? '?'}</strong>
						</span>
					</div>
					<span class="text-xs text-slate-400 shrink-0">{h.crm_profiles?.imie_nazwisko ?? '—'}</span>
					<span class="text-xs text-slate-400 shrink-0">{new Date(h.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
{/if}

<!-- Modal -->
<Modal windowed title={editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'} open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTask} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (editingTask ? 'Zapisz zmiany' : 'Dodaj zadanie')}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		{#if isLinkedTask}
			<!-- Powiązanie na sztywno + wejście w kartę prospekta/klienta -->
			<a href={linkedHref} onclick={() => { showModal = false; formError = ''; }}
				class="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors">
				<span class="flex items-center gap-2 min-w-0">
					{#if isProspectTask}<Target size={16} class="text-blue-600 shrink-0" />{:else}<User size={16} class="text-blue-600 shrink-0" />{/if}
					<span class="text-[11px] uppercase font-semibold text-blue-500 shrink-0">{isProspectTask ? 'Prospekt' : 'Klient'}</span>
					<span class="font-semibold text-slate-800 truncate">{linkedName || '—'}</span>
				</span>
				<span class="flex items-center gap-1 text-xs font-semibold text-blue-700 shrink-0 whitespace-nowrap">Otwórz kartę <ExternalLink size={13} /></span>
			</a>
		{/if}
		<div>
			<label class={labelCls}>Tytuł *</label>
			<input bind:value={fTytul} class={inputCls} placeholder="Co trzeba zrobić?" />
		</div>
		<div>
			<label class={labelCls}>Opis</label>
			<textarea bind:value={fOpis} class="{inputCls} resize-none" rows="2" placeholder="Szczegóły..."></textarea>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<div>
				<label class={labelCls}>Termin</label>
				<input type="date" bind:value={fTermin} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Godzina</label>
				<input type="time" bind:value={fGodzina} class={inputCls} />
				<p class="text-[11px] text-slate-400 mt-1">puste = całodniowe</p>
			</div>
			<div>
				<label class={labelCls}>Priorytet</label>
				<select bind:value={fPriorytet} class={inputCls}>
					<option value="niski">Niski</option>
					<option value="normalny">Normalny</option>
					<option value="wysoki">Wysoki</option>
					<option value="pilny">Pilny</option>
				</select>
			</div>
		</div>
		{#if isLinkedTask}
			<!-- Powiązanie zablokowane (pokazane w chipie u góry) — tylko Status do zmiany. -->
			<div>
				<label class={labelCls}>Status</label>
				<select bind:value={fStatus} class={inputCls}>
					<option value="otwarte">Otwarte</option>
					<option value="w_toku">W toku</option>
					<option value="zakonczone">Zakończone</option>
					<option value="anulowane">Anulowane</option>
				</select>
			</div>
		{:else}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Status</label>
				<select bind:value={fStatus} class={inputCls}>
					<option value="otwarte">Otwarte</option>
					<option value="w_toku">W toku</option>
					<option value="zakonczone">Zakończone</option>
					<option value="anulowane">Anulowane</option>
				</select>
			</div>
			<div>
				<label class={labelCls}>Klient</label>
				<select bind:value={fKlient} class={inputCls}>
					<option value="">— brak —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Prospect</label>
				<select bind:value={fProspect} class={inputCls}>
					<option value="">— brak —</option>
					{#each prospects as p}<option value={p.id}>{p.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Polisa</label>
				<select bind:value={fPolisa} class={inputCls}>
					<option value="">— brak —</option>
					{#each appState.policies.filter(p => !fKlient || p.klient_id === fKlient) as p}
						<option value={p.id}>{p.nr_polisy}</option>
					{/each}
				</select>
			</div>
		</div>
		{/if}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Przypisz do (główny)</label>
				<select bind:value={fAssigned} class={inputCls}>
					<option value="">— nieprzypisane —</option>
					{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Czas trwania (dni)</label>
				<input type="number" bind:value={fCzasTrwania} min="1" class={inputCls} placeholder="np. 7" />
			</div>
		</div>
		<div>
			<label class={labelCls}>Dodatkowe osoby</label>
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
		<div>
			<label class={labelCls}>Postęp: {fPostep}%</label>
			<input type="range" bind:value={fPostep} min="0" max="100" step="5" class="w-full accent-blue-600" />
		</div>
	</div>
</Modal>

<style>
	/* Schedule-X — dopasowanie do wyglądu aplikacji (Inter, akcent, ramki).
	   Nadpisania jasne zawężone do :not(.is-dark), by nie psuć wbudowanego dark mode. */
	.sx-app-calendar :global(.sx__calendar) {
		font-family: 'Inter', sans-serif;
		border: none;
		--sx-color-primary: #2563eb;
		--sx-color-on-primary: #ffffff;
		--sx-color-primary-container: #dbeafe;
		--sx-color-on-primary-container: #1e3a8a;
	}
	.sx-app-calendar :global(.sx__calendar:not(.is-dark)) {
		--sx-color-surface: #ffffff;
		--sx-color-background: #ffffff;
		--sx-internal-color-text: #0f172a;
		--sx-color-outline-variant: #cbd5e1;
	}
	.sx-app-calendar :global(.sx__calendar-wrapper) {
		border: none;
		min-height: 620px;
	}
	.sx-app-calendar :global(.sx__event) {
		cursor: pointer;
	}

	/* Ciemna karta kalendarza (opcjonalny toggle). */
	.sx-app-calendar.sx-dark {
		background: #0f172a;
		border-color: #1e293b;
	}
	.sx-app-calendar.sx-dark .cal-legend {
		color: #94a3b8;
		border-color: #1e293b;
	}
</style>
