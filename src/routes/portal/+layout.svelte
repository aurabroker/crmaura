<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { ShieldCheck, LogOut } from 'lucide-svelte';
	import type { Client, Policy, PolicyPayment, Claim, Vehicle } from '$lib/types/database';

	let { children } = $props();
	let phase = $state<'loading' | 'ok' | 'denied'>('loading');

	const isLogin = $derived($page.url.pathname === '/portal/login');

	async function check() {
		if (isLogin) {
			phase = 'ok';
			return;
		}
		const {
			data: { user }
		} = await sb.auth.getUser();
		if (!user) {
			goto('/portal/login');
			return;
		}
		const { data: c } = await sb
			.from('crm_clients')
			.select('*')
			.eq('auth_user_id', user.id)
			.maybeSingle();
		if (!c) {
			// Konto bez powiązanego klienta (np. pracownik CRM) — nie odpinamy sesji, pokazujemy komunikat.
			phase = 'denied';
			return;
		}
		const client = c as unknown as Client;
		portalState.client = client;

		const [pol, pay, cl, veh] = await Promise.all([
			sb.from('crm_policies').select('*').eq('klient_id', client.id).is('deleted_at', null).order('data_do', { ascending: false }),
			sb.from('crm_policy_payments').select('*').order('data_platnosci', { ascending: true }),
			sb.from('crm_claims').select('*').order('data_szkody', { ascending: false }),
			sb.from('crm_vehicles').select('*').order('created_at', { ascending: false })
		]);
		portalState.policies = (pol.data ?? []) as Policy[];
		portalState.payments = (pay.data ?? []) as PolicyPayment[];
		portalState.claims = (cl.data ?? []) as Claim[];
		portalState.vehicles = (veh.data ?? []) as Vehicle[];
		phase = 'ok';
	}
	onMount(check);

	async function logout() {
		await sb.auth.signOut();
		portalState.client = null;
		goto('/portal/login');
	}
</script>

{#if isLogin}
	{@render children()}
{:else if phase === 'loading'}
	<div class="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
		Ładowanie panelu…
	</div>
{:else if phase === 'denied'}
	<div class="min-h-screen flex items-center justify-center bg-slate-50">
		<div class="bg-white border border-slate-200 rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
			<ShieldCheck size={28} class="text-slate-400 mx-auto mb-3" />
			<p class="text-slate-700 font-semibold mb-1">To konto nie ma dostępu do Panelu Klienta</p>
			<p class="text-sm text-slate-500 mb-5">Zaloguj się danymi przekazanymi przez Twojego doradcę.</p>
			<button onclick={logout} class="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-slate-700 transition-colors">
				Wyloguj i wróć do logowania
			</button>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-slate-50">
		<header class="bg-white border-b border-slate-200 sticky top-0 z-10">
			<div class="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<ShieldCheck size={24} class="text-blue-500" />
					<span class="text-lg font-bold text-slate-900">Panel Klienta</span>
				</div>
				<div class="flex items-center gap-4">
					<div class="text-right hidden sm:block">
						<div class="text-sm font-semibold text-slate-900">
							{portalState.client?.nazwa_skrocona ?? portalState.client?.nazwa}
						</div>
						<div class="text-[11px] text-slate-400">{portalState.client?.email ?? ''}</div>
					</div>
					<button onclick={logout} title="Wyloguj" class="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
						<LogOut size={16} /> <span class="hidden sm:inline">Wyloguj</span>
					</button>
				</div>
			</div>
		</header>
		<main class="max-w-5xl mx-auto px-4 sm:px-6 py-6">
			{@render children()}
		</main>
	</div>
{/if}
