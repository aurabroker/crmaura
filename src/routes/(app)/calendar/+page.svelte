<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { CrmTask } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import { CalendarDays, List, Plus, CheckCircle2, Circle, Clock, AlertCircle, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-svelte';

	type FilterStatus = 'all' | 'otwarte' | 'w_toku' | 'zakonczone';
	type FilterPriority = 'all' | 'pilny' | 'wysoki' | 'normalny' | 'niski';
	type ViewMode = 'calendar' | 'list';

	let viewMode = $state<ViewMode>('calendar');
	let filterStatus = $state<FilterStatus>('all');
	let filterPriority = $state<FilterPriority>('all');
	let search = $state('');
	let showModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	let saving = $state(false);
	let formError = $state('');

	// Calendar nav
	let calYear = $state(new Date().getFullYear());
	let calMonth = $state(new Date().getMonth()); // 0-indexed

	// form fields
	let fTytul = $state('');
	let fOpis = $state('');
	let fTermin = $state('');
	let fPriorytet = $state<CrmTask['priorytet']>('normalny');
	let fAssigned = $state('');
	let fKlient = $state('');
	let fPolisa = $state('');
	let fStatus = $state<CrmTask['status']>('otwarte');

	const today = new Date().toISOString().slice(0, 10);

	const DAYS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
	const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

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

	// Tasks indexed by date string for calendar view
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

	// Calendar grid: days of current month
	const calDays = $derived(() => {
		const firstDay = new Date(calYear, calMonth, 1);
		// Monday-first: getDay() returns 0=Sun,1=Mon,...
		let startDow = firstDay.getDay(); // 0=Sun
		startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0
		const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
		const cells: Array<{ date: string | null; day: number | null }> = [];
		for (let i = 0; i < startDow; i++) cells.push({ date: null, day: null });
		for (let d = 1; d <= daysInMonth; d++) {
			const mm = String(calMonth + 1).padStart(2, '0');
			const dd = String(d).padStart(2, '0');
			cells.push({ date: `${calYear}-${mm}-${dd}`, day: d });
		}
		// pad to complete last row
		while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
		return cells;
	});

	function prevMonth() {
		if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
	}
	function nextMonth() {
		if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
	}

	const openCount = $derived(appState.tasks.filter(t => t.status === 'otwarte' || t.status === 'w_toku').length);
	const overdueCount = $derived(appState.tasks.filter(t =>
		(t.status === 'otwarte' || t.status === 'w_toku') && t.termin && t.termin < today
	).length);
	const doneCount = $derived(appState.tasks.filter(t => t.status === 'zakonczone').length);

	function openNew(date?: string) {
		editingTask = null;
		fTytul = ''; fOpis = ''; fTermin = date ?? ''; fPriorytet = 'normalny';
		fAssigned = appState.profile?.id ?? '';
		fKlient = ''; fPolisa = ''; fStatus = 'otwarte';
		formError = ''; showModal = true;
	}

	function openEdit(t: CrmTask) {
		editingTask = t;
		fTytul = t.tytul; fOpis = t.opis ?? ''; fTermin = t.termin ?? '';
		fPriorytet = t.priorytet; fAssigned = t.assigned_to ?? '';
		fKlient = t.klient_id ?? ''; fPolisa = t.polisa_id ?? '';
		fStatus = t.status;
		formError = ''; showModal = true;
	}

	async function reloadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, crm_clients(nazwa), crm_policies(nr_polisy), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.order('termin', { ascending: true, nullsFirst: false });
		appState.tasks = (data ?? []) as typeof appState.tasks;
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
			tytul: fTytul.trim(),
			opis: fOpis || null,
			termin: fTermin || null,
			priorytet: fPriorytet,
			status: fStatus
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
		await sb.from('crm_tasks').update({ status: next }).eq('id', t.id);
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
			<button onclick={() => viewMode = 'calendar'} class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 {viewMode === 'calendar' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">
				<CalendarDays size={13} /> Kalendarz
			</button>
			<button onclick={() => viewMode = 'list'} class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 {viewMode === 'list' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}">
				<List size={13} /> Lista
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

{#if viewMode === 'calendar'}
	<!-- Calendar grid -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<!-- Month nav -->
		<div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
			<button onclick={prevMonth} class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronLeft size={18} /></button>
			<h2 class="text-base font-semibold text-slate-900">{MONTHS[calMonth]} {calYear}</h2>
			<button onclick={nextMonth} class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronRight size={18} /></button>
		</div>
		<!-- Day headers -->
		<div class="grid grid-cols-7 border-b border-slate-100">
			{#each DAYS as d}
				<div class="text-center text-[11px] font-semibold text-slate-400 uppercase py-2">{d}</div>
			{/each}
		</div>
		<!-- Days grid -->
		<div class="grid grid-cols-7">
			{#each calDays() as cell, i}
				{@const isToday = cell.date === today}
				{@const dayTasks = cell.date ? (tasksByDate()[cell.date] ?? []) : []}
				{@const isWeekend = (i % 7) >= 5}
				<div
					class="min-h-[90px] border-b border-r border-slate-100 p-1.5 {cell.date ? 'hover:bg-slate-50 cursor-default' : 'bg-slate-50/50'} {isWeekend && cell.date ? 'bg-orange-50/30' : ''}"
				>
					{#if cell.day}
						<div class="flex items-center justify-between mb-1">
							<span class="text-xs font-semibold {isToday ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]' : 'text-slate-600'}">{cell.day}</span>
							{#if cell.date}
								<button onclick={() => openNew(cell.date!)} class="opacity-0 hover:opacity-100 group-hover:opacity-100 w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-[10px] font-bold leading-none">+</button>
							{/if}
						</div>
						<div class="space-y-0.5">
							{#each dayTasks.slice(0, 3) as t}
								{@const overdue = isOverdue(t)}
								<button
									onclick={() => openEdit(t)}
									class="w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded font-medium truncate flex items-center gap-1 transition-colors
										{t.status === 'zakonczone' ? 'bg-slate-100 text-slate-400 line-through' : overdue ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'}"
									title={t.tytul}
								>
									<span class="w-1.5 h-1.5 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
									<span class="truncate">{t.tytul}</span>
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

{:else}
	<!-- List view -->
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
								{#if t.crm_policies}<a href="/policies/{t.polisa_id}" class="hover:text-blue-600 hover:underline">{t.crm_policies.nr_polisy}</a>{/if}
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
				<label class={labelCls}>Przypisz do</label>
				<select bind:value={fAssigned} class={inputCls}>
					<option value="">— nieprzypisane —</option>
					{#each appState.brokers as b}<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>{/each}
				</select>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient</label>
				<select bind:value={fKlient} class={inputCls}>
					<option value="">— brak —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
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
	</div>
</Modal>
