<script lang="ts">
	import { wczytajZadania } from '$lib/kolekcje';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr, fmtDzien, fmtTermin, odmiana } from '$lib/utils';
	import { poTerminie, ugBezRozliczania, ROZLICZONE } from '$lib/platnosci';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { Settings2, TrendingUp, TrendingDown, AlertTriangle, CreditCard, Clock, RefreshCw, Check } from 'lucide-svelte';
	import { isBroker } from '$lib/stores/app.svelte';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import type { Policy } from '$lib/types/database';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';

	let taskModalOpen = $state(false);
	let editingTask = $state<(typeof appState.tasks)[0] | null>(null);

	function openTask(t: (typeof appState.tasks)[0]) {
		editingTask = t;
		taskModalOpen = true;
	}

	const today = todayStr();
	const thisYear = new Date().getFullYear();
	const thisMonth = today.slice(0, 7); // "YYYY-MM"
	const lastMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
	const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

	// --- Obliczenia KPI ---
	const renewals = $derived(
		appState.policies.filter((p) => {
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 30;
		})
	);

	// Sortowanie tabeli wznowień (całej listy, przed obcięciem do 8 wierszy)
	const sortWznowienia = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		tu: (p) => p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa,
		do: (p) => p.data_do
	}, { klucz: 'do' }, 'pulpit-wznowienia');
	const renewalsRows = $derived(sortWznowienia.sortuj(renewals));

	const activeClaims = $derived(
		appState.claims.filter((c) => c.status === 'W toku' || c.status === 'Zgłoszona')
	);

	const expiredThisYear = $derived(
		appState.policies.filter((p) => {
			const yr = p.data_do?.slice(0, 4);
			return yr === String(thisYear) && dateDiffDays(today, p.data_do) < 0;
		})
	);

	const renewalKeySet = $derived(
		new Set(appState.policies.map((p) => `${p.klient_id}|${p.tu_id}|${p.rodzaj}`))
	);
	const renewedThisYear = $derived(
		expiredThisYear.filter((expired) =>
			renewalKeySet.has(`${expired.klient_id}|${expired.tu_id}|${expired.rodzaj}`)
		)
	);

	const renewalRate = $derived(
		expiredThisYear.length > 0
			? Math.round((renewedThisYear.length / expiredThisYear.length) * 100)
			: null
	);

	// Płatności zaległe — wspólna definicja ($lib/platnosci), UG bez rozliczaj_platnosci pominięte
	const ugIds = $derived(ugBezRozliczania(appState.policies));
	const overduePayments = $derived(appState.payments.filter((p) => poTerminie(p, today, ugIds)));
	const overdueSum = $derived(overduePayments.reduce((s, p) => s + Number(p.kwota), 0));

	// top_clients
	const topClients = $derived(() => {
		const map = new Map<string, { nazwa: string; count: number; skladka: number }>();
		for (const p of appState.policies) {
			const id = p.klient_id;
			const nazwa = p.crm_clients?.nazwa ?? id;
			const existing = map.get(id);
			if (existing) {
				existing.count++;
				existing.skladka += p.skladka_przypisana ?? 0;
			} else {
				map.set(id, { nazwa, count: 1, skladka: p.skladka_przypisana ?? 0 });
			}
		}
		return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
	});

	// policies_by_insurer
	const policiesByInsurer = $derived(() => {
		const map = new Map<string, { nazwa: string; count: number }>();
		for (const p of appState.policies) {
			const id = p.tu_id;
			const nazwa = p.crm_insurers?.nazwa ?? id;
			const existing = map.get(id);
			if (existing) { existing.count++; }
			else { map.set(id, { nazwa, count: 1 }); }
		}
		const sorted = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
		const max = sorted[0]?.count ?? 1;
		return sorted.map((i) => ({ ...i, pct: Math.round((i.count / max) * 100) }));
	});

	// monthly_premium
	const premiumThisMonth = $derived(
		appState.policies
			.filter((p) => p.data_od?.startsWith(thisMonth))
			.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0)
	);
	const premiumLastMonth = $derived(
		appState.policies
			.filter((p) => p.data_od?.startsWith(lastMonth))
			.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0)
	);
	const premiumTrend = $derived(premiumThisMonth >= premiumLastMonth ? 'up' : 'down');

	// --- Przypis składki — 12 miesięcy ---
	const premiumChart = $derived(() => {
		const now = new Date();
		const months: { label: string; ym: string; value: number }[] = [];
		for (let i = 11; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const label = `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
			const value = appState.policies
				.filter((p) => p.data_od?.startsWith(ym))
				.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0);
			months.push({ label, ym, value });
		}
		const max = Math.max(...months.map((m) => m.value), 1);
		return months.map((m) => ({ ...m, pct: Math.round((m.value / max) * 100) }));
	});

	// --- Dynamika ---
	const dynamika = $derived(() => {
		const now = new Date();
		// Bieżący rok vs poprzedni
		const curYearStr = String(now.getFullYear());
		const prevYearStr = String(now.getFullYear() - 1);
		const policiesThisYear = appState.policies.filter((p) => p.data_od?.startsWith(curYearStr));
		const policiesPrevYear = appState.policies.filter((p) => p.data_od?.startsWith(prevYearStr));
		const skladkaThisYear = policiesThisYear.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0);
		const skladkaPrevYear = policiesPrevYear.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0);
		const growth = skladkaPrevYear > 0
			? Math.round(((skladkaThisYear - skladkaPrevYear) / skladkaPrevYear) * 100)
			: null;

		// Liczba nowych klientów w bieżącym miesiącu
		const newClientsThisMonth = appState.clients.filter((c) =>
			c.created_at?.startsWith(thisMonth)
		).length;

		// Liczba nowych polis w bieżącym miesiącu
		const newPoliciesThisMonth = appState.policies.filter((p) =>
			p.data_od?.startsWith(thisMonth)
		).length;

		return { growth, newClientsThisMonth, newPoliciesThisMonth, skladkaThisYear, skladkaPrevYear };
	});

	// policy_count
	const policiesByRodzaj = $derived(() => {
		const map = new Map<string, number>();
		for (const p of appState.policies) {
			if (p.typ_umowy === 'generalna') continue;
			const r = p.rodzaj ?? 'inne';
			map.set(r, (map.get(r) ?? 0) + 1);
		}
		const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
		const total = sorted.reduce((s, [, c]) => s + c, 0);
		const top4 = sorted.slice(0, 4);
		const rest = sorted.slice(4).reduce((s, [, c]) => s + c, 0);
		if (rest > 0) top4.push(['inne', rest]);
		return { total, items: top4.map(([r, c]) => ({ r, c, pct: total > 0 ? Math.round(c / total * 100) : 0 })) };
	});

	// Kolory segmentów wykresu rodzajów polis
	const SEARCH_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];

	// claims_stats
	const claimsStats = $derived(() => {
		const statuses = ['Zgłoszona', 'W toku', 'Wypłacona', 'Odmowa'];
		return statuses.map((s) => ({
			status: s,
			count: appState.claims.filter((c) => c.status === s).length,
			color: s === 'Zgłoszona' ? 'bg-blue-100 text-blue-700' :
				s === 'W toku' ? 'bg-amber-100 text-amber-700' :
				s === 'Wypłacona' ? 'bg-green-100 text-green-700' :
				'bg-red-100 text-red-700'
		}));
	});

	// --- Zadania (stały panel ZADANIA w pulpicie) ---
	const dashOpenTasks = $derived(
		appState.tasks.filter((t) => t.status === 'otwarte' || t.status === 'w_toku')
	);
	const dashOverdueTasks = $derived(
		dashOpenTasks.filter((t) => t.termin && t.termin < today)
	);

	// --- Alerty ---
	const unresolvedAlerts = $derived(appState.alerts.filter((a) => !a.resolved));

	async function resolveAlert(id: string) {
		await sb.from('crm_alerts').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
		appState.alerts = appState.alerts.map((a) => a.id === id ? { ...a, resolved: true } : a);
	}

	// --- Personalizacja drag & drop ---
	const ALL_WIDGETS = [
		{ id: 'renewals', label: 'Wznowienia' },
		{ id: 'claims', label: 'Aktywne Szkody' },
		{ id: 'clients', label: 'Klienci' },
		{ id: 'renewal_rate', label: 'Skuteczność odnowień' },
		{ id: 'payments', label: 'Zaległe płatności' },
		{ id: 'policy_count', label: 'Liczba polis' },
		{ id: 'top_clients', label: 'Top klienci' },
		{ id: 'expiring_payments', label: 'Nadchodzące raty' },
		{ id: 'policies_by_insurer', label: 'Polisy wg TU' },
		{ id: 'monthly_premium', label: 'Składka miesięczna' },
		{ id: 'claims_stats', label: 'Statystyki szkód' },
		{ id: 'premium_chart', label: 'Przypis składki (12 mies.)' },
		{ id: 'dynamika', label: 'Dynamika' },
		{ id: 'zadania', label: 'Zadania' },
	];

	let configMode = $state(false);

	// Analityka pod pulpitem — przeciągane widżety (kafelki KPI zastąpiły karty „Wymaga działania” i „Portfel”)
	const WIDGETY_ANALITYKI = new Set(['top_clients', 'policies_by_insurer', 'monthly_premium', 'claims_stats', 'premium_chart', 'dynamika', 'policy_count']);
	const widgetyDoWyboru = ALL_WIDGETS.filter((w) => WIDGETY_ANALITYKI.has(w.id));

	let bottomDraggableItems = $state<{ id: string; label: string }[]>([]);

	$effect(() => {
		bottomDraggableItems = ALL_WIDGETS
			.filter((w) => WIDGETY_ANALITYKI.has(w.id) && appState.dashboardWidgets.includes(w.id))
			.sort((a, b) => appState.dashboardWidgets.indexOf(a.id) - appState.dashboardWidgets.indexOf(b.id))
			.map((w) => ({ ...w }));
	});

	function handleBottomDnd(e: CustomEvent) {
		bottomDraggableItems = e.detail.items;
	}

	async function saveWidgetOrder() {
		// Pozostałe zapisane pozycje (np. dawne kafelki) zostają w preferencjach bez zmian.
		const reszta = appState.dashboardWidgets.filter((id) => !WIDGETY_ANALITYKI.has(id));
		const order = [...bottomDraggableItems.map((i) => i.id), ...reszta];
		appState.dashboardWidgets = order;
		await sb.from('crm_dashboard_prefs').upsert({
			user_id: appState.profile!.id,
			widgets: order,
			updated_at: new Date().toISOString()
		} as never);
	}

	async function finalizeBottomDnd(e: CustomEvent) {
		bottomDraggableItems = e.detail.items;
		await saveWidgetOrder();
	}

	async function toggleWidget(id: string) {
		const current = appState.dashboardWidgets;
		const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
		appState.dashboardWidgets = next;
		await sb.from('crm_dashboard_prefs').upsert({
			user_id: appState.profile!.id,
			widgets: next,
			updated_at: new Date().toISOString()
		} as never);
	}

	// --- „Dziś”: karty wymagające działania, kolejka, tydzień, portfel ---
	const dzisOpis = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

	/** Samo słowo w odmianie po liczbie: slowo(3, 'rata', 'raty', 'rat') → „raty”. */
	const slowo = (n: number, jeden: string, kilka: string, wiele: string) => odmiana(n, jeden, kilka, wiele).replace(/^\S+\s/, '');

	const renewals60 = $derived(
		appState.policies.filter((p) => {
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 60;
		}).length
	);

	const polisaWg = $derived(new Map(appState.policies.map((p) => [p.id, p])));

	type TypKolejki = 'Rata' | 'Zadanie' | 'Odnowienie';
	type PozycjaKolejki = {
		klucz: string;
		typ: TypKolejki;
		tytul: string;
		klient: string | null;
		klientHref: string | null;
		dni: number;
		termin: string;
		opiekun: string | null;
		rata?: (typeof appState.payments)[0];
		zadanie?: (typeof appState.tasks)[0];
		polisaId?: string;
	};
	const KOLEJNOSC: Record<TypKolejki, number> = { Rata: 0, Zadanie: 1, Odnowienie: 2 };

	// Raty po terminie i na najbliższe 7 dni, zadania z terminem do 7 dni, odnowienia do 14 dni
	const kolejka = $derived.by((): PozycjaKolejki[] => {
		const raty = appState.payments
			.filter((p) => {
				if (poTerminie(p, today, ugIds)) return true;
				const d = dateDiffDays(today, p.data_platnosci);
				return p.status === 'Oczekująca' && !ugIds.has(p.polisa_id) && d >= 0 && d <= 7;
			})
			.map((p): PozycjaKolejki => {
				const pol = polisaWg.get(p.polisa_id);
				const ile = parseInt(pol?.ilosc_rat ?? '1') || 1;
				return {
					klucz: 'r' + p.id,
					typ: 'Rata',
					tytul: `Rata ${p.nr_raty}${ile > 1 ? `/${ile}` : ''} · ${p.crm_policies?.nr_polisy ?? '—'} · ${fmtPln(p.kwota)} zł`,
					klient: p.crm_policies?.crm_clients?.nazwa ?? null,
					klientHref: pol?.klient_id ? `/clients/${pol.klient_id}` : null,
					dni: dateDiffDays(today, p.data_platnosci),
					termin: p.data_platnosci,
					opiekun: null,
					rata: p
				};
			});
		const zadania = dashOpenTasks
			.filter((t) => t.termin && dateDiffDays(today, t.termin) <= 7)
			.map((t): PozycjaKolejki => ({
				klucz: 't' + t.id,
				typ: 'Zadanie',
				tytul: t.tytul,
				klient: t.crm_clients?.nazwa ?? t.crm_prospects?.nazwa ?? null,
				klientHref: t.klient_id ? `/clients/${t.klient_id}` : null,
				dni: dateDiffDays(today, t.termin!),
				termin: t.termin!,
				opiekun: t.assigned_profile?.imie_nazwisko ?? t.assigned_profile?.email ?? null,
				zadanie: t
			}));
		const odnowienia = appState.policies
			.filter((p) => p.typ_umowy !== 'generalna' && dateDiffDays(today, p.data_do) >= 0 && dateDiffDays(today, p.data_do) <= 14)
			.map((p): PozycjaKolejki => ({
				klucz: 'o' + p.id,
				typ: 'Odnowienie',
				tytul: `${p.rodzaj} · ${p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? 'TU'} · ${p.nr_polisy}`,
				klient: p.crm_clients?.nazwa ?? null,
				klientHref: `/clients/${p.klient_id}`,
				dni: dateDiffDays(today, p.data_do),
				termin: p.data_do,
				opiekun: null,
				polisaId: p.id
			}));
		return [...raty, ...zadania, ...odnowienia].sort((a, b) => a.dni - b.dni || KOLEJNOSC[a.typ] - KOLEJNOSC[b.typ]);
	});

	let filtrKolejki = $state<'wszystko' | TypKolejki>('wszystko');
	let kolejkaCala = $state(false);
	const kolejkaWidoczna = $derived(kolejka.filter((q) => filtrKolejki === 'wszystko' || q.typ === filtrKolejki));
	const licznikKolejki = (t: TypKolejki) => kolejka.filter((q) => q.typ === t).length;

	function terminKolejki(q: PozycjaKolejki): string {
		if (q.typ === 'Odnowienie') return q.dni === 0 ? 'kończy się dziś' : `kończy się ${fmtTermin(q.termin, today)}`;
		return q.dni === 0 ? 'termin dziś' : fmtTermin(q.termin, today);
	}
	const tonTerminu = (dni: number) => (dni < 0 ? 'text-danger font-semibold' : dni <= 3 ? 'text-warn font-semibold' : 'text-ink-2');
	const tonTypu: Record<TypKolejki, string> = {
		Rata: 'bg-danger-soft text-danger',
		Zadanie: 'bg-surface-2 text-ink-2',
		Odnowienie: 'bg-warn-soft text-warn'
	};
	const inicjaly = (n: string | null) =>
		(n ?? '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

	// Ten tydzień — zadania z terminem w najbliższych 7 dniach, po dniach
	const tydzien = $derived.by(() => {
		const dni = new Map<string, (typeof appState.tasks)[0][]>();
		for (const t of dashOpenTasks) {
			if (!t.termin) continue;
			const d = dateDiffDays(today, t.termin);
			if (d < 0 || d > 6) continue;
			dni.set(t.termin, [...(dni.get(t.termin) ?? []), t]);
		}
		return [...dni.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([d, zad]) => ({
				data: d,
				etykieta: d === today
					? 'Dziś'
					: new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric' }),
				dzis: d === today,
				zadania: [...zad].sort((a, b) => (a.godzina ?? '99').localeCompare(b.godzina ?? '99'))
			}));
	});

	// Portfel w bieżącym roku (bez umów generalnych)
	const portfel = $derived.by(() => {
		const rok = String(thisYear);
		const umowy = appState.policies.filter((p) => p.typ_umowy !== 'generalna');
		const aktywne = umowy.filter((p) => p.data_od <= today && p.data_do >= today).length;
		const wRoku = umowy.filter((p) => p.data_od?.startsWith(rok));
		const przypis = wRoku.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0);
		const prowizja = wRoku.reduce((s, p) => s + Number(p.prowizja_przypisana ?? 0), 0);
		const raty = appState.payments.filter((p) => !ugIds.has(p.polisa_id));
		const oplacone = raty.filter((p) => ROZLICZONE.includes(p.status));
		const wartosc = raty.reduce((s, p) => s + Number(p.kwota), 0);
		const wartoscOpl = oplacone.reduce((s, p) => s + Number(p.kwota), 0);
		return {
			aktywne,
			przypis,
			prowizja,
			stawka: przypis > 0 ? (prowizja / przypis) * 100 : null,
			ratyLacznie: raty.length,
			ratyOplacone: oplacone.length,
			procentWartosci: wartosc > 0 ? (wartoscOpl / wartosc) * 100 : 0
		};
	});
	const fmtProc = (n: number) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
	const fmtZl = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`;

	// Oznaczenie wpłaty z kolejki — z możliwością cofnięcia
	let toast = $state<{ tekst: string; blad?: boolean; cofnij?: () => void } | null>(null);

	async function oznaczOplacona(pay: (typeof appState.payments)[0]) {
		const poprzednio = { status: pay.status, data_oplacenia: pay.data_oplacenia };
		const { error } = await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today } as never).eq('id', pay.id);
		if (error) { toast = { tekst: `Nie udało się zapisać: ${error.message}`, blad: true }; return; }
		appState.payments = appState.payments.map((p) => (p.id === pay.id ? { ...p, status: 'Opłacona', data_oplacenia: today } : p));
		toast = {
			tekst: `Rata ${pay.nr_raty} polisy ${pay.crm_policies?.nr_polisy ?? ''} oznaczona jako opłacona`,
			cofnij: async () => {
				toast = null;
				const { error: e2 } = await sb.from('crm_policy_payments').update(poprzednio as never).eq('id', pay.id);
				if (e2) { toast = { tekst: `Nie udało się cofnąć: ${e2.message}`, blad: true }; return; }
				appState.payments = appState.payments.map((p) => (p.id === pay.id ? { ...p, ...poprzednio } : p));
			}
		};
	}

	// Helpers for chart
	function fmtK(v: number): string {
		if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
		return String(Math.round(v));
	}

	// Numer wersji CRM przy nagłówku pulpitu (vite.config.ts; podnoszony przy każdym wdrożeniu).
	const WERSJA = __APP_VERSION__;
	const BUILD_DATA = new Date(__APP_BUILD__.data).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });
</script>

<svelte:head><title>Pulpit — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
	<div>
		<h1 class="text-2xl font-semibold text-ink flex items-center gap-2">
			Dziś
			<span class="text-xs font-medium text-ink-3 bg-surface-2 border border-line rounded-full px-2 py-0.5"
				title="Wersja CRM {WERSJA} · build {BUILD_DATA}{__APP_BUILD__.commit ? ` · ${__APP_BUILD__.commit}` : ''}">v{WERSJA}</span>
		</h1>
		<p class="text-sm text-ink-3 mt-0.5">{dzisOpis}{appState.tenantNazwa ? ` · ${appState.tenantNazwa}` : ''}</p>
	</div>
	<button
		onclick={() => configMode = !configMode}
		aria-expanded={configMode}
		class="h-9 flex items-center gap-2 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 transition-colors"
	>
		<Settings2 size={15} />
		{configMode ? 'Gotowe' : 'Dostosuj analitykę'}
	</button>
</div>

{#if configMode}
	<div class="bg-accent-soft border border-blue-200 rounded-xl p-4 mb-5">
		<p class="text-sm font-medium text-accent-text mb-3">Wybierz wykresy i zestawienia pod pulpitem — kolejność zmienisz, przeciągając kafelki.</p>
		<div class="flex flex-wrap gap-2">
			{#each widgetyDoWyboru as w}
				<button
					onclick={() => toggleWidget(w.id)}
					aria-pressed={appState.dashboardWidgets.includes(w.id)}
					class="h-8 px-3 rounded-lg text-sm font-medium border transition-colors
						{appState.dashboardWidgets.includes(w.id)
							? 'bg-accent text-white border-accent'
							: 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
				>
					{w.label}
				</button>
			{/each}
		</div>
	</div>
{/if}

<!-- Wymaga działania -->
<section aria-label="Wymaga działania" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
	<a href="/payments" class="flex flex-col gap-1.5 p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {overduePayments.length ? 'text-danger' : 'text-ok'}">
			<CreditCard size={16} />
			{overduePayments.length ? 'Po terminie' : 'W porządku'}
		</span>
		<span class="text-[28px] leading-8 font-semibold tabular-nums text-ink">{overduePayments.length}</span>
		<span class="text-sm text-ink-2">{slowo(overduePayments.length, 'rata', 'raty', 'rat')} po terminie · {fmtZl(overdueSum)}</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Otwórz płatności →</span>
	</a>
	<button
		onclick={() => { filtrKolejki = 'Zadanie'; kolejkaCala = false; document.getElementById('kolejka')?.scrollIntoView({ behavior: 'smooth' }); }}
		class="flex flex-col gap-1.5 p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors text-left"
	>
		<span class="flex items-center gap-2 text-[13px] font-semibold {dashOverdueTasks.length ? 'text-danger' : 'text-ok'}">
			<Clock size={16} />
			{dashOverdueTasks.length ? 'Po terminie' : 'W porządku'}
		</span>
		<span class="text-[28px] leading-8 font-semibold tabular-nums text-ink">{dashOverdueTasks.length}</span>
		<span class="text-sm text-ink-2">{slowo(dashOverdueTasks.length, 'zadanie', 'zadania', 'zadań')} z {dashOpenTasks.length} otwartych</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Przejrzyj zadania →</span>
	</button>
	<a href="/renewals" class="flex flex-col gap-1.5 p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {renewals.length ? 'text-warn' : 'text-ok'}">
			<RefreshCw size={16} />
			W ciągu 30 dni
		</span>
		<span class="text-[28px] leading-8 font-semibold tabular-nums text-ink">{renewals.length}</span>
		<span class="text-sm text-ink-2">{slowo(renewals.length, 'polisa', 'polisy', 'polis')} do odnowienia · {renewals60} w 60 dni</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Plan odnowień →</span>
	</a>
	<a href={unresolvedAlerts.length ? '#alerty' : '/settings?tab=dokumenty'} class="flex flex-col gap-1.5 p-4 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {unresolvedAlerts.length ? 'text-danger' : 'text-ok'}">
			{#if unresolvedAlerts.length}<AlertTriangle size={16} />{:else}<Check size={16} />{/if}
			{unresolvedAlerts.length ? 'Wymaga uwagi' : 'W porządku'}
		</span>
		<span class="text-[28px] leading-8 font-semibold tabular-nums text-ink">{unresolvedAlerts.length}</span>
		<span class="text-sm text-ink-2">{slowo(unresolvedAlerts.length, 'alert', 'alerty', 'alertów')} rozliczeniowych</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">{unresolvedAlerts.length ? 'Zobacz alerty ↓' : 'Dokumenty rozliczeniowe →'}</span>
	</a>
</section>

<!-- Alerty rozliczeniowe -->
{#if unresolvedAlerts.length > 0}
	<section id="alerty" aria-labelledby="alerty-h" class="mb-5 bg-white border border-red-200 rounded-xl overflow-hidden scroll-mt-20">
		<div class="flex items-center gap-2 px-4 py-3 bg-danger-soft border-b border-red-200">
			<AlertTriangle size={16} class="text-danger shrink-0" />
			<h2 id="alerty-h" class="text-[15px] font-semibold text-danger">Alerty rozliczeniowe — wymagane działanie ({unresolvedAlerts.length})</h2>
		</div>
		<ul class="divide-y divide-line-soft">
			{#each unresolvedAlerts as alert}
				<li class="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-2.5">
					<span class="shrink-0 mt-0.5 px-2 h-[22px] leading-[22px] rounded-full text-xs font-semibold
						{alert.typ === 'ujemna_prowizja' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}">
						{alert.typ === 'ujemna_prowizja' ? 'Ujemna prowizja' : alert.typ === 'prowizja_rozjazd' ? 'Rozbieżność prowizji' : 'Aneks wymagany'}
					</span>
					<div class="min-w-[220px] flex-1 text-sm">
						{#if alert.nr_polisy}
							{#if alert.polisa_id}
								<a href="/policies/{alert.polisa_id}" class="font-mono text-[13px] font-medium text-accent-text hover:underline">{alert.nr_polisy}</a>
							{:else}
								<span class="font-mono text-[13px] font-medium">{alert.nr_polisy}</span>
							{/if}
						{/if}
						<p class="text-ink-2">{alert.opis}</p>
					</div>
					<button
						onclick={() => resolveAlert(alert.id)}
						class="shrink-0 ml-auto h-8 flex items-center gap-1.5 px-2.5 text-[13px] font-medium border border-line rounded-lg text-ink hover:bg-surface-2"
						aria-label="Oznacz alert jako rozwiązany"
					>
						<Check size={14} /> Rozwiązany
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5 items-start">
	<!-- Kolejka na dziś -->
	<section id="kolejka" aria-labelledby="kolejka-h" class="xl:col-span-2 bg-white border border-line rounded-xl overflow-hidden scroll-mt-20">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-line-soft">
			<div class="flex flex-col">
				<h2 id="kolejka-h" class="text-[15px] font-semibold text-ink">Kolejka na dziś</h2>
				<span class="text-xs text-ink-3">po terminie i najbliższe 7 dni · odnowienia 14 dni</span>
			</div>
			<div role="group" aria-label="Filtr kolejki" class="flex flex-wrap gap-1.5 ml-auto">
				{#each [['wszystko', 'Wszystko', kolejka.length], ['Rata', 'Raty', licznikKolejki('Rata')], ['Zadanie', 'Zadania', licznikKolejki('Zadanie')], ['Odnowienie', 'Odnowienia', licznikKolejki('Odnowienie')]] as [id, label, n]}
					<button
						aria-pressed={filtrKolejki === id}
						onclick={() => { filtrKolejki = id as typeof filtrKolejki; kolejkaCala = false; }}
						class="h-7 px-2.5 rounded-full text-[13px] font-medium border transition-colors
							{filtrKolejki === id ? 'bg-ink text-white border-ink' : 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
					>{label} <span class="tabular-nums">{n}</span></button>
				{/each}
			</div>
		</div>
		{#if kolejkaWidoczna.length === 0}
			<p class="px-4 py-10 text-center text-sm text-ink-3">Nic pilnego — w tej kolejce nie ma pozycji.</p>
		{:else}
			<ul>
				{#each kolejkaCala ? kolejkaWidoczna : kolejkaWidoczna.slice(0, 10) as q (q.klucz)}
					<li class="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 border-b border-line-soft last:border-b-0">
						<span class="shrink-0 w-[92px] text-center h-[22px] leading-[22px] rounded-full text-xs font-semibold {tonTypu[q.typ]}">{q.typ}</span>
						<span class="flex-1 min-w-[180px] flex flex-col">
							<span class="text-sm font-medium text-ink truncate" title={q.tytul}>{q.tytul}</span>
							{#if q.klient}
								{#if q.klientHref}
									<a href={q.klientHref} class="text-[13px] text-ink-3 hover:text-accent-text truncate">{q.klient}</a>
								{:else}
									<span class="text-[13px] text-ink-3 truncate">{q.klient}</span>
								{/if}
							{/if}
						</span>
						<span class="shrink-0 sm:w-[160px] text-[13px] {tonTerminu(q.dni)}">{terminKolejki(q)}</span>
						{#if q.opiekun}
							<span title={q.opiekun} class="hidden sm:flex shrink-0 w-7 h-7 rounded-full bg-surface-2 text-ink-2 text-xs font-semibold items-center justify-center">{inicjaly(q.opiekun)}</span>
						{:else}
							<span class="hidden sm:block shrink-0 w-7" aria-hidden="true"></span>
						{/if}
						{#if q.rata}
							<button onclick={() => oznaczOplacona(q.rata!)} class="shrink-0 h-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Opłacona</button>
						{:else if q.zadanie}
							<button onclick={() => openTask(q.zadanie!)} class="shrink-0 h-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Otwórz</button>
						{:else}
							<a href="/policies/{q.polisaId}" class="shrink-0 h-8 leading-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Polisa</a>
						{/if}
					</li>
				{/each}
			</ul>
			{#if kolejkaWidoczna.length > 10}
				<div class="px-4 py-2.5 border-t border-line-soft">
					<button onclick={() => (kolejkaCala = !kolejkaCala)} class="text-[13px] font-semibold text-accent-text hover:underline">
						{kolejkaCala ? 'Pokaż mniej' : `Pokaż wszystkie ${kolejkaWidoczna.length} →`}
					</button>
				</div>
			{/if}
		{/if}
	</section>

	<div class="flex flex-col gap-4 min-w-0">
		<!-- Ten tydzień -->
		<section aria-labelledby="tydzien-h" class="bg-white border border-line rounded-xl overflow-hidden">
			<div class="flex items-center px-4 py-3 border-b border-line-soft">
				<h2 id="tydzien-h" class="text-[15px] font-semibold text-ink">Ten tydzień</h2>
				{#if appState.tenantFeatures['kalendarz']}
					<a href="/calendar" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Kalendarz →</a>
				{/if}
			</div>
			<div class="px-4 py-3 flex flex-col gap-3">
				{#each tydzien as d}
					<div class="flex gap-3">
						<span class="shrink-0 w-[76px] text-xs font-semibold pt-0.5 {d.dzis ? 'text-accent-text' : 'text-ink-3'}">{d.etykieta}</span>
						<span class="flex-1 min-w-0 flex flex-col gap-1.5">
							{#each d.zadania as t}
								<button onclick={() => openTask(t)} class="flex gap-2.5 text-[13px] text-left text-ink hover:text-accent-text min-w-0">
									<span class="shrink-0 w-10 font-mono text-ink-3">{t.godzina ? t.godzina.slice(0, 5) : '—'}</span>
									<span class="min-w-0 truncate"><span class="font-medium">{t.tytul}</span>{#if t.crm_clients?.nazwa}<span class="text-ink-3"> · {t.crm_clients.nazwa}</span>{/if}</span>
								</button>
							{/each}
						</span>
					</div>
				{:else}
					<p class="text-sm text-ink-3 py-2">Brak zadań z terminem w najbliższych 7 dniach.</p>
				{/each}
			</div>
		</section>

		<!-- Portfel -->
		<section aria-labelledby="portfel-h" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3.5">
			<h2 id="portfel-h" class="text-[15px] font-semibold text-ink">Portfel w {thisYear}</h2>
			<dl class="grid grid-cols-2 gap-3.5">
				<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Aktywne polisy</dt><dd class="text-xl font-semibold tabular-nums">{portfel.aktywne}</dd></div>
				<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Klienci</dt><dd class="text-xl font-semibold tabular-nums">{appState.clients.length.toLocaleString('pl-PL')}</dd></div>
				<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Przypis składki</dt><dd class="text-xl font-semibold tabular-nums">{fmtZl(portfel.przypis)}</dd></div>
				<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Prowizja przypisana</dt><dd class="text-xl font-semibold tabular-nums">{fmtZl(portfel.prowizja)}</dd></div>
				<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Stawka prowizji</dt><dd class="text-xl font-semibold tabular-nums">{portfel.stawka != null ? fmtProc(portfel.stawka) : '—'}</dd></div>
				<div class="flex flex-col gap-0.5" title="{renewedThisYear.length} z {expiredThisYear.length} polis wygasłych w {thisYear} ma kolejną polisę tego klienta w tym samym TU i rodzaju">
					<dt class="text-xs text-ink-3">Skuteczność odnowień</dt>
					<dd class="text-xl font-semibold tabular-nums">{renewalRate != null ? `${renewalRate}%` : '—'}</dd>
				</div>
			</dl>
			<div class="flex flex-col gap-1.5">
				<div class="flex justify-between gap-2 text-xs text-ink-3">
					<span>Raty oznaczone jako opłacone</span>
					<span class="tabular-nums">{portfel.ratyOplacone} z {portfel.ratyLacznie} · {fmtProc(portfel.procentWartosci)} wartości</span>
				</div>
				<div class="h-2 rounded-full bg-surface-2 overflow-hidden flex" role="img" aria-label="Opłacone {fmtProc(portfel.procentWartosci)} wartości rat">
					<span class="bg-accent" style="width: {portfel.procentWartosci}%; min-width: {portfel.ratyOplacone ? '4px' : '0'}"></span>
				</div>
				{#if portfel.ratyLacznie > 0 && portfel.procentWartosci < 10}
					<span class="flex items-start gap-1.5 text-xs text-ink-3">
						<AlertTriangle size={14} class="text-warn shrink-0 mt-px" />
						Mało rat oznaczonych jako opłacone — wpłaty najpewniej nie są odnotowywane.
					</span>
				{/if}
			</div>
		</section>
	</div>
</div>

<!-- Odnowienia — najbliższe 30 dni -->
<section aria-labelledby="odnowienia-h" class="bg-white border border-line rounded-xl overflow-hidden mb-6">
	<div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft">
		<h2 id="odnowienia-h" class="text-[15px] font-semibold text-ink">Odnowienia — najbliższe 30 dni</h2>
		<span class="text-[13px] text-ink-3">{odmiana(renewals.length, 'polisa', 'polisy', 'polis')}</span>
		<a href="/renewals" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Wszystkie odnowienia →</a>
	</div>
	<div class="overflow-x-auto">
		<table class="w-full min-w-[720px] text-[13px] text-left">
			<thead>
				<tr class="bg-surface-2 text-ink-2">
					<SortTh s={sortWznowienia} k="nr" wersaliki={false} class="px-4 py-2 font-semibold">Polisa</SortTh>
					<SortTh s={sortWznowienia} k="klient" wersaliki={false} class="px-3 py-2 font-semibold">Klient</SortTh>
					<SortTh s={sortWznowienia} k="tu" wersaliki={false} class="px-3 py-2 font-semibold">TU</SortTh>
					<SortTh s={sortWznowienia} k="do" wersaliki={false} class="px-3 py-2 font-semibold">Koniec ochrony</SortTh>
					<th class="px-4 py-2 font-semibold text-right">Składka</th>
				</tr>
			</thead>
			<tbody>
				{#each renewalsRows.slice(0, 8) as p}
					{@const dni = dateDiffDays(today, p.data_do)}
					<tr class="border-t border-line-soft hover:bg-bg">
						<td class="px-4 py-2.5 font-mono font-medium whitespace-nowrap"><a href="/policies/{p.id}" class="text-accent-text hover:underline">{p.nr_polisy}</a></td>
						<td class="px-3 py-2.5"><a href="/clients/{p.klient_id}" class="font-medium text-ink hover:text-accent-text">{p.crm_clients?.nazwa ?? '—'}</a></td>
						<td class="px-3 py-2.5 text-ink-2">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? '—'}</td>
						<td class="px-3 py-2.5 whitespace-nowrap">{fmtDzien(p.data_do)} <span class={dni <= 14 ? 'text-warn font-semibold' : 'text-ink-2'}>· {fmtTermin(p.data_do, today)}</span></td>
						<td class="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(p.skladka_przypisana)} zł</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-4 py-8 text-center text-ink-3">Żadna polisa nie kończy się w ciągu 30 dni.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if renewals.length > 8}
		<div class="px-4 py-2.5 border-t border-line-soft text-[13px]">
			<a href="/renewals" class="font-semibold text-accent-text hover:underline">+{renewals.length - 8} więcej w Odnowieniach →</a>
		</div>
	{/if}
</section>

<!-- Dolne widgety — drag & drop -->
{#if bottomDraggableItems.length > 0}
<section class="mb-6">
<SectionHeader title="Analityka i zestawienia" />
<div
	class="grid grid-cols-1 lg:grid-cols-2 gap-6"
	use:dndzone={{ items: bottomDraggableItems, flipDurationMs: 200 }}
	onconsider={handleBottomDnd}
	onfinalize={finalizeBottomDnd}
>

	{#each bottomDraggableItems as widget (widget.id)}
	<div class="{widget.id === 'premium_chart' ? 'lg:col-span-2' : ''} {configMode ? 'cursor-grab active:cursor-grabbing' : ''}">

		{#if widget.id === 'top_clients'}
		<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden h-full">
			<div class="px-5 py-4 border-b border-line">
				<h2 class="font-semibold text-slate-900 text-sm">Top 5 klientów wg liczby polis</h2>
			</div>
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Klient</th>
						<th class="px-5 py-3 text-right">Polis</th>
						<th class="px-5 py-3 text-right">Składka</th>
					</tr>
				</thead>
				<tbody>
					{#each topClients() as c, i}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">
								<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs text-slate-500 mr-2">{i + 1}</span>
								{c.nazwa}
							</td>
							<td class="px-5 py-3 text-right font-semibold text-slate-700">{c.count}</td>
							<td class="px-5 py-3 text-right text-slate-600 text-xs">{fmtPln(c.skladka)}</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="px-5 py-6 text-center text-slate-400">Brak danych</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		{:else if widget.id === 'policy_count'}
		{@const pd = policiesByRodzaj()}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-4 text-sm">Liczba polis wg rodzaju</h2>
			{#if pd.total === 0}
				<p class="text-center text-slate-400 text-sm py-4">Brak polis</p>
			{:else}
				{@const stops = (() => {
					let acc = 0;
					return pd.items.map((item, i) => {
						const from = acc;
						acc += item.pct;
						return `${SEARCH_COLORS[i % SEARCH_COLORS.length]} ${from}% ${acc}%`;
					}).join(', ');
				})()}
			<div class="flex items-center gap-8">
				<div class="relative shrink-0 w-24 h-24 rounded-full" style="background: conic-gradient({stops})">
					<div class="absolute inset-3 bg-white rounded-full flex items-center justify-center">
						<span class="text-xs font-bold text-slate-700">{pd.total}</span>
					</div>
				</div>
				<div class="flex-1 space-y-1.5">
					{#each pd.items as item, i}
						<div class="flex items-center gap-2 text-sm">
							<span class="w-3 h-3 rounded-full shrink-0" style="background:{SEARCH_COLORS[i % SEARCH_COLORS.length]}"></span>
							<span class="text-slate-600 truncate flex-1">{item.r}</span>
							<span class="font-semibold text-slate-800">{item.c}</span>
							<span class="text-slate-400 text-xs w-8 text-right">{item.pct}%</span>
						</div>
					{/each}
				</div>
			</div>
			{/if}
		</div>

		{:else if widget.id === 'policies_by_insurer'}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-4 text-sm">Polisy wg TU (top 5)</h2>
			{#if policiesByInsurer().length === 0}
				<p class="text-center text-slate-400 text-sm py-4">Brak danych</p>
			{:else}
				<div class="space-y-3">
					{#each policiesByInsurer() as item}
						<div class="flex items-center gap-3">
							<span class="text-sm text-slate-600 w-28 truncate shrink-0">{item.nazwa}</span>
							<div class="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
								<div class="h-4 bg-blue-500 rounded-full transition-all" style="width: {item.pct}%"></div>
							</div>
							<span class="text-sm font-semibold text-slate-700 w-8 text-right shrink-0">{item.count}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{:else if widget.id === 'monthly_premium'}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-1 text-sm">Składka przypisana — bieżący miesiąc</h2>
			<p class="text-xs text-slate-400 mb-4">{thisMonth.replace('-', '.')}</p>
			<div class="flex items-end gap-4">
				<div>
					<div class="text-3xl font-bold text-slate-900">{fmtPln(premiumThisMonth)} <span class="text-sm font-normal text-slate-400">PLN</span></div>
					<div class="flex items-center gap-1 mt-1 text-sm">
						{#if premiumTrend === 'up'}
							<TrendingUp size={16} class="text-emerald-500" />
							<span class="text-emerald-600">Wzrost vs poprzedni miesiąc</span>
						{:else}
							<TrendingDown size={16} class="text-red-500" />
							<span class="text-red-600">Spadek vs poprzedni miesiąc</span>
						{/if}
					</div>
				</div>
				<div class="ml-auto text-right">
					<div class="text-sm text-slate-400">Poprzedni miesiąc</div>
					<div class="text-lg font-semibold text-slate-500">{fmtPln(premiumLastMonth)} PLN</div>
				</div>
			</div>
		</div>

		{:else if widget.id === 'claims_stats' && isBroker()}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-4 text-sm">Statystyki szkód</h2>
			<div class="grid grid-cols-2 gap-3">
				{#each claimsStats() as stat}
					<div class="rounded-xl p-3 {stat.color}">
						<div class="text-2xl font-bold">{stat.count}</div>
						<div class="text-xs font-medium mt-0.5">{stat.status}</div>
					</div>
				{/each}
			</div>
		</div>

		{:else if widget.id === 'premium_chart'}
		{@const chart = premiumChart()}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-1 text-base">Przypis składki — ostatnie 12 miesięcy</h2>
			<p class="text-sm text-slate-400 mb-4">Składka przypisana wg daty początku polisy</p>
			<div class="flex items-end gap-2 h-48">
				{#each chart as m}
				<div class="flex-1 flex flex-col justify-end items-center group relative">
					<div class="text-xs font-bold text-slate-700 mb-1 text-center leading-tight">
						{m.value > 0 ? fmtPln(m.value) : ''}
					</div>
					<div
						class="w-full rounded-t bg-blue-500 transition-all group-hover:bg-blue-600"
						style="height: {Math.max(m.pct, 2) * 1.92}px"
					></div>
				</div>
				{/each}
			</div>
			<div class="flex gap-2 mt-2">
				{#each chart as m}
				<div class="flex-1 text-center text-xs text-slate-500 font-semibold truncate">{m.label}</div>
				{/each}
			</div>
		</div>

		{:else if widget.id === 'dynamika'}
		{@const dyn = dynamika()}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-3 text-sm">Wzrost składki R/R</h2>
			{#if dyn.growth !== null}
				<div class="text-3xl font-bold {dyn.growth >= 0 ? 'text-emerald-600' : 'text-red-600'}">
					{dyn.growth >= 0 ? '+' : ''}{dyn.growth}%
				</div>
				<p class="text-xs text-slate-400 mt-1">{fmtPln(dyn.skladkaPrevYear)} → {fmtPln(dyn.skladkaThisYear)} PLN</p>
			{:else}
				<div class="text-2xl font-bold text-slate-400">—</div>
				<p class="text-xs text-slate-400 mt-1">Brak danych za poprzedni rok</p>
			{/if}
			<div class="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
				<div>
					<p class="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">Nowi klienci (mies.)</p>
					<div class="text-2xl font-bold text-slate-900">{dyn.newClientsThisMonth}</div>
					<p class="text-xs text-slate-400">{thisMonth.replace('-', '.')}</p>
				</div>
				<div>
					<p class="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">Nowe polisy (mies.)</p>
					<div class="text-2xl font-bold text-slate-900">{dyn.newPoliciesThisMonth}</div>
					<p class="text-xs text-slate-400">{thisMonth.replace('-', '.')}</p>
				</div>
			</div>
		</div>

		{:else if widget.id === 'zadania'}
		{#if appState.tenantFeatures['kalendarz']}
		{@const openTasks = appState.tasks.filter(t => t.status === 'otwarte' || t.status === 'w_toku')}
		{@const overdueTasks = openTasks.filter(t => t.termin && t.termin < new Date().toISOString().slice(0,10))}
		<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden h-full">
			<div class="px-5 py-4 border-b border-line flex items-center justify-between">
				<h2 class="font-semibold text-slate-900 text-sm flex items-center gap-2">
					✓ Zadania
				</h2>
				<a href="/calendar" class="text-xs text-blue-600 hover:underline">Zobacz wszystkie</a>
			</div>
			<div class="grid grid-cols-2 divide-x divide-line-soft border-b border-line-soft">
				<div class="px-4 py-3 text-center">
					<div class="text-xl font-bold text-slate-900">{openTasks.length}</div>
					<div class="text-xs text-slate-400 mt-0.5">Otwarte</div>
				</div>
				<div class="px-4 py-3 text-center">
					<div class="text-xl font-bold {overdueTasks.length > 0 ? 'text-red-600' : 'text-slate-400'}">{overdueTasks.length}</div>
					<div class="text-xs text-slate-400 mt-0.5">Przeterminowane</div>
				</div>
			</div>
			<ul class="divide-y divide-line-soft">
				{#each openTasks.slice(0, 5) as t}
					{@const pct = t.postep_pct ?? 0}
					{@const overdue = t.termin && t.termin < new Date().toISOString().slice(0,10)}
					<li class="px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors" onclick={() => openTask(t)}>
						<div class="flex items-center gap-2 mb-1">
							<span class="text-sm font-medium text-slate-800 flex-1 truncate">{t.tytul}</span>
							{#if t.termin}
								<span class="text-xs shrink-0 {overdue ? 'text-red-500' : 'text-slate-400'}">{t.termin}</span>
							{/if}
						</div>
						{#if t.czas_trwania_dni}
							<div class="flex items-center gap-2">
								<div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
									<div class="h-full rounded-full {pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-400'}"
										style="width:{pct}%"></div>
								</div>
								<span class="text-xs text-slate-400 shrink-0">{pct}%</span>
							</div>
						{/if}
					</li>
				{:else}
					<li class="px-4 py-6 text-center text-slate-400 text-sm">Brak otwartych zadań</li>
				{/each}
			</ul>
		</div>
		{/if}
		{/if}

	</div>
	{/each}

</div>
</section>
{/if}

{#if toast}
	<Toast tekst={toast.tekst} blad={toast.blad} oncofnij={toast.cofnij} onzamknij={() => (toast = null)} />
{/if}

<TaskModal
	open={taskModalOpen}
	editingTask={editingTask}
	onclose={() => { taskModalOpen = false; editingTask = null; }}
	onsaved={async () => {
		taskModalOpen = false; editingTask = null;
		const { data } = await wczytajZadania();
		appState.tasks = (data ?? []) as typeof appState.tasks;
	}}
/>
