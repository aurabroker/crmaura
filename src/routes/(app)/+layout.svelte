<script lang="ts">
	import {
		wczytajAneksy,
		wczytajApkLogi,
		wczytajFormularzeApk,
		wczytajKlientow,
		wczytajKontakty,
		wczytajPlatnosci,
		wczytajPodzialProwizji,
		wczytajPojazdy,
		wczytajPolisy,
		wczytajSzkody,
		wczytajZadania
	} from '$lib/kolekcje';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { logAudit } from '$lib/utils/audit';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import AppShell from '$lib/components/shell/AppShell.svelte';

	let { children } = $props();
	let initialized = $state(false);
	let refreshing = $state(false);
	let loginLogged = false;

	async function refreshData() {
		refreshing = true;
		await loadData();
		refreshing = false;
	}

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

		// Interfejs (menu, nagłówek) potrzebuje tylko profilu i tenanta — pokazujemy go
		// od razu, a ciężkie kolekcje (klienci, polisy, płatności...) doczytujemy w tle.
		// Dzięki temu aplikacja "wstaje" szybciej, m.in. przy otwieraniu w nowej karcie.
		initialized = true;

		// Kolekcje, które mogą mieć ponad 1000 wierszy (limit jednego zapytania), idą stronami ($lib/kolekcje).
		const [rC, rP, rAnn, rPay, rCl, rV, rA, rI, rPr, rPB, rCC, rAPK, rIB, rIC, rAL, rVR, rTasks, rLeasings] = await Promise.all([
			wczytajKlientow(),
			wczytajPolisy(),
			wczytajAneksy(),
			wczytajPlatnosci(),
			wczytajSzkody(),
			wczytajPojazdy(),
			wczytajApkLogi(),
			sb.from('crm_insurers').select('*').order('nazwa'),
			sb.from('crm_profiles').select('*').eq('tenant_id', profile.tenant_id),
			wczytajPodzialProwizji(),
			wczytajKontakty(),
			wczytajFormularzeApk(profile.tenant_id),
			sb.from('crm_insurer_branches').select('*').order('nazwa'),
			sb.from('crm_insurer_contacts').select('*, crm_insurer_branches(nazwa)').order('imie_nazwisko'),
			sb.from('crm_alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }),
			sb.from('crm_vehicle_requests').select('*').eq('status', 'oczekuje').order('created_at', { ascending: false }),
			wczytajZadania(),
			sb.from('crm_leasings').select('*').order('nazwa')
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
		appState.vehicleRequests = (rVR.data ?? []) as typeof appState.vehicleRequests;
		appState.tasks = (rTasks.data ?? []) as typeof appState.tasks;
		appState.leasings = (rLeasings.data ?? []) as typeof appState.leasings;
		if (!loginLogged) {
			loginLogged = true;
			logAudit('login', 'user', user.id, profile.imie_nazwisko ?? user.email);
		}
	}

	onMount(loadData);

	async function logout() {
		await sb.auth.signOut();
		goto('/login');
	}

</script>

{#if !initialized}
	<div class="min-h-screen flex items-center justify-center bg-bg">
		<div class="text-ink-3 text-sm">Ładowanie…</div>
	</div>
{:else}
<AppShell {refreshing} onrefresh={refreshData} onlogout={logout}>
	{@render children()}
</AppShell>

<ContextMenu />
<ConfirmDialog />
{/if}
