<script lang="ts">
	// Rama aplikacji „B · Precyzja”: boczne menu w sekcjach, górny pasek z wyszukiwarką Ctrl+K,
	// przyciskiem Dodaj i kontem. Poniżej 1024 px menu chowa się pod przyciskiem.
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { appState, isAdmin, isFinance, isBroker } from '$lib/stores/app.svelte';
	import { dateDiffDays, todayStr } from '$lib/utils';
	import { poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import { odnowionePolisy } from '$lib/statusPolisy';
	import GlobalSearch from './GlobalSearch.svelte';
	import {
		LayoutDashboard, Users, FileText, Calculator, Scale, ClipboardList, Settings, Plus, LogOut,
		ShieldCheck, ChevronDown, AlertTriangle, RefreshCw, Target, Coins, RotateCcw, Trash2, Shield,
		CalendarCheck, Upload, Car, Menu, X, FileStack, ChartColumn, GitCompare, FileChartColumn
	} from 'lucide-svelte';

	let {
		children,
		refreshing = false,
		onrefresh,
		onlogout
	}: { children: Snippet; refreshing?: boolean; onrefresh: () => void; onlogout: () => void } = $props();

	let menuMobilne = $state(false);
	let dodajOtwarte = $state(false);

	afterNavigate(() => { menuMobilne = false; dodajOtwarte = false; });

	$effect(() => {
		if (dodajOtwarte) {
			const zamknij = () => (dodajOtwarte = false);
			window.addEventListener('click', zamknij, { once: true });
		}
	});

	const today = todayStr();
	const ug = $derived(ugBezRozliczania(appState.policies));
	const ratyPoTerminie = $derived(appState.payments.filter((p) => poTerminie(p, today, ug)).length);
	// Jak segment „Do odnowienia” w Odnowieniach: koniec w ciągu 30 dni i brak polisy odnawiającej.
	const odnowione = $derived(odnowionePolisy(appState.policies));
	const odnowienia30 = $derived(
		appState.policies.filter((p) => {
			if (!p.data_do || odnowione.has(p.id)) return false;
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 30;
		}).length
	);
	const aktywneSzkody = $derived(
		appState.claims.filter((c) => c.status === 'W toku' || c.status === 'Zgłoszona').length
	);
	// Wnioski o dodanie pojazdu czekające na decyzję — tylko admin je rozpatruje
	const wnioskiPojazdy = $derived(isAdmin(appState.profile) ? appState.vehicleRequests.length : 0);

	type Ton = 'danger' | 'warn' | 'neutral';
	type Pozycja = {
		href: string;
		label: string;
		icon: typeof FileText;
		show?: boolean;
		licznik?: number;
		ton?: Ton;
		tytulLicznika?: string;
		aktywna?: (sciezka: string, typ: string | null) => boolean;
	};
	type Sekcja = { nazwa: string; pozycje: Pozycja[] };

	const sekcje = $derived<Sekcja[]>([
		{
			nazwa: 'Praca',
			pozycje: [
				{ href: '/dashboard', label: 'Pulpit', icon: LayoutDashboard },
				{ href: '/calendar', label: 'Kalendarz', icon: CalendarCheck, show: !!appState.tenantFeatures['kalendarz'] }
			]
		},
		{
			nazwa: 'Portfel',
			pozycje: [
				{ href: '/clients', label: 'Klienci', icon: Users },
				{
					href: '/policies', label: 'Polisy', icon: FileText,
					aktywna: (s, typ) => s.startsWith('/policies') && typ !== 'generalna'
				},
				{
					href: '/policies?typ=generalna', label: 'Umowy generalne', icon: FileStack,
					aktywna: (s, typ) => s === '/policies' && typ === 'generalna'
				},
				{
					href: '/renewals', label: 'Odnowienia', icon: RefreshCw,
					licznik: odnowienia30, ton: 'warn', tytulLicznika: 'polis do odnowienia w ciągu 30 dni'
				},
				{ href: '/vehicles', label: 'Pojazdy', icon: Car },
				{ href: '/apk', label: 'APK', icon: ClipboardList },
				{
					href: '/claims', label: 'Szkody', icon: AlertTriangle, show: isBroker(),
					licznik: aktywneSzkody, ton: 'neutral', tytulLicznika: 'szkód zgłoszonych lub w toku'
				},
				{ href: '/bonds', label: 'Gwarancje', icon: Shield, show: !!appState.tenantFeatures['gwarancje'] }
			]
		},
		{
			nazwa: 'Finanse',
			pozycje: [
				{
					href: '/payments', label: 'Płatności', icon: Calculator,
					licznik: ratyPoTerminie, ton: 'danger', tytulLicznika: 'rat po terminie'
				},
				{ href: '/commission', label: 'Prowizja', icon: Coins },
				{ href: '/finance', label: 'Rozliczenia', icon: Calculator, show: isFinance(appState.profile) }
			]
		},
		{
			nazwa: 'Sprzedaż',
			pozycje: [{ href: '/prospects', label: 'Leady', icon: Target }]
		},
		{
			nazwa: 'Analityka',
			pozycje: [
				{ href: '/statystyki', label: 'Statystyki', icon: ChartColumn },
				{ href: '/porownania', label: 'Porównania', icon: GitCompare },
				{ href: '/raporty', label: 'Raporty', icon: FileChartColumn },
				{ href: '/knf-report', label: 'Raport KNF', icon: Scale, show: isAdmin(appState.profile) && isBroker() }
			]
		},
		{
			nazwa: 'Administracja',
			pozycje: [
				{ href: '/kosz', label: 'Kosz', icon: Trash2, show: ['ADMIN GOD', 'ADMIN BROKER'].includes(appState.profile?.rola ?? '') },
				{
					href: wnioskiPojazdy > 0 ? '/settings?tab=pojazdy' : '/settings', label: 'Ustawienia', icon: Settings,
					licznik: wnioskiPojazdy, ton: 'warn', tytulLicznika: 'wniosków o pojazd do rozpatrzenia',
					aktywna: (s) => s.startsWith('/settings')
				},
				{ href: '/saas-admin', label: 'SAAS Admin', icon: ShieldCheck, show: appState.profile?.rola === 'ADMIN GOD' }
			]
		}
	]);

	const sciezka = $derived($page.url.pathname);
	const typ = $derived($page.url.searchParams.get('typ'));

	const widoczne = $derived(
		sekcje
			.map((s) => ({ ...s, pozycje: s.pozycje.filter((p) => p.show !== false) }))
			.filter((s) => s.pozycje.length > 0)
	);

	function czyAktywna(p: Pozycja) {
		return p.aktywna ? p.aktywna(sciezka, typ) : sciezka.startsWith(p.href);
	}

	const tonLicznika: Record<Ton, string> = {
		danger: 'bg-danger-soft text-danger',
		warn: 'bg-warn-soft text-warn',
		neutral: 'bg-surface-2 text-ink-2'
	};

	const inicjaly = $derived(
		(appState.profile?.imie_nazwisko ?? appState.profile?.email ?? '?')
			.split(/\s+/)
			.map((s) => s[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

{#snippet menu()}
	<a href="/dashboard" class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
		<span class="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center shrink-0">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle></svg>
		</span>
		<span class="flex flex-col min-w-0">
			<span class="font-semibold leading-[18px] text-ink">AuraCRM</span>
			<span class="text-xs leading-4 text-ink-3 truncate">{appState.tenantNazwa || 'Twoja firma'}</span>
		</span>
	</a>

	<nav aria-label="Menu główne" class="flex flex-col gap-4">
		{#each widoczne as s}
			<div class="flex flex-col gap-0.5">
				<span class="px-2.5 pb-1 text-xs font-semibold text-ink-3">{s.nazwa}</span>
				{#each s.pozycje as p}
					{@const on = czyAktywna(p)}
					<a
						href={p.href}
						aria-current={on ? 'page' : undefined}
						class="flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm transition-colors
							{on ? 'bg-accent-soft text-accent-text font-semibold' : 'text-ink-2 font-medium hover:bg-surface-2 hover:text-ink'}"
					>
						<p.icon size={18} strokeWidth={1.75} class="shrink-0" />
						<span class="truncate">{p.label}</span>
						{#if p.licznik && p.licznik > 0}
							<span
								class="ml-auto px-1.5 rounded-full text-xs font-semibold leading-5 tabular-nums {tonLicznika[p.ton ?? 'neutral']}"
								title="{p.licznik} {p.tytulLicznika ?? ''}"
							>{p.licznik > 999 ? '999+' : p.licznik}</span>
						{/if}
					</a>
				{/each}
			</div>
		{/each}
	</nav>
{/snippet}

<div class="min-h-screen flex bg-bg text-ink">
	<!-- Menu boczne: stałe od 1024 px -->
	<aside class="hidden lg:flex w-[232px] shrink-0 flex-col gap-5 px-3 pt-4 pb-6 bg-side border-r border-line sticky top-0 h-screen overflow-y-auto">
		{@render menu()}
	</aside>

	<!-- Menu boczne na telefonie i tablecie -->
	{#if menuMobilne}
		<div class="lg:hidden fixed inset-0 z-50 flex">
			<button class="absolute inset-0 bg-ink/40" aria-label="Zamknij menu" onclick={() => (menuMobilne = false)}></button>
			<aside class="relative w-[264px] max-w-[85vw] h-full flex flex-col gap-5 px-3 pt-4 pb-6 bg-side border-r border-line overflow-y-auto">
				<button class="absolute right-2 top-3 w-9 h-9 flex items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2" aria-label="Zamknij menu" onclick={() => (menuMobilne = false)}>
					<X size={18} />
				</button>
				{@render menu()}
			</aside>
		</div>
	{/if}

	<div class="flex-1 min-w-0 flex flex-col">
		<header class="sticky top-0 z-40 h-14 bg-white border-b border-line flex items-center gap-3 px-4 lg:px-6">
			<button class="lg:hidden w-9 h-9 -ml-1 flex items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2" aria-label="Otwórz menu" onclick={() => (menuMobilne = true)}>
				<Menu size={20} />
			</button>

			<GlobalSearch />

			<div class="ml-auto flex items-center gap-1.5 sm:gap-3">
				<div class="relative">
					<button
						onclick={(e) => { e.stopPropagation(); dodajOtwarte = !dodajOtwarte; }}
						aria-expanded={dodajOtwarte}
						aria-haspopup="menu"
						class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors"
					>
						<Plus size={16} />
						<span class="hidden sm:inline">Dodaj</span>
						<ChevronDown size={14} class="hidden sm:block" />
					</button>
					{#if dodajOtwarte}
						<div role="menu" class="absolute right-0 top-full mt-1 w-60 bg-white border border-line rounded-xl shadow-xl overflow-hidden z-50 py-1">
							<a role="menuitem" href="/policies/new" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><FileText size={16} class="text-ink-3" /> Nowa polisa / UG</a>
							<a role="menuitem" href="/policies/import" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><Upload size={16} class="text-ink-3" /> Import polisy z PDF</a>
							<a role="menuitem" href="/clients?new=1" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><Users size={16} class="text-ink-3" /> Nowy klient (RODO)</a>
							{#if isBroker()}
								<a role="menuitem" href="/claims?new=1" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><AlertTriangle size={16} class="text-ink-3" /> Zgłoś szkodę</a>
							{/if}
							<a role="menuitem" href="/vehicles/new" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><Car size={16} class="text-ink-3" /> Dodaj pojazd</a>
							{#if appState.tenantFeatures['gwarancje']}
								<a role="menuitem" href="/bonds" class="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"><Shield size={16} class="text-ink-3" /> Dodaj gwarancję</a>
							{/if}
						</div>
					{/if}
				</div>

				<button
					onclick={onrefresh}
					disabled={refreshing}
					class="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-40"
					title="Odśwież dane"
					aria-label="Odśwież dane"
				>
					<RotateCcw size={16} class={refreshing ? 'animate-spin' : ''} />
				</button>

				<span class="hidden sm:block w-px h-6 bg-line"></span>

				<div class="hidden sm:flex items-center gap-2.5">
					<span class="w-8 h-8 rounded-full bg-surface-2 border border-line text-xs font-semibold text-ink-2 flex items-center justify-center shrink-0" aria-hidden="true">{inicjaly}</span>
					<span class="hidden md:flex flex-col leading-tight">
						<span class="text-sm font-semibold text-ink">{appState.profile?.imie_nazwisko ?? appState.profile?.email}</span>
						<span class="text-xs text-ink-3">{appState.profile?.rola}</span>
					</span>
				</div>
				<button
					onclick={onlogout}
					class="w-9 h-9 flex items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2"
					title="Wyloguj"
					aria-label="Wyloguj"
				>
					<LogOut size={16} />
				</button>
			</div>
		</header>

		<main class="flex-1">
			<div class="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
				{@render children()}
			</div>
		</main>
	</div>
</div>
