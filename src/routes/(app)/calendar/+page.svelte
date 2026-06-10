<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { CrmTask } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import { CalendarDays, List, Plus, CheckCircle2, Circle, Clock, AlertCircle, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { onMount } from 'svelte';

	type FilterStatus = 'all' | 'otwarte' | 'w_toku' | 'zakonczone';
	type FilterPriority = 'all' | 'pilny' | 'wysoki' | 'normalny' | 'niski';
	type ViewMode = 'month' | 'week' | 'day' | 'list' | 'rejestr';

	let viewMode = $state<ViewMode>('month');
	let filterStatus = $state<FilterStatus>('all');
	let filterPriority = $state<FilterPriority>('all');
	let search = $state('');
	let showModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	let saving = $state(false);
	let formError = $state('');

	// Calendar nav — anchor date
	let navDate = $state(new Date());

	// Drag state
	let dragTaskId = $state<string | null>(null);

	// Prospects list for modal
	let prospects = $state<Array<{id: string; nazwa: string}>>([]);
	onMount(async () => {
		const { data } = await sb.from('crm_prospects').select('id, nazwa').order('nazwa');
		prospects = data ?? [];
	});

	// form fields
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

	let history = $state<import('$lib/types/database').CrmTaskHistory[]>([]);
	async function loadHistory() {
		const { data } = await sb.from('crm_task_history')
			.select('*, crm_profiles:autor_id(imie_nazwisko)')
			.order('created_at', { ascending: false })
			.limit(100);
		history = (data ?? []) as any;
	}

	const today = new Date().toISOString().slice(0, 10);

	const DAYS_SHORT = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
	const DAYS_FULL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
	const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

	// ---- Derived nav values ----
	const navYear = $derived(navDate.getFullYear());
	const navMonth = $derived(navDate.getMonth());
	const navDay = $derived(navDate.getDate());

	// Week start (Monday of navDate's week)
	const weekStart = $derived(() => {
		const d = new Date(navDate);
		const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
		d.setDate(d.getDate() - dow);
		return d;
	});

	function dateStr(d: Date) {
		return d.toISOString().slice(0, 10);
	}

	function addDays(d: Date, n: number) {
		const r = new Date(d);
		r.setDate(r.getDate() + n);
		return r;
	}

	const weekDays = $derived(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart(), i)));

	// ---- Navigation ----
	function prev() {
		const d = new Date(navDate);
		if (viewMode === 'month') { d.setMonth(d.getMonth() - 1); d.setDate(1); }
		else if (viewMode === 'week') d.setDate(d.getDate() - 7);
		else if (viewMode === 'day') d.setDate(d.getDate() - 1);
		navDate = d;
	}
	function next() {
		const d = new Date(navDate);
		if (viewMode === 'month') { d.setMonth(d.getMonth() + 1); d.setDate(1); }
		else if (viewMode === 'week') d.setDate(d.getDate() + 7);
		else if (viewMode === 'day') d.setDate(d.getDate() + 1);
		navDate = d;
	}
	function goToday() { navDate = new Date(); }

	// ---- Title ----
	const navTitle = $derived(() => {
		if (viewMode === 'month') return `${MONTHS[navMonth]} ${navYear}`;
		if (viewMode === 'week') {
			const ws = weekStart();
			const we = addDays(ws, 6);
			if (ws.getMonth() === we.getMonth()) return `${ws.getDate()}–${we.getDate()} ${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`;
			return `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;
		}
		return `${navDay} ${MONTHS[navMonth]} ${navYear}`;
	});

	// ---- Filters ----
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

	// Tasks indexed by date
	const tasksByDate = $derived(() => {
		const map: Record<string, CrmTask[]> = {};
		for (const t of appState.tasks) {
			if (t.termin) {
				const d = t.termin.slice(0, 10);
				if (!map[d]) map[d] = [];
				map[d].push(t);
			}
		}
		return map;
	});

	// Month grid cells
	const calDays = $derived(() => {
		const firstDay = new Date(navYear, navMonth, 1);
		let startDow = firstDay.getDay();
		startDow = startDow === 0 ? 6 : startDow - 1;
		const daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
		const cells: Array<{ date: string | null; day: number | null }> = [];
		for (let i = 0; i < startDow; i++) cells.push({ date: null, day: null });
		for (let d = 1; d <= daysInMonth; d++) {
			const mm = String(navMonth + 1).padStart(2, '0');
			const dd = String(d).padStart(2, '0');
			cells.push({ date: `${navYear}-${mm}-${dd}`, day: d });
		}
		while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
		return cells;
	});

	// KPI
	const openCount = $derived(appState.tasks.filter(t => t.status === 'otwarte' || t.status === 'w_toku').length);
	const overdueCount = $derived(appState.tasks.filter(t =>
		(t.status === 'otwarte' || t.status === 'w_toku') && t.termin && t.termin < today
	).length);
	const doneCount = $derived(appState.tasks.filter(t => t.status === 'zakonczone').length);

	function openNew(date?: string) {
		editingTask = null;
		fTytul = ''; fOpis = ''; fTermin = date ?? ''; fPriorytet = 'normalny';
		fAssigned = appState.profile?.id ?? '';
		fKlient = ''; fPolisa = ''; fProspect = ''; fStatus = 'otwarte';
		fExtraAssignees = []; fCzasTrwania = ''; fPostep = 0;
		formError = ''; showModal = true;
	}

	function openEdit(t: CrmTask) {
		editingTask = t;
		fTytul = t.tytul; fOpis = t.opis ?? ''; fTermin = t.termin ?? '';
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

	// ---- Drag & Drop ----
	function onDragStart(e: DragEvent, taskId: string) {
		dragTaskId = taskId;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', taskId);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
	}

	async function onDrop(e: DragEvent, date: string) {
		e.preventDefault();
		const id = dragTaskId ?? e.dataTransfer!.getData('text/plain');
		dragTaskId = null;
		if (!id || !date) return;
		await sb.from('crm_tasks').update({ termin: date }).eq('id', id);
		await reloadTasks();
	}

	function onDragEnd() { dragTaskId = null; }

	const priorityClsMap: Record<CrmTask['priorytet'], string> = {
		pilny:   'bg-red-100 text-red-700',
		wysoki:  'bg-orange-100 text-orange-700',
		normalny:'bg-blue-100 text-blue-700',
		niski:   'bg-slate-100 text-slate-500'
	};
	const priorityDotMap: Record<CrmTask['priorytet'], string> = {
		pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300'
	};

	const statusIcon = (t: CrmTask) => t.status === 'zakonczone' ? CheckCircle2 : t.status === 'w_toku' ? Clock : Circle;

	function isOverdue(t: CrmTask) {
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < today;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
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
		<!-- View toggle -->
		<div class="flex bg-slate-100 rounded-lg p-1">
			{#each [['month','Miesiąc'],['week','Tydzień'],['day','Dzień'],['list','Lista']] as [v, lbl]}
				<button onclick={() => viewMode = v as ViewMode}
					class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1
						{viewMode === v ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">
					{#if v === 'month'}<CalendarDays size={13} />{:else if v === 'list'}<List size={13} />{/if}
					{lbl}
				</button>
			{/each}
			<button onclick={() => viewMode = 'rejestr'}
				class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors {viewMode === 'rejestr' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">
				Rejestr
			</button>
		</div>
		<button onclick={() => openNew()} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center gap-2">
			<Plus size={15} /> Nowe zadanie
		</button>
	</div>
</div>

<!-- KPI strip -->
<div class="grid grid-cols-3 gap-4 mb-5">
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Otwarte</div>
		<div class="text-2xl font-bold text-slate-900">{openCount}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Przeterminowane</div>
		<div class="text-2xl font-bold {overdueCount > 0 ? 'text-red-600' : 'text-slate-400'}">{overdueCount}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Zakończone</div>
		<div class="text-2xl font-bold text-emerald-600">{doneCount}</div>
	</div>
</div>

<!-- Nav bar (for calendar views) -->
{#if viewMode !== 'list' && viewMode !== 'rejestr'}
<div class="flex items-center gap-3 mb-4">
	<button onclick={prev} class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronLeft size={18} /></button>
	<button onclick={next} class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronRight size={18} /></button>
	<h2 class="text-base font-semibold text-slate-900 min-w-[200px]">{navTitle()}</h2>
	<button onclick={goToday} class="px-3 py-1 text-xs font-semibold border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Dziś</button>
</div>
{/if}

<!-- ===== MONTH VIEW ===== -->
{#if viewMode === 'month'}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="grid grid-cols-7 border-b border-slate-100">
		{#each DAYS_SHORT as d}
			<div class="text-center text-[11px] font-semibold text-slate-400 uppercase py-2">{d}</div>
		{/each}
	</div>
	<div class="grid grid-cols-7">
		{#each calDays() as cell, i}
			{@const isToday = cell.date === today}
			{@const dayTasks = cell.date ? (tasksByDate()[cell.date] ?? []) : []}
			{@const isWeekend = (i % 7) >= 5}
			{@const isDragOver = false}
			<div
				class="min-h-[90px] border-b border-r border-slate-100 p-1.5 transition-colors
					{cell.date ? 'cursor-default' : 'bg-slate-50/50'}
					{isWeekend && cell.date ? 'bg-orange-50/30' : ''}
					{cell.date ? 'hover:bg-slate-50' : ''}"
				ondragover={cell.date ? onDragOver : undefined}
				ondrop={cell.date ? (e) => onDrop(e, cell.date!) : undefined}
			>
				{#if cell.day}
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-semibold {isToday ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]' : 'text-slate-600'}">{cell.day}</span>
						{#if cell.date}
							<button onclick={() => openNew(cell.date!)} class="w-4 h-4 rounded flex items-center justify-center text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-all text-[10px] font-bold leading-none">+</button>
						{/if}
					</div>
					<div class="space-y-0.5">
						{#each dayTasks.slice(0, 3) as t}
							{@const overdue = isOverdue(t)}
							<button
								draggable="true"
								ondragstart={(e) => onDragStart(e, t.id)}
								ondragend={onDragEnd}
								onclick={() => openEdit(t)}
								class="w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded font-medium truncate flex items-center gap-1 transition-colors cursor-grab active:cursor-grabbing
									{t.status === 'zakonczone' ? 'bg-slate-100 text-slate-400 line-through' : overdue ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'}
									{dragTaskId === t.id ? 'opacity-40' : ''}"
								title={t.tytul}
							>
								<span class="w-1.5 h-1.5 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
								<span class="truncate">{t.tytul}</span>
								{#if t.czas_trwania_dni && t.status !== 'zakonczone'}
									{@const pct = t.postep_pct ?? 0}
									<div class="w-full h-0.5 bg-white/50 rounded-full mt-0.5">
										<div class="h-0.5 rounded-full bg-current" style="width:{pct}%"></div>
									</div>
								{/if}
							</button>
						{/each}
						{#if dayTasks.length > 3}
							<div class="text-[10px] text-slate-400 px-1">+{dayTasks.length - 3} więcej</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<!-- ===== WEEK VIEW ===== -->
{:else if viewMode === 'week'}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="grid grid-cols-7 border-b border-slate-100">
		{#each weekDays() as d, i}
			{@const ds = dateStr(d)}
			{@const isToday = ds === today}
			<div class="text-center py-3 {isToday ? 'bg-blue-50' : ''} {i >= 5 ? 'bg-orange-50/40' : ''}">
				<div class="text-[11px] font-semibold text-slate-400 uppercase">{DAYS_SHORT[i]}</div>
				<div class="text-lg font-bold mt-0.5 {isToday ? 'text-blue-600' : 'text-slate-700'}">{d.getDate()}</div>
			</div>
		{/each}
	</div>
	<div class="grid grid-cols-7 min-h-[300px]">
		{#each weekDays() as d, i}
			{@const ds = dateStr(d)}
			{@const dayTasks = tasksByDate()[ds] ?? []}
			{@const isWeekend = i >= 5}
			<div
				class="border-r border-slate-100 p-2 min-h-[200px] {isWeekend ? 'bg-orange-50/20' : 'hover:bg-slate-50'} transition-colors"
				ondragover={onDragOver}
				ondrop={(e) => onDrop(e, ds)}
			>
				<button onclick={() => openNew(ds)} class="w-full text-left text-[10px] text-slate-300 hover:text-blue-500 mb-1 flex items-center gap-1 py-0.5">
					<Plus size={10} /> nowe
				</button>
				<div class="space-y-1">
					{#each dayTasks as t}
						{@const overdue = isOverdue(t)}
						<button
							draggable="true"
							ondragstart={(e) => onDragStart(e, t.id)}
							ondragend={onDragEnd}
							onclick={() => openEdit(t)}
							class="w-full text-left text-[11px] leading-tight px-2 py-1 rounded font-medium transition-colors cursor-grab active:cursor-grabbing
								{t.status === 'zakonczone' ? 'bg-slate-100 text-slate-400 line-through' : overdue ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'}
								{dragTaskId === t.id ? 'opacity-40' : ''}"
							title={t.tytul}
						>
							<div class="flex items-center gap-1.5 truncate">
								<span class="w-1.5 h-1.5 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
								<span class="truncate">{t.tytul}</span>
							</div>
							{#if t.czas_trwania_dni && t.status !== 'zakonczone'}
								{@const pct = t.postep_pct ?? 0}
								<div class="w-full h-0.5 bg-white/50 rounded-full mt-0.5">
									<div class="h-0.5 rounded-full bg-current" style="width:{pct}%"></div>
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

<!-- ===== DAY VIEW ===== -->
{:else if viewMode === 'day'}
{@const dayStr = `${navYear}-${String(navMonth+1).padStart(2,'0')}-${String(navDay).padStart(2,'0')}`}
{@const dayTasks = tasksByDate()[dayStr] ?? []}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
		<div>
			<span class="text-sm font-semibold text-slate-500 uppercase">{DAYS_FULL[(new Date(navDate).getDay() + 6) % 7]}</span>
			<div class="text-2xl font-bold text-slate-900 mt-0.5">{navTitle()}</div>
		</div>
		<button onclick={() => openNew(dayStr)} class="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700">
			<Plus size={14} /> Dodaj zadanie
		</button>
	</div>
	{#if dayTasks.length === 0}
		<div class="px-5 py-12 text-center text-slate-400">
			<CalendarDays size={32} class="mx-auto mb-3 text-slate-200" />
			Brak zadań na ten dzień
		</div>
	{:else}
		<ul class="divide-y divide-slate-100">
			{#each dayTasks as t}
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
								<span class="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 flex items-center gap-1"><AlertCircle size={11} /> Przeterminowane</span>
							{/if}
						</div>
						{#if t.opis}<p class="text-sm text-slate-500 mt-0.5">{t.opis}</p>{/if}
						<div class="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
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

<!-- ===== LIST VIEW ===== -->
{:else}
	<div class="flex gap-3 mb-4 flex-wrap">
		<div class="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2">
			<Search size={15} class="text-slate-400" />
			<input bind:value={search} placeholder="Szukaj zadania lub klienta..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
		</div>
		{#each [['all','Wszystkie'],['otwarte','Otwarte'],['w_toku','W toku'],['zakonczone','Zakończone']] as [val, label]}
			<button onclick={() => filterStatus = val as FilterStatus}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}">
				{label}
			</button>
		{/each}
		{#each [['all','Priorytety'],['pilny','Pilne'],['wysoki','Wysokie']] as [val, label]}
			<button onclick={() => filterPriority = val as FilterPriority}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterPriority === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}">
				{label}
			</button>
		{/each}
	</div>

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		{#if filteredTasks.length === 0}
			<div class="px-5 py-12 text-center text-slate-400">Brak zadań</div>
		{:else}
			<ul class="divide-y divide-slate-100">
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

{:else if viewMode === 'rejestr'}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-slate-100">
		<h2 class="text-sm font-semibold text-slate-700">Rejestr ukończonych zadań</h2>
	</div>
	{#if history.length === 0}
		<div class="px-5 py-10 text-center text-slate-400">Brak wpisów w rejestrze</div>
	{:else}
		<ul class="divide-y divide-slate-100">
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
<Modal title={editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'} open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTask} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (editingTask ? 'Zapisz zmiany' : 'Dodaj zadanie')}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Tytuł *</label>
			<input bind:value={fTytul} class={inputCls} placeholder="Co trzeba zrobić?" />
		</div>
		<div>
			<label class={labelCls}>Opis</label>
			<textarea bind:value={fOpis} class="{inputCls} resize-none" rows="2" placeholder="Szczegóły..."></textarea>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Termin</label>
				<input type="date" bind:value={fTermin} class={inputCls} />
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
