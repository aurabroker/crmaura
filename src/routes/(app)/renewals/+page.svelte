<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import { Search, Eye, ExternalLink, RefreshCw, Pencil, User, Copy } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import type { Policy, RenewalRow } from '$lib/types/database';
	import { sb } from '$lib/supabase';
	import CrmRenewalBadge from '$lib/components/renewal/CrmRenewalBadge.svelte';
	import { czyAktywny, wProgramieOcBeauty } from '$lib/components/renewal/crmRenewals';

	let search = $state('');
	let tylkoBezWniosku = $state(false);

	// Wnioski o odnowienie (program OC beauty): najnowszy na polisę. Przed migracją tabeli
	// zapytanie zwraca błąd — wtedy kolumna i filtr się nie pokazują.
	type WniosekSkrot = Pick<RenewalRow, 'polisa_id' | 'status' | 'decyzja' | 'wyslano_at' | 'zlozono_at' | 'created_at'>;
	let wnioski = $state<Map<string, WniosekSkrot> | null>(null);

	$effect(() => {
		let anulowane = false;
		(async () => {
			try {
				let q = sb.from('crm_renewals').select('polisa_id,status,decyzja,wyslano_at,zlozono_at,created_at');
				const tid = appState.profile?.tenant_id;
				if (tid) q = q.eq('tenant_id', tid);
				const { data, error } = await q.order('created_at', { ascending: false });
				if (anulowane || error) return;
				const m = new Map<string, WniosekSkrot>();
				for (const r of (data ?? []) as WniosekSkrot[]) if (!m.has(r.polisa_id)) m.set(r.polisa_id, r);
				wnioski = m;
			} catch {
				// brak tabeli albo sieci — strona działa bez kolumny wniosków
			}
		})();
		return () => (anulowane = true);
	});

	const programIds = $derived(new Set(appState.policies.filter((p) => wProgramieOcBeauty(p, appState.policies)).map((p) => p.id)));
	const odnowione = $derived(new Set(appState.policies.filter((q) => q.renewal_of && !q.deleted_at).map((q) => q.renewal_of!)));

	// Certyfikat programu kończący się w ciągu 45 dni, bez aktywnego wniosku i jeszcze nieodnowiony.
	function bezWniosku(p: Policy): boolean {
		if (!wnioski || !programIds.has(p.id) || odnowione.has(p.id)) return false;
		const d = daysUntil(p.data_do);
		if (d < 0 || d > 45) return false;
		const w = wnioski.get(p.id);
		return !w || !czyAktywny(w.status) || (w.status === 'utworzony' && !w.wyslano_at);
	}
	const bezWnioskuCount = $derived(wnioski ? appState.policies.filter(bezWniosku).length : 0);

	function renewalMenu(p: Policy): CtxItem[] {
		return [
			{ label: 'Otwórz polisę', icon: Eye, onSelect: () => goto(`/policies/${p.id}`) },
			{
				label: 'Otwórz w nowej karcie',
				icon: ExternalLink,
				onSelect: () => window.open(`/policies/${p.id}`, '_blank', 'noopener')
			},
			{ separator: true },
			{
				label: 'Wznów polisę',
				icon: RefreshCw,
				onSelect: () => goto(`/policies/new?renewal_of=${p.id}`)
			},
			{ label: 'Edytuj', icon: Pencil, onSelect: () => goto(`/policies/${p.id}/edit`) },
			{ separator: true },
			{
				label: 'Karta klienta',
				icon: User,
				disabled: !p.klient_id,
				onSelect: () => goto(`/clients/${p.klient_id}`)
			},
			{ label: 'Kopiuj nr polisy', icon: Copy, onSelect: () => ctxCopy(p.nr_polisy, 'nr polisy') }
		];
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	function daysUntil(dateStr: string): number {
		const d = new Date(dateStr);
		d.setHours(0, 0, 0, 0);
		return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
	}

	const filtered = $derived(
		appState.policies
			.filter((p) => !tylkoBezWniosku || bezWniosku(p))
			.filter((p) => {
				if (!search) return true;
				const s = search.toLowerCase();
				return (
					p.nr_polisy.toLowerCase().includes(s) ||
					(p.crm_clients?.nazwa ?? '').toLowerCase().includes(s)
				);
			})
	);

	// Domyślnie wg daty końca rosnąco (najwcześniej wygasające na górze)
	const sort = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		tu: (p) => p.crm_insurers?.nazwa,
		rodzaj: (p) => p.rodzaj,
		do: (p) => p.data_do,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		status: (p) => p.data_do,
		dni: (p) => daysUntil(p.data_do)
	}, { klucz: 'do', kierunek: 'asc' }, 'odnowienia');
	const wiersze = $derived(sort.sortuj(filtered));
	const najpozniej = $derived(sort.klucz === 'do' && sort.kierunek === 'desc');

	const expiredCount = $derived(filtered.filter((p) => daysUntil(p.data_do) < 0).length);
	const in30Count = $derived(filtered.filter((p) => { const d = daysUntil(p.data_do); return d >= 0 && d <= 30; }).length);
	const in60Count = $derived(filtered.filter((p) => { const d = daysUntil(p.data_do); return d > 30 && d <= 60; }).length);

	function rowClass(dataDoStr: string): string {
		const days = daysUntil(dataDoStr);
		if (days < 0) return 'bg-red-50';
		if (days <= 30) return 'bg-amber-50';
		if (days <= 60) return 'bg-emerald-50';
		return '';
	}

	function statusBadge(dataDoStr: string): { label: string; variant: 'error' | 'warning' | 'success' } {
		const days = daysUntil(dataDoStr);
		if (days < 0) return { label: 'Wygasła', variant: 'error' };
		if (days <= 30) return { label: 'Wygasa wkrótce', variant: 'warning' };
		return { label: 'Aktywna', variant: 'success' };
	}
</script>

<svelte:head><title>Odnowienia — AuraCRM</title></svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold text-slate-900">Odnowienia</h1>

	<!-- Summary cards -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasłe</p>
			<p class="mt-1 text-3xl font-bold text-red-600">{expiredCount}</p>
		</div>
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasa w 30 dni</p>
			<p class="mt-1 text-3xl font-bold text-amber-600">{in30Count}</p>
		</div>
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasa w 60 dni</p>
			<p class="mt-1 text-3xl font-bold text-emerald-600">{in60Count}</p>
		</div>
	</div>

	<!-- Controls -->
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="relative">
			<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				bind:value={search}
				placeholder="Szukaj klienta lub nr polisy..."
				class="w-full rounded-lg border border-line py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-80"
			/>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if wnioski && programIds.size > 0}
				<button
					onclick={() => (tylkoBezWniosku = !tylkoBezWniosku)}
					aria-pressed={tylkoBezWniosku}
					title="Certyfikaty programu OC beauty kończące się w ciągu 45 dni, bez aktywnego wniosku o odnowienie"
					class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
						{tylkoBezWniosku ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-line bg-white text-slate-600 hover:bg-slate-50'}"
				>
					Bez wysłanego wniosku ({bezWnioskuCount})
				</button>
			{/if}
			<button
				onclick={() => sort.przelacz('do')}
				class="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
			>
				{sort.klucz !== 'do' ? 'Sortuj wg daty końca' : najpozniej ? 'Najpóźniej wygasa' : 'Najwcześniej wygasa'}
			</button>
		</div>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
		<table class="min-w-full text-sm">
			<thead>
				<tr class="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
					<SortTh s={sort} k="nr" class="px-4 py-3">Nr Polisy</SortTh>
					<SortTh s={sort} k="klient" class="px-4 py-3">Klient</SortTh>
					<SortTh s={sort} k="tu" class="px-4 py-3">TU</SortTh>
					<SortTh s={sort} k="rodzaj" class="px-4 py-3">Rodzaj</SortTh>
					<SortTh s={sort} k="do" class="px-4 py-3">Data do</SortTh>
					<SortTh s={sort} k="skladka" class="px-4 py-3 text-right" align="right">Składka</SortTh>
					<SortTh s={sort} k="status" class="px-4 py-3">Status</SortTh>
					{#if wnioski}<th class="px-4 py-3">Wniosek</th>{/if}
					<SortTh s={sort} k="dni" class="px-4 py-3 text-right" align="right">Dni do wygaśnięcia</SortTh>
				</tr>
			</thead>
			<tbody class="divide-y divide-line-soft">
				{#each wiersze as p (p.id)}
					{@const days = daysUntil(p.data_do)}
					{@const badge = statusBadge(p.data_do)}
					<tr use:ctxMenu={{ items: () => renewalMenu(p), title: p.nr_polisy }}
						class="{rowClass(p.data_do)} hover:bg-slate-50/50 transition-colors">
						<td class="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{p.nr_polisy}</td>
						<td class="px-4 py-3 text-slate-700">{p.crm_clients?.nazwa ?? '—'}</td>
						<td class="px-4 py-3 text-slate-700">{p.crm_insurers?.nazwa ?? '—'}</td>
						<td class="px-4 py-3 text-slate-700">{p.rodzaj ?? '—'}</td>
						<td class="whitespace-nowrap px-4 py-3 text-slate-700">{p.data_do}</td>
						<td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">{fmtPln(p.skladka_przypisana)}</td>
						<td class="px-4 py-3">
							<Badge variant={badge.variant}>{badge.label}</Badge>
						</td>
						{#if wnioski}
							{@const w = wnioski.get(p.id)}
							<td class="px-4 py-3 whitespace-nowrap" data-testid="kolumna-wniosek">
								{#if w}
									<CrmRenewalBadge status={w.status} decyzja={w.decyzja} />
								{:else if programIds.has(p.id)}
									<span class="text-xs text-slate-400">nie wysłano</span>
								{:else}
									<span class="text-slate-300">—</span>
								{/if}
							</td>
						{/if}
						<td class="whitespace-nowrap px-4 py-3 text-right font-medium {days < 0 ? 'text-red-600' : days <= 30 ? 'text-amber-600' : 'text-slate-700'}">
							{days}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if filtered.length === 0}
			<div class="py-12 text-center text-sm text-slate-400">Brak polis do wyświetlenia</div>
		{/if}
	</div>
</div>
