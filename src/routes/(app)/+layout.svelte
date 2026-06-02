<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { appState, isAdmin, isFinance } from '$lib/stores/app.svelte';
	import {
		LayoutDashboard, Users, FileText, Calculator, Scale,
		Settings, Plus, LogOut, ShieldCheck, ChevronDown
	} from 'lucide-svelte';

	let { children } = $props();
	let addMenuOpen = $state(false);
	let initialized = $state(false);

	const navItems = $derived([
		{ href: '/dashboard', label: 'Pulpit', icon: LayoutDashboard, always: true },
		{ href: '/clients', label: 'Klienci', icon: Users, always: true },
		{ href: '/policies', label: 'Polisy', icon: FileText, always: true },
		{ href: '/finance', label: 'Rozliczenia', icon: Calculator, show: isFinance(appState.profile) },
		{ href: '/knf-report', label: 'Raport KNF', icon: Scale, show: isAdmin(appState.profile) },
		{ href: '/admin', label: 'Administracja', icon: Settings, show: isAdmin(appState.profile) }
	]);

	async function loadData() {
		const { data: { user } } = await sb.auth.getUser();
		if (!user) { goto('/login'); return; }

		let { data: profile } = await sb.from('crm_profiles').select('*').eq('id', user.id).single();

		if (!profile || !profile.tenant_id) {
			let { data: tenant } = await sb.from('crm_tenants').select('id').limit(1).single();
			let tId: string;
			if (!tenant) {
				const res = await sb.from('crm_tenants').insert({ nazwa: 'Aura Brokers' }).select().single();
				tId = res.data!.id;
			} else { tId = tenant.id; }
			const profPayload = { id: user.id, email: user.email!, rola: 'ADMIN GOD' as const, tenant_id: tId, imie_nazwisko: 'Główny Administrator' };
			await sb.from('crm_profiles').upsert(profPayload);
			profile = profPayload as typeof profile;
		}

		appState.profile = profile as typeof appState.profile;

		const [rC, rP, rAnn, rCl, rV, rA, rI, rPr] = await Promise.all([
			sb.from('crm_clients').select('*'),
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu'),
			sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)'),
			sb.from('crm_vehicles').select('*'),
			sb.from('crm_apk_logs').select('*, crm_policies(nr_polisy, crm_clients(nazwa))'),
			sb.from('crm_insurers').select('*').order('nazwa'),
			sb.from('crm_profiles').select('*')
		]);

		appState.clients = (rC.data ?? []) as typeof appState.clients;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rAnn.data ?? []) as typeof appState.annexes;
		appState.claims = (rCl.data ?? []) as typeof appState.claims;
		appState.vehicles = (rV.data ?? []) as typeof appState.vehicles;
		appState.apk = (rA.data ?? []) as typeof appState.apk;
		appState.insurers = (rI.data ?? []) as typeof appState.insurers;
		appState.brokers = (rPr.data ?? []) as typeof appState.brokers;
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

	const currentPath = $derived($page.url.pathname);
</script>

{#if !initialized}
	<div class="min-h-screen flex items-center justify-center bg-slate-50">
		<div class="text-slate-400 text-sm">Ładowanie...</div>
	</div>
{:else}
<div class="min-h-screen flex flex-col bg-slate-50" style="font-family: 'Inter', sans-serif">

	<!-- Topbar -->
	<header class="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
		<div class="flex items-center gap-6">
			<a href="/dashboard" class="flex items-center gap-2 font-bold text-xl text-slate-900">
				<ShieldCheck size={22} class="text-blue-500" />
				Aura<span class="text-blue-500">CRM</span>
			</a>
			<nav class="flex items-center gap-1">
				{#each navItems as item}
					{#if item.always || item.show}
						<a
							href={item.href}
							class="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
								{currentPath.startsWith(item.href)
									? 'bg-slate-900 text-white'
									: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}"
						>
							<item.icon size={15} />
							{item.label}
						</a>
					{/if}
				{/each}
			</nav>
		</div>

		<div class="flex items-center gap-4">
			<!-- Global ADD button -->
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
					<div class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl w-52 overflow-hidden z-50">
						<a href="/policies?new=1" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<FileText size={15} /> Nowa Polisa
						</a>
						<a href="/clients?new=1" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
							<Users size={15} /> Nowy Klient (RODO)
						</a>
						<a href="/policies?newclaim=1" class="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50">
							<Scale size={15} /> Zgłoś Szkodę
						</a>
					</div>
				{/if}
			</div>

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
		<div class="max-w-screen-xl mx-auto px-8 py-6">
			{@render children()}
		</div>
	</main>
</div>
{/if}
