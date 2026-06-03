<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState, isAdmin } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { Insurer, Profile } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Pencil, UserPlus, Mail } from 'lucide-svelte';

	onMount(() => { if (!isAdmin(appState.profile)) goto('/dashboard'); });

	async function authHeaders(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` };
	}

	// --- TU ---
	let showTU = $state(false);
	let editingTU = $state<Insurer | null>(null);
	let fNazwa = $state(''); let fDzial = $state('Majątkowy');
	let fUlica = $state(''); let fNip = $state(''); let fKrs = $state('');
	let savingTU = $state(false); let tuError = $state('');

	function openNewTU() { editingTU = null; fNazwa=''; fDzial='Majątkowy'; fUlica=''; fNip=''; fKrs=''; tuError=''; showTU=true; }
	function openEditTU(t: Insurer) { editingTU=t; fNazwa=t.nazwa; fDzial=t.dzial; fUlica=t.ulica??''; fNip=t.nip??''; fKrs=t.krs??''; tuError=''; showTU=true; }

	async function saveTU() {
		if (!fNazwa.trim()) { tuError='Podaj nazwę TU'; return; }
		savingTU=true; tuError='';
		const payload = { nazwa: fNazwa.trim(), dzial: fDzial, ulica: fUlica||null, nip: fNip||null, krs: fKrs||null };
		let error;
		if (editingTU) ({ error } = await sb.from('crm_insurers').update(payload).eq('id', editingTU.id));
		else ({ error } = await sb.from('crm_insurers').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		savingTU=false;
		if (error) { tuError=error.message; return; }
		showTU=false;
		const { data } = await sb.from('crm_insurers').select('*').order('nazwa');
		appState.insurers = (data??[]) as typeof appState.insurers;
	}

	// --- UŻYTKOWNICY ---
	let showInvite = $state(false);
	let showEditUser = $state(false);
	let editingUser = $state<Profile | null>(null);

	let iEmail = $state(''); let iNazwa = $state(''); let iRole = $state('BROKER'); let iStanowisko = $state('');
	let inviting = $state(false); let inviteError = $state(''); let inviteSuccess = $state(''); let tempPassword = $state('');

	let uRole = $state('BROKER'); let uNazwa = $state(''); let uStanowisko = $state('');
	let savingUser = $state(false); let userError = $state('');

	const ROLES = ['BROKER', 'ADMINISTRACJA', 'BOARD', 'ADMIN BROKER', 'ADMIN GOD'];

	function openEditUser(b: Profile) {
		editingUser=b; uRole=b.rola; uNazwa=b.imie_nazwisko??''; uStanowisko=b.stanowisko??'';
		userError=''; showEditUser=true;
	}

	async function inviteUser() {
		if (!iEmail.trim()) { inviteError='Podaj email.'; return; }
		inviting=true; inviteError=''; inviteSuccess='';
		const res = await fetch('/api/admin/invite', {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({
				email: iEmail.trim(),
				role: iRole,
				imie_nazwisko: iNazwa.trim() || null
			})
		});
		inviting=false;
		if (!res.ok) { const d = await res.json(); inviteError = d.message ?? 'Błąd'; return; }
		const d = await res.json();
		tempPassword = d.tempPassword ?? '';
		inviteSuccess = iEmail;
		iEmail=''; iNazwa=''; iRole='BROKER'; iStanowisko='';
		const { data } = await sb.from('crm_profiles').select('*');
		appState.brokers = (data??[]) as typeof appState.brokers;
	}

	async function saveUserRole() {
		if (!editingUser) return;
		savingUser=true; userError='';
		const res = await fetch('/api/admin/update-role', {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({ user_id: editingUser.id, role: uRole, imie_nazwisko: uNazwa, stanowisko: uStanowisko })
		});
		savingUser=false;
		if (!res.ok) { const d = await res.json(); userError = d.message ?? 'Błąd'; return; }
		showEditUser=false;
		const { data } = await sb.from('crm_profiles').select('*');
		appState.brokers = (data??[]) as typeof appState.brokers;
	}

	const roleVariant = (r: string) =>
		r === 'ADMIN GOD' ? 'error' :
		r === 'ADMIN BROKER' ? 'warning' :
		r === 'BOARD' ? 'info' : 'neutral';

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Administracja — FRANK</title></svelte:head>

<h1 class="text-2xl font-semibold text-slate-900 mb-1">Administracja Systemem</h1>
<p class="text-sm text-slate-500 mb-6">Zarządzanie Towarzystwami, zespołem i rolami</p>

<div class="grid grid-cols-2 gap-6 mb-6">
	<!-- TU -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Towarzystwa Ubezpieczeniowe</h2>
			<button onclick={openNewTU} class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50">+ Dodaj TU</button>
		</div>
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-3">Nazwa</th>
					<th class="px-5 py-3">Dział</th>
					<th class="px-5 py-3">NIP / KRS</th>
					<th class="px-5 py-3"></th>
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
							<button onclick={() => openEditTU(t)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
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
		<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Zespół (Brokerzy)</h2>
			<button onclick={() => { showInvite=true; inviteError=''; inviteSuccess=''; tempPassword=''; }} class="flex items-center gap-1.5 text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 hover:bg-slate-700">
				<UserPlus size={13} /> Dodaj użytkownika
			</button>
		</div>
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-3">Imię / Email</th>
					<th class="px-5 py-3">Rola</th>
					<th class="px-5 py-3">Stanowisko</th>
					<th class="px-5 py-3"></th>
				</tr>
			</thead>
			<tbody>
				{#each appState.brokers as b}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-3">
							<div class="font-medium">{b.imie_nazwisko ?? b.email}</div>
							<div class="text-xs text-slate-400">{b.email}</div>
						</td>
						<td class="px-5 py-3"><Badge variant={roleVariant(b.rola)}>{b.rola}</Badge></td>
						<td class="px-5 py-3 text-sm text-slate-500">{b.stanowisko ?? '—'}</td>
						<td class="px-5 py-3">
							{#if b.id !== appState.profile?.id}
								<button onclick={() => openEditUser(b)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak użytkowników</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- Modal: TU -->
<Modal title={editingTU ? `Edytuj TU — ${editingTU.nazwa}` : 'Nowe Towarzystwo (TU)'} open={showTU} onclose={() => { showTU=false; tuError=''; }}>
	{#snippet footer()}
		<button onclick={() => { showTU=false; tuError=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTU} disabled={savingTU} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingTU ? 'Zapisywanie...' : editingTU ? 'Zapisz zmiany' : 'Zapisz TU'}
		</button>
	{/snippet}
	{#if tuError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{tuError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Nazwa TU *</label><input bind:value={fNazwa} class={inputCls} /></div>
			<div>
				<label class={labelCls}>Dział *</label>
				<select bind:value={fDzial} class={inputCls}><option>Majątkowy</option><option>Życiowy</option></select>
			</div>
		</div>
		<div><label class={labelCls}>Adres</label><input bind:value={fUlica} class={inputCls} /></div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
			<div><label class={labelCls}>KRS</label><input bind:value={fKrs} class={inputCls} /></div>
		</div>
	</div>
</Modal>

<!-- Modal: Zaproś użytkownika -->
<Modal title="Utwórz konto użytkownika" open={showInvite} onclose={() => { showInvite=false; inviteSuccess=''; tempPassword=''; }}>
	{#snippet footer()}
		<button onclick={() => { showInvite=false; inviteSuccess=''; tempPassword=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
		{#if !inviteSuccess}
			<button onclick={inviteUser} disabled={inviting} class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				<UserPlus size={14} /> {inviting ? 'Tworzenie...' : 'Utwórz konto'}
			</button>
		{/if}
	{/snippet}
	{#if inviteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</div>{/if}
	{#if inviteSuccess}
		<div class="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 space-y-2">
			<div>✓ Konto utworzone dla <strong>{inviteSuccess}</strong></div>
			<div>Tymczasowe hasło (przekaż użytkownikowi):</div>
			<div class="font-mono text-base bg-white border border-emerald-300 rounded px-3 py-2 tracking-widest select-all">{tempPassword}</div>
			<div class="text-xs text-emerald-600">Użytkownik może zmienić hasło po zalogowaniu w ustawieniach konta.</div>
		</div>
	{:else}
		<div class="space-y-3">
			<div><label class={labelCls}>E-mail *</label><input type="email" bind:value={iEmail} class={inputCls} placeholder="broker@firma.pl" /></div>
			<div><label class={labelCls}>Imię i Nazwisko</label><input bind:value={iNazwa} class={inputCls} placeholder="Jan Kowalski" /></div>
			<div>
				<label class={labelCls}>Rola w systemie *</label>
				<select bind:value={iRole} class={inputCls}>
					{#each ROLES as r}<option>{r}</option>{/each}
				</select>
			</div>
			<p class="text-xs text-slate-400">Użytkownik otrzyma email z linkiem do ustawienia hasła.</p>
		</div>
	{/if}
</Modal>

<!-- Modal: Edytuj rolę użytkownika -->
{#if editingUser}
<Modal title="Edytuj użytkownika — {editingUser.imie_nazwisko ?? editingUser.email}" open={showEditUser} onclose={() => { showEditUser=false; }}>
	{#snippet footer()}
		<button onclick={() => showEditUser=false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveUserRole} disabled={savingUser} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingUser ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if userError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{userError}</div>{/if}
	<div class="space-y-3">
		<div><label class={labelCls}>Imię i Nazwisko</label><input bind:value={uNazwa} class={inputCls} /></div>
		<div>
			<label class={labelCls}>Rola w systemie</label>
			<select bind:value={uRole} class={inputCls}>
				{#each ROLES as r}<option>{r}</option>{/each}
			</select>
		</div>
		<div><label class={labelCls}>Stanowisko</label><input bind:value={uStanowisko} class={inputCls} placeholder="np. Starszy Broker" /></div>
		<div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
			Zmiana roli wchodzi w życie przy następnym logowaniu użytkownika.
		</div>
	</div>
</Modal>
{/if}
