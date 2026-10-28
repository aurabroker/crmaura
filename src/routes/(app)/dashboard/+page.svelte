<script lang="ts">
	import { wczytajWnioskiOdnowien, wczytajZadania } from '$lib/kolekcje';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr, fmtDzien, fmtTermin, odmiana } from '$lib/utils';
	import { poTerminie, ugBezRozliczania, ROZLICZONE } from '$lib/platnosci';
	import { miesiaceWstecz, skladkaMiesiecznie, wierszeRozliczen } from '$lib/rozliczenia';
	import { KOLOR, proc } from '$lib/analityka';
	import { nastepczynie, postepOdnowien } from '$lib/odnowieniaStat';
	import SkladkaRat from '$lib/components/wykresy/SkladkaRat.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { Settings2, TrendingUp, TrendingDown, AlertTriangle, CreditCard, Clock, RefreshCw, Check, ClipboardList, Inbox, Plus, Circle } from 'lucide-svelte';
	import { adresWniosku, podsumujWnioski, polisyKlientow, wniosekNowy, wniosekTestowy, wniosekZalatwiony, wnioskiDoObslugi, wnioskiZalatwioneZadaniem } from '$lib/components/renewal/crmRenewals';
	import { etykietaDecyzji } from '$lib/renewals/staffApi';
	import { ustawStatusZadania, zadanieOtwarte, zadanieZWniosku, zadaniaPoZmianie } from '$lib/zadania';
	import { umowaObowiazujaca, umowyProgramu } from '$lib/policyImport/umowaGeneralna';
	import { klientNieaktywny, nieOdnawiana, polisaAktywna } from '$lib/statusPolisy';
	import { adresOdnowieniaRecznego } from '$lib/formularzPolisy';
	import { OPIS_WERSJI, WERSJA } from '$lib/wersja';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import { isBroker } from '$lib/stores/app.svelte';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import type { CrmTask, Policy, WniosekOdnowienia } from '$lib/types/database';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import { onMount } from 'svelte';

	// Jeden modal zadania dla całego pulpitu: edycja z kolejki / sekcji Zadania albo nowe zadanie
	// (z pustego formularza albo do wniosku klienta — z gotowym tytułem, klientem i powiązaniem).
	let taskModalOpen = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	let presetZadania = $state<{ klientId?: string; klientNazwa?: string; renewalId?: string; tytul?: string; termin?: string }>({});

	function openTask(t: CrmTask) {
		editingTask = t;
		presetZadania = {};
		taskModalOpen = true;
	}
	function noweZadanie(preset: typeof presetZadania = {}) {
		editingTask = null;
		presetZadania = preset;
		taskModalOpen = true;
	}
	function zamknijModal() {
		taskModalOpen = false;
		editingTask = null;
		presetZadania = {};
	}

	const today = todayStr();
	const thisYear = new Date().getFullYear();
	const thisMonth = today.slice(0, 7); // "YYYY-MM"
	const lastMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
	const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

	// --- Obliczenia KPI ---
	// Polisy zakończone decyzją (nie odnawiamy) nie są „do odnowienia”.
	const renewals = $derived(
		appState.policies.filter((p) => {
			if (nieOdnawiana(p)) return false;
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 30;
		})
	);
	const klienciAktywni = $derived(appState.clients.filter((c) => !klientNieaktywny(c)).length);
	// Postęp odnowień bieżącego miesiąca (polisy kończące ochronę w tym miesiącu): odnowione / (kończące − zakończone decyzją).
	const postepMiesiaca = $derived(postepOdnowien(appState.policies, today, nastepczynie(appState.policies), { wstecz: 0, naprzod: 0 })[0]);
	const nazwaMiesiaca = new Date().toLocaleDateString('pl-PL', { month: 'long' });

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

	// „Top 5 klientów” jest w Statystykach; „Polisy wg TU” zdjęte z pulpitu (2026-10-17).

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

	// --- Składka z rat — 12 miesięcy: każda rata w miesiącu swojego terminu (nie cała składka polisy w miesiącu
	// jej początku), zainkasowana = raty opłacone / rozliczone z noty; prowizja kwotowo i jako średnia stawka. ---
	const wierszeRat = $derived(wierszeRozliczen(appState.payments, appState.policies, today));
	const skladkaRat = $derived(skladkaMiesiecznie(wierszeRat, miesiaceWstecz(today, 12)));
	const skladkaRatRazem = $derived.by(() => {
		const s = { skladka: 0, zainkasowana: 0, prowizja: 0, rat: 0, ratRozliczonych: 0 };
		for (const m of skladkaRat) { s.skladka += m.skladka; s.zainkasowana += m.zainkasowana; s.prowizja += m.prowizja; s.rat += m.rat; s.ratRozliczonych += m.ratRozliczonych; }
		return { ...s, stawka: s.skladka > 0 ? (s.prowizja * 100) / s.skladka : null };
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
		{ id: 'expiring_payments', label: 'Nadchodzące raty' },
		{ id: 'monthly_premium', label: 'Składka miesięczna' },
		{ id: 'claims_stats', label: 'Statystyki szkód' },
		{ id: 'premium_chart', label: 'Składka z rat (12 mies.)' },
		{ id: 'dynamika', label: 'Dynamika' },
	];

	let configMode = $state(false);

	// Analityka pod pulpitem — przeciągane widżety (kafelki KPI zastąpiły karty „Wymaga działania” i „Portfel”).
	// „top_clients” (w Statystykach) i „policies_by_insurer” (usunięte) mogą zostać w zapisanych preferencjach — są pomijane.
	const WIDGETY_ANALITYKI = new Set(['monthly_premium', 'claims_stats', 'premium_chart', 'dynamika', 'policy_count']);
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
			if (nieOdnawiana(p)) return false;
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 60;
		}).length
	);

	const polisaWg = $derived(new Map(appState.policies.map((p) => [p.id, p])));

	// APK z wniosków o odnowienie (program OC beauty): bieżący cykl, bez wniosków testowych.
	// Kafelek pokazuje się, gdy firma wysłała choć jeden prawdziwy wniosek.
	const maWnioskiApk = $derived(appState.wnioskiOdnowien.some((w) => !wniosekTestowy(w)));
	const odnowionePolisy = $derived(new Set(appState.policies.filter((p) => p.renewal_of && !p.deleted_at).map((p) => p.renewal_of as string)));
	// Pierwsze polisy (wniosek bez certyfikatu) są załatwione, gdy klient dostał polisę po złożeniu wniosku.
	const polisyKl = $derived(polisyKlientow(appState.policies));
	// Zadanie z wniosku (crm_tasks.renewal_id): otwarte przed zamkniętym, najnowsze pierwsze.
	const zadaniaWnioskow = $derived.by(() => {
		const m = new Map<string, CrmTask>();
		const lista = appState.tasks
			.filter(zadanieZWniosku)
			.sort((a, b) => Number(zadanieOtwarte(b)) - Number(zadanieOtwarte(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
		for (const t of lista) if (!m.has(t.renewal_id!)) m.set(t.renewal_id!, t);
		return m;
	});
	// Wniosek zamknięty zadaniem (zakończone / anulowane) schodzi z alertu, choć polisa nie powstała w CRM.
	const wnioskiZalatwione = $derived(wnioskiZalatwioneZadaniem(appState.tasks));
	const apkWnioski = $derived(podsumujWnioski(appState.wnioskiOdnowien, odnowionePolisy, today, polisyKl, wnioskiZalatwione));
	// Alert: klienci, którzy złożyli wniosek (i APK) online i czekają na ofertę / polisę.
	const wnioskiCzekaja = $derived(wnioskiDoObslugi(appState.wnioskiOdnowien, odnowionePolisy, today, polisyKl, wnioskiZalatwione));
	const wnioskiWg = $derived(new Map(appState.wnioskiOdnowien.map((w) => [w.id, w])));

	const kiedy = (iso: string | null | undefined) => {
		if (!iso) return '—';
		const d = dateDiffDays(iso.slice(0, 10), today);
		return d <= 0 ? 'dziś' : d === 1 ? 'wczoraj' : `${d} dni temu`;
	};
	const apkWniosku = (w: WniosekOdnowienia) => (w.apk_odmowa ? 'APK: odmowa' : w.apk_at ? 'APK wypełniona' : 'bez APK');

	// Wystawienie polisy z wniosku: pierwsza polisa — nowa polisa klienta; odnowienie — jak przycisk
	// „Odnów” na karcie polisy (ten sam rodzaj, przedmiot, pojazd, umowa programu obowiązująca od startu odnowienia).
	function linkNowejPolisy(w: WniosekOdnowienia): string {
		const p = w.polisa_id ? polisaWg.get(w.polisa_id) : undefined;
		if (wniosekNowy(w) || !p) return `/policies/new?klient=${w.klient_id}`;
		const ug = p.parent_id ? polisaWg.get(p.parent_id) : undefined;
		const start = p.data_do ? dateDiffDays(today, p.data_do) >= 0 ? new Date(`${p.data_do}T12:00:00Z`) : null : null;
		if (start) start.setUTCDate(start.getUTCDate() + 1);
		const ugOdnowienia = ug ? umowaObowiazujaca(umowyProgramu(appState.policies, ug.nr_polisy), start ? start.toISOString().slice(0, 10) : today) : null;
		return adresOdnowieniaRecznego(p, { parentId: ugOdnowienia?.id ?? null });
	}

	// Zadanie do wniosku: istniejące otwieramy, brak (wniosek sprzed powiązań) — nowe z gotowym tytułem.
	function otworzZadanieWniosku(w: WniosekOdnowienia) {
		const t = zadaniaWnioskow.get(w.id);
		if (t) return openTask(t);
		noweZadanie({
			klientId: w.klient_id,
			klientNazwa: w.klient_nazwa ?? undefined,
			renewalId: w.id,
			tytul: `${wniosekNowy(w) ? 'Pierwsza polisa' : 'Odnowienie'}: ${etykietaDecyzji(w.decyzja, w.rodzaj)} — ${w.klient_nazwa}`,
			termin: today
		});
	}

	// „Załatwione”: wniosek obsłużony poza CRM (np. klient zrezygnował przez telefon) — zamykamy zadanie z wniosku,
	// a gdy go nie ma, zapisujemy zamknięte zadanie, żeby decyzja została w historii. Do cofnięcia z paska na dole.
	async function zalatwWniosek(w: WniosekOdnowienia) {
		const t = zadaniaWnioskow.get(w.id);
		if (t && zadanieOtwarte(t)) {
			const blad = await ustawStatusZadania(t, 'zakonczone', appState.profile!.id);
			if (blad) { toast = { tekst: `Nie udało się zamknąć zadania: ${blad}`, blad: true }; return; }
			appState.tasks = zadaniaPoZmianie(appState.tasks, t.id, 'zakonczone');
			toast = {
				tekst: `Wniosek: ${w.klient_nazwa} — oznaczony jako załatwiony (zadanie zakończone)`,
				cofnij: async () => {
					toast = null;
					const b = await ustawStatusZadania({ ...t, status: 'zakonczone' }, 'otwarte', appState.profile!.id);
					if (b) { toast = { tekst: `Nie udało się cofnąć: ${b}`, blad: true }; return; }
					appState.tasks = zadaniaPoZmianie(appState.tasks, t.id, 'otwarte');
				}
			};
			return;
		}
		const teraz = new Date().toISOString();
		const { data, error } = await sb
			.from('crm_tasks')
			.insert({
				tenant_id: appState.profile!.tenant_id,
				created_by: appState.profile!.id,
				assigned_to: appState.profile!.id,
				klient_id: w.klient_id,
				polisa_id: w.polisa_id,
				renewal_id: w.id,
				typy: ['wniosek'],
				tytul: `Wniosek obsłużony poza CRM — ${w.klient_nazwa}`.slice(0, 200),
				opis: `${wniosekNowy(w) ? 'Pierwsza polisa' : 'Odnowienie'}: ${etykietaDecyzji(w.decyzja, w.rodzaj)}, złożony ${fmtDzien(w.zlozono_at?.slice(0, 10), true)}. Oznaczono jako załatwiony z pulpitu.`,
				termin: today,
				priorytet: 'normalny',
				status: 'zakonczone',
				zakonczone_at: teraz,
				postep_pct: 100
			} as never)
			.select('id')
			.single();
		if (error || !data) { toast = { tekst: `Nie udało się oznaczyć wniosku: ${error?.message ?? 'brak id'}`, blad: true }; return; }
		const id = (data as { id: string }).id;
		await odswiezZadania();
		toast = {
			tekst: `Wniosek: ${w.klient_nazwa} — oznaczony jako załatwiony`,
			cofnij: async () => {
				toast = null;
				const { error: e2 } = await sb.from('crm_tasks').delete().eq('id', id);
				if (e2) { toast = { tekst: `Nie udało się cofnąć: ${e2.message}`, blad: true }; return; }
				appState.tasks = appState.tasks.filter((x) => x.id !== id);
			}
		};
	}

	// Szybkie zakończenie z sekcji Zadania (kółko przy zadaniu) — z cofnięciem.
	async function zakonczZadanie(t: CrmTask) {
		const blad = await ustawStatusZadania(t, 'zakonczone', appState.profile!.id);
		if (blad) { toast = { tekst: `Nie udało się zakończyć zadania: ${blad}`, blad: true }; return; }
		appState.tasks = zadaniaPoZmianie(appState.tasks, t.id, 'zakonczone');
		toast = {
			tekst: `Zakończono: ${t.tytul}`,
			cofnij: async () => {
				toast = null;
				const b = await ustawStatusZadania({ ...t, status: 'zakonczone' }, t.status, appState.profile!.id);
				if (b) { toast = { tekst: `Nie udało się cofnąć: ${b}`, blad: true }; return; }
				appState.tasks = zadaniaPoZmianie(appState.tasks, t.id, t.status);
			}
		};
	}

	async function odswiezZadania() {
		const { data, error } = await wczytajZadania();
		if (!error && data) appState.tasks = data as typeof appState.tasks;
	}

	// Pulpit otwarty cały dzień: wnioski i zadania doczytują się co 2 minuty (gdy karta widoczna) i po powrocie do karty,
	// żeby alert o złożonym wniosku pojawił się bez odświeżania strony.
	onMount(() => {
		let wToku = false;
		const odswiez = async () => {
			if (wToku || document.visibilityState !== 'visible') return;
			wToku = true;
			try {
				const [rW] = await Promise.all([wczytajWnioskiOdnowien(), odswiezZadania()]);
				if (!rW.error && rW.data) appState.wnioskiOdnowien = rW.data as typeof appState.wnioskiOdnowien;
			} finally {
				wToku = false;
			}
		};
		const co = setInterval(() => void odswiez(), 120_000);
		const naPowrot = () => { if (document.visibilityState === 'visible') void odswiez(); };
		document.addEventListener('visibilitychange', naPowrot);
		return () => { clearInterval(co); document.removeEventListener('visibilitychange', naPowrot); };
	});

	// Kolejka brokera: wnioski klientów, zadania (w tym leady) i odnowienia. Raty tu nie wchodzą — płatności to temat
	// Rozliczeń i Płatności (kafelek „Po terminie” wyżej prowadzi do /payments).
	type TypKolejki = 'Wniosek' | 'Zadanie' | 'Odnowienie';
	type PozycjaKolejki = {
		klucz: string;
		typ: TypKolejki;
		tytul: string;
		klient: string | null;
		klientHref: string | null;
		dni: number;
		termin: string;
		opiekun: string | null;
		zadanie?: CrmTask;
		/** Zadanie z wniosku online — link „Wniosek” obok „Otwórz”. */
		wniosekHref?: string;
		polisaId?: string;
	};
	const KOLEJNOSC: Record<TypKolejki, number> = { Wniosek: 0, Zadanie: 1, Odnowienie: 2 };

	// Zadania po terminie i z terminem do 7 dni, odnowienia do 14 dni.
	// Zadanie z wniosku, który polisa w CRM już załatwiła (odnowienie wystawione / pierwsza polisa zawarta), nie czeka
	// w kolejce — baza zamyka je sama (trigger po dodaniu polisy), tu zabezpieczenie dla zadań sprzed tej zmiany.
	// Polisa, która ma już następczynię, nie jest „do odnowienia”.
	const kolejka = $derived.by((): PozycjaKolejki[] => {
		const zadania = dashOpenTasks
			.filter((t) => t.termin && dateDiffDays(today, t.termin) <= 7)
			.filter((t) => {
				const w = t.renewal_id ? wnioskiWg.get(t.renewal_id) : undefined;
				return !w || !wniosekZalatwiony(w, odnowionePolisy, polisyKl);
			})
			.map((t): PozycjaKolejki => {
				const w = t.renewal_id ? wnioskiWg.get(t.renewal_id) : undefined;
				return {
					klucz: 't' + t.id,
					typ: zadanieZWniosku(t) ? 'Wniosek' : 'Zadanie',
					tytul: t.tytul,
					klient: t.crm_clients?.nazwa ?? t.crm_prospects?.nazwa ?? null,
					klientHref: t.klient_id ? `/clients/${t.klient_id}` : null,
					dni: dateDiffDays(today, t.termin!),
					termin: t.termin!,
					opiekun: t.assigned_profile?.imie_nazwisko ?? t.assigned_profile?.email ?? null,
					zadanie: t,
					wniosekHref: w ? adresWniosku(w) : t.renewal_id && t.klient_id ? `/clients/${t.klient_id}?tab=apk` : undefined
				};
			});
		const odnowienia = appState.policies
			.filter((p) => p.typ_umowy !== 'generalna' && !nieOdnawiana(p) && !odnowionePolisy.has(p.id) && dateDiffDays(today, p.data_do) >= 0 && dateDiffDays(today, p.data_do) <= 14)
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
		return [...zadania, ...odnowienia].sort((a, b) => a.dni - b.dni || KOLEJNOSC[a.typ] - KOLEJNOSC[b.typ]);
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
		Wniosek: 'bg-accent-soft text-accent-text',
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

	// Sekcja Zadania: po terminie (najstarsze pierwsze), potem dzień po dniu w tym tygodniu, na końcu bez terminu.
	const ZALEGLE_W_SEKCJI = 8;
	const BEZ_TERMINU_W_SEKCJI = 5;
	const grupyZadan = $derived.by(() => {
		type Grupa = { klucz: string; etykieta: string; ton: string; zadania: CrmTask[]; ukryte: number };
		const grupy: Grupa[] = [];
		const zalegle = [...dashOverdueTasks].sort((a, b) => (a.termin ?? '').localeCompare(b.termin ?? '') || (a.godzina ?? '99').localeCompare(b.godzina ?? '99'));
		if (zalegle.length) grupy.push({ klucz: 'zalegle', etykieta: 'Po terminie', ton: 'text-danger', zadania: zalegle.slice(0, ZALEGLE_W_SEKCJI), ukryte: Math.max(0, zalegle.length - ZALEGLE_W_SEKCJI) });
		for (const d of tydzien) grupy.push({ klucz: d.data, etykieta: d.etykieta, ton: d.dzis ? 'text-accent-text' : 'text-ink-3', zadania: d.zadania, ukryte: 0 });
		const bezTerminu = dashOpenTasks.filter((t) => !t.termin);
		if (bezTerminu.length) grupy.push({ klucz: 'bez-terminu', etykieta: 'Bez terminu', ton: 'text-ink-3', zadania: bezTerminu.slice(0, BEZ_TERMINU_W_SEKCJI), ukryte: Math.max(0, bezTerminu.length - BEZ_TERMINU_W_SEKCJI) });
		return grupy;
	});
	const zadanWnioskowOtwartych = $derived(dashOpenTasks.filter(zadanieZWniosku).length);
	const tonPriorytetu: Record<CrmTask['priorytet'], string> = { pilny: 'bg-danger', wysoki: 'bg-warn', normalny: '', niski: '' };

	// Portfel w bieżącym roku (bez umów generalnych)
	const portfel = $derived.by(() => {
		const rok = String(thisYear);
		const umowy = appState.policies.filter((p) => p.typ_umowy !== 'generalna');
		const aktywne = umowy.filter((p) => p.data_od <= today && polisaAktywna(p, today)).length;
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

	// Komunikat po akcji (zadania, wnioski) — z możliwością cofnięcia
	let toast = $state<{ tekst: string; blad?: boolean; cofnij?: () => void } | null>(null);
</script>

<svelte:head><title>Pulpit — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
	<div>
		<h1 class="text-2xl font-semibold text-ink flex items-center gap-2">
			Dziś
			<span class="text-xs font-medium text-ink-3 bg-surface-2 border border-line rounded-full px-2 py-0.5"
				title="Wersja CRM {OPIS_WERSJI}">v{WERSJA}</span>
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
<!-- Wszystkie kafelki w jednym szeregu, gdy obok siebie mieści się po ~150 px na kafelek; węższy ekran zawija. -->
<section aria-label="Wymaga działania" data-testid="kafelki-dzis" class="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3 mb-5">
	<a href="/payments" class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {overduePayments.length ? 'text-danger' : 'text-ok'}">
			<CreditCard size={16} />
			{overduePayments.length ? 'Po terminie' : 'W porządku'}
		</span>
		<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{overduePayments.length}</span>
		<span class="text-[13px] leading-snug text-ink-2">{slowo(overduePayments.length, 'rata', 'raty', 'rat')} po terminie · {fmtZl(overdueSum)}</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Otwórz płatności →</span>
	</a>
	<button
		onclick={() => { filtrKolejki = 'Zadanie'; kolejkaCala = false; document.getElementById('kolejka')?.scrollIntoView({ behavior: 'smooth' }); }}
		class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors text-left"
	>
		<span class="flex items-center gap-2 text-[13px] font-semibold {dashOverdueTasks.length ? 'text-danger' : 'text-ok'}">
			<Clock size={16} />
			{dashOverdueTasks.length ? 'Po terminie' : 'W porządku'}
		</span>
		<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{dashOverdueTasks.length}</span>
		<span class="text-[13px] leading-snug text-ink-2">{slowo(dashOverdueTasks.length, 'zadanie', 'zadania', 'zadań')} z {dashOpenTasks.length} otwartych</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Przejrzyj zadania →</span>
	</button>
	<a href="/renewals" class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {renewals.length ? 'text-warn' : 'text-ok'}">
			<RefreshCw size={16} />
			W ciągu 30 dni
		</span>
		<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{renewals.length}</span>
		<span class="text-[13px] leading-snug text-ink-2">{slowo(renewals.length, 'polisa', 'polisy', 'polis')} do odnowienia · {renewals60} w 60 dni</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Plan odnowień →</span>
	</a>
	<a href="/statystyki#odnowienia" data-testid="kafelek-odnowienia" class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {postepMiesiaca.procent == null ? 'text-ink-2' : postepMiesiaca.procent >= 100 ? 'text-ok' : 'text-accent-text'}">
			<TrendingUp size={16} />
			Odnowienia · {nazwaMiesiaca}
		</span>
		<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{postepMiesiaca.procent == null ? '—' : proc(postepMiesiaca.procent, 0)}</span>
		<span class="text-[13px] leading-snug text-ink-2">
			{#if !postepMiesiaca.konczace.polisy}
				żadna polisa nie kończy się w tym miesiącu
			{:else if postepMiesiaca.procent == null}
				{slowo(postepMiesiaca.zakonczona.polisy, 'polisa zakończona', 'polisy zakończone', 'polis zakończonych')} decyzją, nic do odnowienia
			{:else}
				{postepMiesiaca.odnowiona.polisy} z {postepMiesiaca.konczace.polisy - postepMiesiaca.zakonczona.polisy} odnowionych · {postepMiesiaca.w_toku.polisy} w toku{postepMiesiaca.utracona.polisy ? ` · ${postepMiesiaca.utracona.polisy} utracone` : ''}
			{/if}
		</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">Postęp odnowień →</span>
	</a>
	{#if maWnioskiApk}
		{#if wnioskiCzekaja.length}
			<!-- Złożone wnioski mają pierwszeństwo przed linkami u klientów: klient czeka na ofertę / polisę. -->
			<a href="#wnioski" data-testid="kafelek-apk" class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-accent/50 hover:border-accent transition-colors">
				<span class="flex items-center gap-2 text-[13px] font-semibold text-accent-text">
					<Inbox size={16} />
					Wnioski · do wystawienia
				</span>
				<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{wnioskiCzekaja.length}</span>
				<span class="text-[13px] leading-snug text-ink-2">{slowo(wnioskiCzekaja.length, 'klient czeka', 'klientów czeka', 'klientów czeka')} na ofertę / polisę · {apkWnioski.czeka} {slowo(apkWnioski.czeka, 'link u klienta', 'linki u klientów', 'linków u klientów')}</span>
				<span class="mt-1 text-[13px] font-semibold text-accent-text">Zobacz wnioski ↓</span>
			</a>
		{:else}
			<a href="/apk?widok=wnioski" data-testid="kafelek-apk" class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
				<span class="flex items-center gap-2 text-[13px] font-semibold {apkWnioski.czeka ? 'text-warn' : 'text-ok'}">
					<ClipboardList size={16} />
					APK · {apkWnioski.czeka ? 'u klientów' : 'w porządku'}
				</span>
				<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{apkWnioski.czeka}</span>
				<span class="text-[13px] leading-snug text-ink-2">{slowo(apkWnioski.czeka, 'wniosek czeka', 'wnioski czekają', 'wniosków czeka')} · {apkWnioski.apk} APK wypełniono{apkWnioski.odmowy ? ` · ${apkWnioski.odmowy} ${slowo(apkWnioski.odmowy, 'odmowa', 'odmowy', 'odmów')}` : ''}</span>
				<span class="mt-1 text-[13px] font-semibold text-accent-text">Wnioski i APK →</span>
			</a>
		{/if}
	{/if}
	<a href={unresolvedAlerts.length ? '#alerty' : '/settings?tab=dokumenty'} class="flex flex-col gap-1 p-3.5 min-w-0 rounded-xl bg-white border border-line hover:border-slate-300 transition-colors">
		<span class="flex items-center gap-2 text-[13px] font-semibold {unresolvedAlerts.length ? 'text-danger' : 'text-ok'}">
			{#if unresolvedAlerts.length}<AlertTriangle size={16} />{:else}<Check size={16} />{/if}
			{unresolvedAlerts.length ? 'Wymaga uwagi' : 'W porządku'}
		</span>
		<span class="text-[26px] leading-8 font-semibold tabular-nums text-ink">{unresolvedAlerts.length}</span>
		<span class="text-[13px] leading-snug text-ink-2">{slowo(unresolvedAlerts.length, 'alert', 'alerty', 'alertów')} rozliczeniowych</span>
		<span class="mt-1 text-[13px] font-semibold text-accent-text">{unresolvedAlerts.length ? 'Zobacz alerty ↓' : 'Dokumenty rozliczeniowe →'}</span>
	</a>
</section>

<!-- Wnioski klientów złożone online — klient czeka na ofertę / polisę -->
{#if wnioskiCzekaja.length > 0}
	<section id="wnioski" data-testid="alert-wnioski" aria-labelledby="wnioski-h" class="mb-5 bg-white border border-accent/50 rounded-xl overflow-hidden scroll-mt-20">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-accent-soft border-b border-accent/30">
			<Inbox size={16} class="text-accent-text shrink-0" />
			<h2 id="wnioski-h" class="text-[15px] font-semibold text-accent-text">Klienci czekają na ofertę / polisę ({wnioskiCzekaja.length})</h2>
			<span class="text-[13px] text-ink-2">wniosek i APK wypełnione online — czas na wycenę i wystawienie polisy</span>
			<a href="/apk?widok=wnioski" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Wszystkie wnioski →</a>
		</div>
		<ul class="divide-y divide-line-soft">
			{#each wnioskiCzekaja as w (w.id)}
				{@const t = zadaniaWnioskow.get(w.id)}
				{@const nowa = wniosekNowy(w)}
				{@const dniZadania = t?.termin ? dateDiffDays(today, t.termin) : null}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" data-testid="wniosek-czeka">
					<span class="shrink-0 px-2 h-[22px] leading-[22px] rounded-full text-xs font-semibold {nowa ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}">{nowa ? 'Pierwsza polisa' : 'Odnowienie'}</span>
					<div class="min-w-[240px] flex-1 text-sm">
						<a href="/clients/{w.klient_id}" class="font-semibold text-ink hover:text-accent-text">{w.klient_nazwa}</a>
						{#if w.nr_polisy}<span class="font-mono text-[13px] text-ink-3"> · {w.nr_polisy}</span>{/if}
						<p class="text-[13px] text-ink-2">
							{etykietaDecyzji(w.decyzja, w.rodzaj)} · {apkWniosku(w)}{w.podpis_wniosku_at ? ' · podpisany' : ''} · złożony {kiedy(w.zlozono_at)}{!nowa && w.okres_do ? ` · ochrona do ${fmtDzien(w.okres_do)}` : ''}
							{#if t}
								· zadanie: {t.assigned_profile?.imie_nazwisko ?? t.assigned_profile?.email ?? 'nieprzypisane'}{#if dniZadania != null}, <span class={tonTerminu(dniZadania)}>{dniZadania === 0 ? 'termin dziś' : fmtTermin(t.termin!, today)}</span>{/if}
							{:else}
								· <span class="text-warn font-semibold">bez zadania</span>
							{/if}
						</p>
					</div>
					<div class="flex flex-wrap gap-1.5 ml-auto">
						<a href={adresWniosku(w)} class="h-8 leading-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Wniosek</a>
						<button onclick={() => otworzZadanieWniosku(w)} class="h-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">{t ? 'Zadanie' : '+ Zadanie'}</button>
						<a href={linkNowejPolisy(w)} class="h-8 leading-8 px-3 text-[13px] font-semibold rounded-lg bg-accent text-white hover:bg-accent-hover">Wystaw polisę</a>
						<button
							onclick={() => zalatwWniosek(w)}
							title="Wniosek obsłużony poza CRM (np. rezygnacja przez telefon): zamyka zadanie z wniosku i zdejmuje go z alertu. Wystawiona polisa zdejmuje wniosek sama."
							class="h-8 px-2.5 text-[13px] font-medium rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink"
						>Załatwione</button>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

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
							<Kopiuj tekst={alert.nr_polisy} opis="nr polisy" />
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
			<button onclick={() => noweZadanie()} data-testid="kolejka-nowe-zadanie" class="h-7 flex items-center gap-1 pl-2 pr-2.5 rounded-full text-[13px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors">
				<Plus size={14} /> Zadanie
			</button>
			<div role="group" aria-label="Filtr kolejki" class="flex flex-wrap gap-1.5 ml-auto">
				{#each [['wszystko', 'Wszystko', kolejka.length], ['Wniosek', 'Wnioski', licznikKolejki('Wniosek')], ['Zadanie', 'Zadania', licznikKolejki('Zadanie')], ['Odnowienie', 'Odnowienia', licznikKolejki('Odnowienie')]] as [id, label, n]}
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
						{#if q.zadanie}
							{#if q.wniosekHref}
								<a href={q.wniosekHref} class="shrink-0 h-8 leading-8 px-3 text-[13px] font-medium border border-line rounded-lg bg-white text-accent-text hover:bg-surface-2">Wniosek</a>
							{/if}
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
		<!-- Zadania: po terminie, ten tydzień dzień po dniu, bez terminu; dodawanie i szybkie zakończenie -->
		<section aria-labelledby="zadania-h" data-testid="sekcja-zadania" class="bg-white border border-line rounded-xl overflow-hidden">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 border-b border-line-soft">
				<div class="flex flex-col min-w-0">
					<h2 id="zadania-h" class="text-[15px] font-semibold text-ink">Zadania</h2>
					<span class="text-xs text-ink-3">
						{odmiana(dashOpenTasks.length, 'otwarte', 'otwarte', 'otwartych')}{dashOverdueTasks.length ? ` · ${dashOverdueTasks.length} po terminie` : ''}{zadanWnioskowOtwartych ? ` · ${zadanWnioskowOtwartych} z wniosków` : ''}
					</span>
				</div>
				<div class="ml-auto flex items-center gap-3">
					<button onclick={() => noweZadanie()} data-testid="zadania-nowe" class="h-8 flex items-center gap-1 pl-2 pr-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors">
						<Plus size={14} /> Nowe
					</button>
					{#if appState.tenantFeatures['kalendarz']}
						<a href="/calendar" class="text-[13px] font-semibold text-accent-text hover:underline whitespace-nowrap">Wszystkie →</a>
					{/if}
				</div>
			</div>
			<div class="px-4 py-3 flex flex-col gap-3">
				{#each grupyZadan as g (g.klucz)}
					<div class="flex gap-3">
						<span class="shrink-0 w-[84px] text-xs font-semibold pt-0.5 {g.ton}">{g.etykieta}</span>
						<ul class="flex-1 min-w-0 flex flex-col gap-1.5">
							{#each g.zadania as t (t.id)}
								{@const klient = t.crm_clients?.nazwa ?? t.crm_prospects?.nazwa ?? null}
								<li class="flex items-start gap-2 min-w-0">
									<button onclick={() => zakonczZadanie(t)} aria-label="Oznacz jako zakończone: {t.tytul}" title="Oznacz jako zakończone" class="shrink-0 mt-px text-ink-3 hover:text-ok transition-colors">
										<Circle size={15} />
									</button>
									<button onclick={() => openTask(t)} class="flex-1 min-w-0 flex items-center gap-2 text-[13px] text-left text-ink hover:text-accent-text">
										{#if zadanieZWniosku(t)}
											<span class="shrink-0 px-1.5 rounded text-[11px] font-semibold bg-accent-soft text-accent-text">Wniosek</span>
										{/if}
										{#if t.godzina}
											<span class="shrink-0 font-mono text-ink-3">{t.godzina.slice(0, 5)}</span>
										{/if}
										<span class="min-w-0 truncate"><span class="font-medium">{t.tytul}</span>{#if klient}<span class="text-ink-3"> · {klient}</span>{/if}</span>
										{#if g.klucz === 'zalegle' && t.termin}
											<span class="shrink-0 text-xs text-danger">{fmtDzien(t.termin)}</span>
										{/if}
										{#if tonPriorytetu[t.priorytet]}
											<span class="shrink-0 w-1.5 h-1.5 rounded-full {tonPriorytetu[t.priorytet]}" title="Priorytet: {t.priorytet}"></span>
										{/if}
									</button>
								</li>
							{/each}
							{#if g.ukryte}
								<li>
									<button onclick={() => { filtrKolejki = 'wszystko'; kolejkaCala = true; document.getElementById('kolejka')?.scrollIntoView({ behavior: 'smooth' }); }} class="text-xs font-semibold text-accent-text hover:underline">
										+{g.ukryte} więcej w kolejce →
									</button>
								</li>
							{/if}
						</ul>
					</div>
				{:else}
					<p class="text-sm text-ink-3 py-2">
						Brak otwartych zadań na najbliższe 7 dni.
						<button onclick={() => noweZadanie()} class="font-semibold text-accent-text hover:underline">Dodaj zadanie</button>
					</p>
				{/each}
			</div>
		</section>
	</div>
</div>

<!-- Odnowienia — najbliższe 30 dni (połowa strony) i Portfel obok -->
<div class="grid grid-cols-[repeat(auto-fit,minmax(min(500px,100%),1fr))] gap-4 mb-6 items-start">
	<!-- Odnowienia — najbliższe 30 dni -->
	<section aria-labelledby="odnowienia-h" data-testid="odnowienia-30" class="bg-white border border-line rounded-xl overflow-hidden min-w-0">
		<div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft">
			<h2 id="odnowienia-h" class="text-[15px] font-semibold text-ink">Odnowienia — najbliższe 30 dni</h2>
			<span class="text-[13px] text-ink-3">{odmiana(renewals.length, 'polisa', 'polisy', 'polis')}</span>
			<a href="/renewals" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Wszystkie odnowienia →</a>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full min-w-[460px] text-[13px] text-left">
				<thead>
					<tr class="bg-surface-2 text-ink-2">
						<SortTh s={sortWznowienia} k="nr" wersaliki={false} class="px-3 py-2 font-semibold">Polisa</SortTh>
						<SortTh s={sortWznowienia} k="klient" wersaliki={false} class="px-3 py-2 font-semibold">Klient</SortTh>
						<SortTh s={sortWznowienia} k="tu" wersaliki={false} class="px-3 py-2 font-semibold">TU</SortTh>
						<SortTh s={sortWznowienia} k="do" wersaliki={false} class="px-3 py-2 font-semibold">Koniec ochrony</SortTh>
						<th class="px-3 py-2 font-semibold text-right">Składka</th>
					</tr>
				</thead>
				<tbody>
					{#each renewalsRows.slice(0, 8) as p}
						{@const dni = dateDiffDays(today, p.data_do)}
						<tr class="border-t border-line-soft hover:bg-bg">
							<td class="px-3 py-2.5 font-mono text-xs font-medium whitespace-nowrap"><a href="/policies/{p.id}" class="text-accent-text hover:underline">{p.nr_polisy}</a> <Kopiuj tekst={p.nr_polisy} opis="nr polisy" /></td>
							<td class="px-3 py-2.5 max-w-[170px]"><a href="/clients/{p.klient_id}" class="block truncate font-medium text-ink hover:text-accent-text" title={p.crm_clients?.nazwa ?? ''}>{p.crm_clients?.nazwa ?? '—'}</a></td>
							<td class="px-3 py-2.5 text-ink-2">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? '—'}</td>
							<td class="px-3 py-2.5 whitespace-nowrap">{fmtDzien(p.data_do)} <span class="block text-xs {dni <= 14 ? 'text-warn font-semibold' : 'text-ink-3'}">{fmtTermin(p.data_do, today)}</span></td>
							<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(p.skladka_przypisana)} zł</td>
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

	<!-- Portfel -->
	<section aria-labelledby="portfel-h" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3.5">
		<h2 id="portfel-h" class="text-[15px] font-semibold text-ink">Portfel w {thisYear}</h2>
		<dl class="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
			<div class="flex flex-col gap-0.5"><dt class="text-xs text-ink-3">Aktywne polisy</dt><dd class="text-xl font-semibold tabular-nums">{portfel.aktywne}</dd></div>
			<div class="flex flex-col gap-0.5" title="Klienci aktywni (bez oznaczonych jako nieaktywni)"><dt class="text-xs text-ink-3">Klienci</dt><dd class="text-xl font-semibold tabular-nums">{klienciAktywni.toLocaleString('pl-PL')}</dd></div>
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

<!-- Dolne widgety — drag & drop -->
{#if bottomDraggableItems.length > 0}
<section class="mb-6">
<SectionHeader title="Analityka i zestawienia" />
<!-- Trzy kolumny: kafle „Liczba polis”, „Składka przypisana”, „Wzrost składki R/R” w jednym szeregu; wykres składki z rat na całą szerokość. -->
<div
	class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
	data-testid="analityka"
	use:dndzone={{ items: bottomDraggableItems, flipDurationMs: 200 }}
	onconsider={handleBottomDnd}
	onfinalize={finalizeBottomDnd}
>

	{#each bottomDraggableItems as widget (widget.id)}
	<div class="min-w-0 {widget.id === 'premium_chart' ? 'md:col-span-2 lg:col-span-3' : ''} {configMode ? 'cursor-grab active:cursor-grabbing' : ''}">

		{#if widget.id === 'policy_count'}
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
			<div class="flex items-center gap-5">
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

		{:else if widget.id === 'monthly_premium'}
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full">
			<h2 class="font-semibold text-slate-900 mb-1 text-sm">Składka przypisana — bieżący miesiąc</h2>
			<p class="text-xs text-slate-400 mb-4">{thisMonth.replace('-', '.')}</p>
			<div class="flex flex-wrap items-end gap-x-4 gap-y-2">
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
		<div class="bg-white border border-line rounded-xl shadow-sm p-5 h-full flex flex-col gap-4" data-testid="skladka-rat">
			<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
				<div class="flex-1 min-w-[220px]">
					<h2 class="font-semibold text-slate-900 text-base">Składka z rat — ostatnie 12 miesięcy</h2>
					<p class="text-sm text-slate-400">Każda rata w miesiącu swojego terminu (nie cała składka polisy) · zainkasowana = raty opłacone lub rozliczone z noty TU · prowizja z tych rat kwotowo i jako średnia stawka</p>
				</div>
				<dl class="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
					<div class="flex flex-col"><dt class="text-xs text-ink-3">Zainkasowano</dt><dd class="font-semibold tabular-nums text-ink">{fmtZl(skladkaRatRazem.zainkasowana)} <span class="font-normal text-ink-3">z {fmtZl(skladkaRatRazem.skladka)}</span></dd></div>
					<div class="flex flex-col"><dt class="text-xs text-ink-3">Raty</dt><dd class="font-semibold tabular-nums text-ink">{skladkaRatRazem.ratRozliczonych} <span class="font-normal text-ink-3">z {skladkaRatRazem.rat} rozliczonych</span></dd></div>
					<div class="flex flex-col"><dt class="text-xs" style="color: {KOLOR.seria2}">Prowizja</dt><dd class="font-semibold tabular-nums" style="color: {KOLOR.seria2}">{fmtZl(skladkaRatRazem.prowizja)} <span class="font-normal">· średnio {skladkaRatRazem.stawka != null ? fmtProc(skladkaRatRazem.stawka) : '—'}</span></dd></div>
				</dl>
			</div>
			{#if skladkaRatRazem.rat === 0}
				<p class="text-center text-slate-400 text-sm py-8">Brak rat z terminem w ostatnich 12 miesiącach.</p>
			{:else}
				<SkladkaRat dane={skladkaRat} opis="Składka z rat miesięcznie: zainkasowana, do zapłaty i prowizja" />
				<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
					<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm" style="background: {KOLOR.seria}"></span>zainkasowana</span>
					<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm" style="background: {KOLOR.seriaJasna}"></span>do zapłaty (termin w miesiącu)</span>
					<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm" style="background: {KOLOR.seria2}"></span>prowizja — pod miesiącem kwota i średnia stawka</span>
				</div>
			{/if}
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
	presetKlientId={presetZadania.klientId ?? ''}
	presetKlientNazwa={presetZadania.klientNazwa ?? ''}
	presetRenewalId={presetZadania.renewalId ?? ''}
	presetTytul={presetZadania.tytul ?? ''}
	presetTermin={presetZadania.termin ?? ''}
	onclose={zamknijModal}
	onsaved={zamknijModal}
/>
