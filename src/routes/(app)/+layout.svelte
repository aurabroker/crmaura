<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { appState, isAdmin, isFinance, isBroker } from '$lib/stores/app.svelte';
	import {
		LayoutDashboard, Users, FileText, Calculator, Scale, ClipboardList,
		Settings, Plus, LogOut, ShieldCheck, ChevronDown,
		AlertTriangle, RefreshCw, Target, Coins, RotateCcw, Trash2, Shield, CalendarCheck
	} from 'lucide-svelte';

	let { children } = $props();
	let addMenuOpen = $state(false);
	let adminMenuOpen = $state(false);
	let initialized = $state(false);
	let refreshing = $state(false);

	async function refreshData() {
		refreshing = true;
		await loadData();
		refreshing = false;
	}

	const navItems = $derived([
		{ href: '/dashboard', label: 'Pulpit', icon: LayoutDashboard, always: true },
		{ href: '/clients', label: 'Klienci', icon: Users, always: true },
		{ href: '/policies', label: 'Polisy', icon: FileText, always: true },
		{ href: '/claims', label: 'Szkody', icon: AlertTriangle, show: isBroker() },
		{ href: '/bonds', label: 'Gwarancje', icon: Shield, show: !!appState.tenantFeatures['gwarancje'] },
		{ href: '/calendar', label: 'Kalendarz', icon: CalendarCheck, show: !!appState.tenantFeatures['kalendarz'] },
		{ href: '/apk', label: 'APK', icon: ClipboardList, always: true },
		{ href: '/renewals', label: 'Odnowienia', icon: RefreshCw, always: true },
		{ href: '/prospects', label: 'Prospects', icon: Target, always: true },
		{ href: '/payments', label: 'Płatności', icon: Calculator, always: true },
		{ href: '/commission', label: 'Prowizja', icon: Coins, always: true },
		{ href: '/finance', label: 'Rozliczenia', icon: Calculator, show: isFinance(appState.profile), adminOnly: true },
		{ href: '/knf-report', label: 'Raporty', icon: Scale, show: isAdmin(appState.profile) && isBroker(), adminOnly: true },
		{ href: '/admin', label: 'Administracja', icon: Settings, show: isAdmin(appState.profile), adminOnly: true },
		{ href: '/kosz', label: 'Kosz', icon: Trash2, show: ['ADMIN GOD','ADMIN BROKER'].includes(appState.profile?.rola ?? ''), adminOnly: true }
	]);

	const activeClaims = $derived(
		appState.claims.filter((c) => c.status === 'W toku' || c.status === 'Zgłoszona').length
	);

	async function loadData() {
		const { data: { user } } = await sb.auth.getUser();
		if (!user) { goto('/login'); return; }

		const { data: profile } = await sb.from('crm_profiles').select('*').eq('id', user.id).single();

		if (!profile || !profile.tenant_id) {
			await sb.auth.signOut();
			goto('/login');
			return;
		}

		appState.profile = profile as typeof appState.profile;

		const { data: tenant } = await sb.from('crm_tenants').select('typ, nazwa, features').eq('id', profile.tenant_id).single();
		appState.tenantTyp = (tenant?.typ as typeof appState.tenantTyp) ?? 'broker';
		appState.tenantNazwa = tenant?.nazwa ?? '';
		appState.tenantFeatures = (tenant?.features as Record<string, boolean>) ?? {};

		// Dashboard prefs
		const { data: prefs } = await sb.from('crm_dashboard_prefs').select('widgets').eq('user_id', user.id).single();
		if (prefs?.widgets) appState.dashboardWidgets = prefs.widgets as string[];

		const [rC, rP, rAnn, rPay, rCl, rV, rA, rI, rPr, rPB, rCC, rAPK, rIB, rIC, rAL, rTasks] = await Promise.all([
			sb.from('crm_clients').select('*').order('created_at', { ascending: false }),
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu'),
			sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci'),
			sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)'),
			sb.from('crm_vehicles').select('*'),
			sb.from('crm_apk_logs').select('*, crm_policies(nr_polisy, crm_clients(nazwa))'),
			sb.from('crm_insurers').select('*').order('nazwa'),
			sb.from('crm_profiles').select('*').eq('tenant_id', profile.tenant_id),
			sb.from('crm_policy_brokers').select('*, crm_profiles(imie_nazwisko, email)'),
			sb.from('crm_client_contacts').select('*'),
			sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona), apk_tokens(status, used_at)').eq('tenant_id', profile.tenant_id).order('created_at', { ascending: false }),
			sb.from('crm_insurer_branches').select('*').order('nazwa'),
			sb.from('crm_insurer_contacts').select('*, crm_insurer_branches(nazwa)').order('imie_nazwisko'),
			sb.from('crm_alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }),
			sb.from('crm_tasks').select('*, crm_clients(nazwa), crm_policies(nr_polisy), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)').order('termin', { ascending: true, nullsFirst: false })
		]);

		appState.clients = (rC.data ?? []) as typeof appState.clients;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rAnn.data ?? []) as typeof appState.annexes;
		appState.payments = (rPay.data ?? []) as typeof appState.payments;
		appState.claims = (rCl.data ?? []) as typeof appState.claims;
		appState.vehicles = (rV.data ?? []) as typeof appState.vehicles;
		appState.apk = (rA.data ?? []) as typeof appState.apk;
		appState.insurers = (rI.data ?? []) as typeof appState.insurers;
		appState.brokers = (rPr.data ?? []) as typeof appState.brokers;
		appState.policyBrokers = (rPB.data ?? []) as typeof appState.policyBrokers;
		appState.clientContacts = (rCC.data ?? []) as typeof appState.clientContacts;
		appState.apkForms = (rAPK.data ?? []) as typeof appState.apkForms;
		appState.insurerBranches = (rIB.data ?? []) as typeof appState.insurerBranches;
		appState.insurerContacts = (rIC.data ?? []) as typeof appState.insurerContacts;
		appState.alerts = (rAL.data ?? []) as typeof appState.alerts;
		appState.tasks = (rTasks.data ?? []) as typeof appState.tasks;
		initialized = true;
	}

	onMount(loadData);

	async function logout() {
		await sb.auth.signOut();
		goto('/login');
	}

	$effect(() => {
		if (addMenuOpen) {
			const close = () => (addMenuOpen = false);
			window.addEventListener('click', close, { once: true });
		}
	});

	$effect(() => {
		if (adminMenuOpen) {
			const close = () => (adminMenuOpen = false);
			window.addEventListener('click', close, { once: true });
		}
	});

	const currentPath = $derived($page.url.pathname);
</script>

{#if !initialized}
	<div class="min-h-screen flex items-center justify-center bg-slate-50">
		<div class="text-slate-400 text-sm">Ładowanie...</div>
	</div>
{:else}
<div class="min-h-screen flex flex-col bg-slate-50" style="font-family: 'Inter', sans-serif">

	<header class="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
		<div class="flex items-center gap-6">
			<a href="/dashboard" class="flex items-center gap-2 font-bold text-xl text-slate-900">
				<ShieldCheck size={22} class="text-blue-500" />
				FRANK67 CRM
			</a>
			<nav class="flex items-center gap-1">
				{#each navItems as item}
					{#if item.always || item.show}
						{#if item.href === '/admin'}
							<!-- Administracja dropdown — admin only (amber border) -->
							<div class="relative">
								<button
									onclick={(e) => { e.stopPropagation(); adminMenuOpen = !adminMenuOpen; }}
									class="relative flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors border
										{currentPath.startsWith('/admin')
											? 'bg-amber-600 text-white border-amber-600'
											: 'text-amber-700 border-amber-300 hover:bg-amber-50 hover:border-amber-400'}"
								>
									<item.icon size={15} />
									{item.label}
									<ChevronDown size={12} />
								</button>
								{#if adminMenuOpen}
									<div class="absolute left-0 top-full mt-1 bg-white border border-amber-200 rounded-xl shadow-xl w-52 overflow-hidden z-50">
										<a href="/admin?tab=system" onclick={() => adminMenuOpen = false}
											class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-amber-50 border-b border-amber-100">
											<Settings size={14} /> Ustawienia systemu
										</a>
										<a href="/admin?tab=kancelaria" onclick={() => adminMenuOpen = false}
											class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-amber-50">
											<Users size={14} /> Ustawienia Kancelarii
										</a>
									</div>
								{/if}
							</div>
						{:else}
							<a
								href={item.href}
								class="relative flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
									{item.adminOnly ? 'border ' : ''}
									{item.adminOnly && currentPath.startsWith(item.href)
										? 'bg-amber-600 text-white border-amber-600'
										: item.adminOnly
										? 'text-amber-700 border-amber-300 hover:bg-amber-50 hover:border-amber-400'
										: currentPath.startsWith(item.href)
										? 'bg-slate-900 text-white'
										: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}"
							>
								<item.icon size={15} />
								{item.label}
								{#if item.href === '/claims' && activeClaims > 0 && isBroker()}
									<span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
										{activeClaims > 9 ? '9+' : activeClaims}
									</span>
								{/if}
							</a>
						{/if}
					{/if}
				{/each}
			</nav>
		</div>

		<div class="flex items-center gap-4">
			<div class="relative">
				<button
					onclick={(e) => { e.stopPropagation(); addMenuOpen = !addMenuOpen; }}
					class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
				>
					<Plus size={15} />
					DODAJ
					<ChevronDown size={14} />
				</button>
				{#if addMenuOpen}
					<div class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl w-56 overflow-hidden z-50">
						<a href="/policies/new" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<FileText size={15} /> Nowa Polisa / UG
						</a>
						<a href="/clients?new=1" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<Users size={15} /> Nowy Klient (RODO)
						</a>
						{#if isBroker()}
						<a href="/claims?new=1" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<AlertTriangle size={15} /> Zgłoś Szkodę
						</a>
						{/if}
						<a href="/vehicles/new" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<Plus size={15} /> Dodaj Pojazd
						</a>
						{#if appState.tenantFeatures['gwarancje']}
						<a href="/policies/new?typ=generalna&podtyp=gwarancje" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50">
							<Plus size={15} /> Dodaj Gwarancję
						</a>
						{/if}
					</div>
				{/if}
			</div>

			<div class="h-8 w-px bg-slate-200"></div>

			{#if appState.profile?.rola === 'ADMIN GOD'}
				<a href="/saas-admin" class="text-slate-400 hover:text-slate-700 transition-colors" title="SAAS Admin">
					<ShieldCheck size={18} />
				</a>
			{/if}
			<button onclick={refreshData} disabled={refreshing} class="text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-40" title="Odśwież dane">
				<RotateCcw size={16} class={refreshing ? 'animate-spin' : ''} />
			</button>
			<a href="/settings" class="text-slate-400 hover:text-slate-700 transition-colors" title="Ustawienia">
				<Settings size={18} />
			</a>

			<div class="h-8 w-px bg-slate-200"></div>

			<div class="text-right leading-tight">
				<div class="text-sm font-semibold text-slate-900">{appState.profile?.imie_nazwisko ?? appState.profile?.email}</div>
				<div class="text-[11px] text-slate-400 uppercase">{appState.profile?.rola}</div>
			</div>
			<button onclick={logout} class="text-slate-400 hover:text-slate-700 transition-colors" title="Wyloguj">
				<LogOut size={18} />
			</button>
		</div>
	</header>

	<main class="flex-1">
		<div class="max-w-[1800px] mx-auto px-8 py-6">
			{@render children()}
		</div>
	</main>
</div>
{/if}
