<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import type { Client } from '$lib/types/database';
	import {
		LayoutDashboard, FileText, AlertTriangle, Car, Calculator, Settings, LogOut, ShieldCheck
	} from 'lucide-svelte';

	let { children } = $props();
	let initialized = $state(false);

	const navItems = [
		{ href: '/portal', label: 'Pulpit', icon: LayoutDashboard },
		{ href: '/portal/polisy', label: 'Polisy', icon: FileText },
		{ href: '/portal/szkody', label: 'Szkody', icon: AlertTriangle },
		{ href: '/portal/pojazdy', label: 'Pojazdy', icon: Car },
		{ href: '/portal/platnosci', label: 'Płatności', icon: Calculator },
		{ href: '/portal/ustawienia', label: 'Ustawienia', icon: Settings }
	];

	const currentPath = $derived($page.url.pathname);
	const onLoginPage = $derived(currentPath === '/portal/login');

	async function loadData() {
		const { data: { user } } = await sb.auth.getUser();

		if (!user) {
			if (!onLoginPage) goto('/portal/login');
			initialized = true;
			return;
		}

		const { data: client } = await sb.from('crm_clients').select('*').eq('auth_user_id', user.id).single();

		if (!client) {
			await sb.auth.signOut();
			if (!onLoginPage) goto('/portal/login');
			initialized = true;
			return;
		}

		if (onLoginPage) {
			goto('/portal');
			return;
		}

		portalState.client = client as Client;

		const { data: tenant } = await sb.from('crm_tenants').select('nazwa').eq('id', client.tenant_id).single();
		portalState.tenantNazwa = tenant?.nazwa ?? '';

		initialized = true;
	}

	onMount(loadData);

	async function logout() {
		await sb.auth.signOut();
		goto('/portal/login');
	}
</script>

{#if !initialized}
	<div class="min-h-screen flex items-center justify-center bg-slate-50">
		<div class="text-slate-400 text-sm">Ładowanie...</div>
	</div>
{:else if onLoginPage}
	{@render children()}
{:else}
<div class="min-h-screen flex flex-col bg-slate-50" style="font-family: 'Inter', sans-serif">

	<header class="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
		<div class="flex items-center gap-6">
			<a href="/portal" class="flex items-center gap-2 font-bold text-xl text-slate-900">
				<ShieldCheck size={22} class="text-blue-500" />
				Panel Klienta
			</a>
			<nav class="flex items-center gap-1">
				{#each navItems as item}
					<a
						href={item.href}
						class="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
							{currentPath === item.href ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}"
					>
						<item.icon size={15} />
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<div class="flex items-center gap-4">
			<div class="text-right leading-tight">
				<div class="text-sm font-semibold text-slate-900">{portalState.client?.nazwa}</div>
				<div class="text-[11px] text-slate-400">{portalState.tenantNazwa}</div>
			</div>
			<button onclick={logout} class="text-slate-400 hover:text-slate-700 transition-colors" title="Wyloguj">
				<LogOut size={18} />
			</button>
		</div>
	</header>

	<main class="flex-1">
		<div class="max-w-[1400px] mx-auto px-8 py-6">
			{@render children()}
		</div>
	</main>
</div>
{/if}
