<script lang="ts">
	import { wczytajAneksy, wczytajPolisy, wczytajSzkody } from '$lib/kolekcje';
	import { opiekunZUmowy } from '$lib/policyImport/umowaGeneralna';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { dateDiffDays, fmtDzien, fmtPln, fmtTermin, odmiana, todayStr, ugPodtypCls } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import type { Snippet } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import {
		Search, Pencil, FilePlus2, Eye, ExternalLink, Copy, User, AlertTriangle, Trash2, Plus,
		ChevronDown, ChevronLeft, ChevronRight, X, Download, Upload, FileStack, FileText
	} from 'lucide-svelte';
	import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import { nazwaRodzaju, nazwaTu, odnowionePolisy, statusPolisy } from '$lib/statusPolisy';
	import { page } from '$app/stores';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, ctxToast, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { logAudit } from '$lib/utils/audit';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';

	let search = $state('');
	let filterTyp = $state<'all' | 'jednostkowa' | 'generalna'>('all');
	let lockedTyp = $state(false);

	// Modals
	let showPolicy = $state(false);
	let showEdit = $state(false);
	let showAnnex = $state(false);
	let showClaim = $state(false);
	let editingPolicy = $state<Policy | null>(null);
	let annexingPolicy = $state<Policy | null>(null);

	// PolicyForm refs
	let newPolicyForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let editPolicyForm = $state<ReturnType<typeof PolicyForm> | null>(null);

	// Annex form
	let axNr = $state('');
	let axTyp = $state<'korekta' | 'doubezpieczenie' | 'zmiana_zakresu' | 'inne'>('korekta');
	let axData = $state('');
	let axOpis = $state('');
	let axDeltaSkladka = $state('0');
	let axDeltaProwizja = $state('0');
	let axNewDataDo = $state('');
	let axNewSkladka = $state('');
	let axNewProwizjaPct = $state('');

	// Claim form
	let fclKlient = $state('');
	let fclPolisa = $state('');
	let fclNr = $state('');
	let fclData = $state('');
	let fclOpis = $state('');

	let saving = $state(false);
	let formError = $state('');

	// ── Lista: segmenty, filtry, sortowanie, strony ─────────────────────────────
	const dzis = todayStr();
	const odnowione = $derived(odnowionePolisy(appState.policies));
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	// Polisy z co najmniej jedną ratą po terminie (te same reguły co Płatności).
	const zZaleglaRata = $derived(new Set(appState.payments.filter(r => !ROZLICZONE.includes(r.status) && poTerminie(r, dzis, ugBez)).map(r => r.polisa_id)));
	const status = (p: Policy) => statusPolisy(p, { dzis, odnowione, zZaleglaRata });

	// O(1) lookup map instead of O(n) find per row
	const parentNrMap = $derived(new Map(appState.policies.map(p => [p.id, p.nr_polisy])));
	function parentNr(parentId: string | null): string {
		return parentId ? (parentNrMap.get(parentId) ?? '—') : '—';
	}
	const liczbaWUg = $derived.by(() => {
		const m = new Map<string, number>();
		for (const p of appState.policies) if (p.parent_id) m.set(p.parent_id, (m.get(p.parent_id) ?? 0) + 1);
		return m;
	});
	const liczbaAneksow = $derived.by(() => {
		const m = new Map<string, number>();
		for (const a of appState.annexes) m.set(a.polisa_id, (m.get(a.polisa_id) ?? 0) + 1);
		return m;
	});
	const opiekunKlienta = $derived(new Map(appState.clients.map(c => [c.id, c.opiekun_id])));

	type Segment = 'wszystkie' | 'aktywne' | 'wygasaja' | 'zalegle' | 'zakonczone';
	let segment = $state<Segment>('wszystkie');
	const aktywna = (p: Policy) => !(p.data_do && p.data_do < dzis);
	function wSegmencie(p: Policy, s: Segment): boolean {
		if (s === 'wszystkie') return true;
		if (s === 'aktywne') return aktywna(p);
		if (s === 'wygasaja') return aktywna(p) && !!p.data_do && dateDiffDays(dzis, p.data_do) <= 30 && !odnowione.has(p.id);
		if (s === 'zalegle') return zZaleglaRata.has(p.id);
		return !aktywna(p);
	}
	const SEGMENTY: [Segment, string][] = [['wszystkie', 'Wszystkie'], ['aktywne', 'Aktywne'], ['wygasaja', 'Wygasają w 30 dni'], ['zalegle', 'Z ratą po terminie'], ['zakonczone', 'Zakończone']];

	// Filtry (typ umowy tylko poza widokiem „Umowy generalne” z menu)
	let fTypUmowy = $state<'' | 'jednostkowa' | 'generalna' | 'w_ug'>('');
	let fTu = $state('');
	let fRodzaj = $state('');
	let fOpiekun = $state('');
	const ileFiltrow = $derived([fTypUmowy, fTu, fRodzaj, fOpiekun].filter(Boolean).length);
	function wyczyscFiltry() { fTypUmowy = ''; fTu = ''; fRodzaj = ''; fOpiekun = ''; search = ''; }

	// Najpierw typ z menu (Polisy / Umowy generalne), potem segmenty liczone na tym zbiorze.
	const bazowe = $derived(appState.policies.filter((p) => filterTyp === 'all' || p.typ_umowy === filterTyp));
	const liczSeg = $derived(Object.fromEntries(SEGMENTY.map(([id]) => [id, bazowe.filter(p => wSegmencie(p, id)).length])) as Record<Segment, number>);
	const towarzystwa = $derived(
		appState.insurers.filter(i => bazowe.some(p => p.tu_id === i.id)).sort((a, b) => (a.skrot || a.nazwa).localeCompare(b.skrot || b.nazwa, 'pl'))
	);
	const rodzaje = $derived([...new Set(bazowe.filter(p => p.typ_umowy !== 'generalna').map(p => p.rodzaj).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')));
	const opiekunowie = $derived([...appState.brokers].sort((a, b) => (a.imie_nazwisko || a.email).localeCompare(b.imie_nazwisko || b.email, 'pl')));
	const opiekunWg = $derived(new Map(appState.brokers.map(b => [b.id, b.imie_nazwisko || b.email])));

	// Wszystkie polisy w jednej liście — Umowa Generalna jest tylko kolumną porządkową,
	// polisy podpięte pod UG są widoczne tak samo jak pozostałe.
	const widoczne = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return bazowe.filter((p) => {
			if (!wSegmencie(p, segment)) return false;
			if (fTypUmowy === 'w_ug' ? !p.parent_id : fTypUmowy && p.typ_umowy !== fTypUmowy) return false;
			if (fTu && p.tu_id !== fTu) return false;
			if (fRodzaj && p.rodzaj !== fRodzaj) return false;
			if (fOpiekun && (fOpiekun === '-' ? !!opiekunKlienta.get(p.klient_id) : opiekunKlienta.get(p.klient_id) !== fOpiekun)) return false;
			return !q ||
				p.nr_polisy.toLowerCase().includes(q) ||
				(p.crm_clients?.nazwa ?? '').toLowerCase().includes(q) ||
				(p.przedmiot ?? '').toLowerCase().includes(q) ||
				(p.parent_id ? parentNr(p.parent_id).toLowerCase().includes(q) : false);
		});
	});

	const sort = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		tu: (p) => p.crm_insurers?.skrot || p.crm_insurers?.nazwa,
		rodzaj: (p) => (p.typ_umowy === 'generalna' ? `UG ${p.ug_podtyp ?? ''}` : p.rodzaj),
		od: (p) => p.data_od,
		do: (p) => p.data_do,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		prowizja: (p) => Number(p.prowizja_przypisana ?? 0),
		status: (p) => status(p).tekst
	}, { klucz: 'nr' }, 'polisy');
	const wiersze = $derived(sort.sortuj(widoczne));
	const sumy = $derived(widoczne.reduce((s, p) => ({ skladka: s.skladka + Number(p.skladka_przypisana ?? 0), prowizja: s.prowizja + Number(p.prowizja_przypisana ?? 0) }), { skladka: 0, prowizja: 0 }));

	const NA_STRONE = 50;
	let strona = $state(0);
	const stron = $derived(Math.max(1, Math.ceil(wiersze.length / NA_STRONE)));
	$effect(() => {
		void segment; void search; void fTypUmowy; void fTu; void fRodzaj; void fOpiekun; void filterTyp; void sort.klucz; void sort.kierunek;
		strona = 0;
	});
	const naStronie = $derived(wiersze.slice(strona * NA_STRONE, (strona + 1) * NA_STRONE));
	const zakres = $derived(wiersze.length === 0 ? '0 z 0' : `${strona * NA_STRONE + 1}–${Math.min((strona + 1) * NA_STRONE, wiersze.length)} z ${wiersze.length.toLocaleString('pl-PL')}`);

	// Zaznaczanie i eksport
	let selected = $state<Set<string>>(new Set());
	$effect(() => { void segment; void filterTyp; selected = new Set(); });
	function toggleSelect(id: string) {
		const n = new Set(selected);
		if (n.has(id)) n.delete(id); else n.add(id);
		selected = n;
	}
	const wszystkieNaStronie = $derived(naStronie.length > 0 && naStronie.every(p => selected.has(p.id)));
	function toggleStrona() {
		const n = new Set(selected);
		if (wszystkieNaStronie) naStronie.forEach(p => n.delete(p.id)); else naStronie.forEach(p => n.add(p.id));
		selected = n;
	}
	function eksportujCsv() {
		const wybrane = wiersze.filter(p => selected.has(p.id));
		const pole = (v: string | number | null | undefined) => {
			const t = v == null ? '' : String(v);
			return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
		};
		const naglowek = ['Nr polisy', 'Typ umowy', 'Umowa generalna', 'Klient', 'Towarzystwo', 'Rodzaj', 'Przedmiot', 'Od', 'Do', 'Składka przypisana', 'Składka zainkasowana', 'Prowizja %', 'Prowizja przypisana', 'Status'];
		const linie = wybrane.map(p => [
			p.nr_polisy, p.typ_umowy, p.parent_id ? parentNr(p.parent_id) : '', p.crm_clients?.nazwa, nazwaTu(p), nazwaRodzaju(p.rodzaj), p.przedmiot,
			p.data_od, p.data_do, fmtPln(p.skladka_przypisana), fmtPln(p.skladka_zainkasowana), p.prowizja_pct, fmtPln(p.prowizja_przypisana), status(p).tekst
		].map(pole).join(';'));
		const blob = new Blob(['\uFEFF' + [naglowek.join(';'), ...linie].join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `polisy-${dzis}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		void logAudit('policies_exported', 'policy', null, odmiana(wybrane.length, 'polisa', 'polisy', 'polis'), { ids: wybrane.map(p => p.id) });
		ctxToast(`Wyeksportowano: ${odmiana(wybrane.length, 'polisa', 'polisy', 'polis')}`);
	}

	let nowaMenu = $state(false);
	const trybUg = $derived(lockedTyp && filterTyp === 'generalna');

	async function reloadPolicies() {
		const [rP, rA] = await Promise.all([
			wczytajPolisy(),
			wczytajAneksy()
		]);
		// Przy błędzie zostaje dotychczasowa lista (pusta lista wyglądałaby jak brak polis).
		if (!rP.error && rP.data) appState.policies = rP.data as typeof appState.policies;
		if (!rA.error && rA.data) appState.annexes = rA.data as typeof appState.annexes;
	}

	async function saveNewPolicy() {
		if (!newPolicyForm) return;
		const err = newPolicyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals: Record<string, unknown> = newPolicyForm.getValues();
		// Polisa w Umowie Generalnej: opiekun TU domyślnie ten sam co na umowie.
		const opiekun = opiekunZUmowy(appState.policies, vals.parent_id as string | null, vals.tu_id as string | null);
		if (opiekun && !vals.tu_contact_id) vals.tu_contact_id = opiekun;
		const { error } = await sb.from('crm_policies').insert([{ tenant_id: appState.profile!.tenant_id, ...vals }]);
		saving = false;
		if (error) { formError = error.message; return; }
		showPolicy = false;
		await reloadPolicies();
	}

	async function saveEditPolicy() {
		if (!editPolicyForm || !editingPolicy) return;
		const err = editPolicyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals: Record<string, unknown> = editPolicyForm.getValues();
		// Polisa bez opiekuna TU podpinana właśnie pod Umowę Generalną: opiekun domyślnie z umowy.
		if (!editingPolicy.tu_contact_id && editingPolicy.typ_umowy !== 'generalna' && vals.parent_id && vals.parent_id !== editingPolicy.parent_id) {
			const opiekun = opiekunZUmowy(appState.policies, vals.parent_id as string | null, vals.tu_id as string | null);
			if (opiekun) vals.tu_contact_id = opiekun;
		}
		const { error } = await sb.from('crm_policies').update(vals).eq('id', editingPolicy.id);
		saving = false;
		if (error) { formError = error.message; return; }
		showEdit = false; editingPolicy = null;
		await reloadPolicies();
	}

	async function saveAnnex() {
		if (!annexingPolicy) return;
		if (!axNr.trim() || !axData) { formError = 'Podaj nr aneksu i datę.'; return; }
		saving = true; formError = '';

		const payload: Record<string, unknown> = {
			tenant_id: appState.profile!.tenant_id,
			polisa_id: annexingPolicy.id,
			nr_aneksu: axNr.trim(),
			typ: axTyp,
			data_aneksu: axData,
			opis: axOpis || null,
			delta_skladka: parseFloat(axDeltaSkladka) || 0,
			delta_prowizja: parseFloat(axDeltaProwizja) || 0,
			new_data_do: axNewDataDo || null,
			new_skladka_przypisana: axNewSkladka ? parseFloat(axNewSkladka) : null,
			new_prowizja_pct: axNewProwizjaPct ? parseFloat(axNewProwizjaPct) : null
		};

		const { error: axErr } = await sb.from('crm_policy_annexes').insert([payload]);

		// Jeśli korekta — aktualizuj dane polisy matki
		if (!axErr && axTyp === 'korekta') {
			const updates: Record<string, unknown> = {};
			if (axNewDataDo) updates.data_do = axNewDataDo;
			if (axNewSkladka) updates.skladka_przypisana = parseFloat(axNewSkladka);
			if (axNewProwizjaPct) updates.prowizja_pct = parseFloat(axNewProwizjaPct);
			if (Object.keys(updates).length) {
				await sb.from('crm_policies').update(updates).eq('id', annexingPolicy.id);
			}
		}

		saving = false;
		if (axErr) { formError = axErr.message; return; }
		showAnnex = false; annexingPolicy = null;
		resetAnnexForm();
		await reloadPolicies();
	}

	async function saveClaim() {
		if (!fclKlient || !fclData) { formError = 'Wybierz klienta i datę szkody.'; return; }
		saving = true; formError = '';
		const pol = fclPolisa ? appState.policies.find((p) => p.id === fclPolisa) : null;
		const { error } = await sb.from('crm_claims').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fclKlient, polisa_id: fclPolisa || null, tu_id: pol?.tu_id ?? null,
			nr_szkody: fclNr || null, data_szkody: fclData, opis_szkody: fclOpis || null, status: 'Zgłoszona'
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showClaim = false;
		const { data } = await wczytajSzkody();
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	function openEdit(p: Policy) {
		editingPolicy = p; formError = ''; showEdit = true;
	}

	function openAnnex(p: Policy) {
		annexingPolicy = p; formError = ''; showAnnex = true;
	}

	function resetAnnexForm() {
		axNr = ''; axTyp = 'korekta'; axData = ''; axOpis = '';
		axDeltaSkladka = '0'; axDeltaProwizja = '0';
		axNewDataDo = ''; axNewSkladka = ''; axNewProwizjaPct = '';
	}

	const ugLabel: Record<string, string> = {
		flota: 'Flota', gwarancje: 'Gwarancje', cpm: 'CPM', car_ear: 'CAR/EAR'
	};

	// Preset typ_umowy/ug_podtyp for new policy form
	let presetTyp = $state<'jednostkowa' | 'generalna'>('jednostkowa');
	let presetUgPodtyp = $state('');

	function openNewPolicy(typ: 'jednostkowa' | 'generalna' = 'jednostkowa', ugPodtyp = '') {
		presetTyp = typ;
		presetUgPodtyp = ugPodtyp;
		formError = '';
		if (typ === 'generalna') {
			goto(ugPodtyp ? `/policies/new-ug?podtyp=${ugPodtyp}` : '/policies/new-ug');
		} else {
			showPolicy = true;
		}
	}

	onMount(() => {
		const p = $page.url.searchParams;
		if (p.get('new') === '1') openNewPolicy();
		if (p.get('newguarantee') === '1') openNewPolicy('generalna', 'gwarancje');
	});

	// Tryb z adresu (?typ=generalna — menu „Umowy Generalne”, bez parametru — „Polisy”): przy każdej
	// zmianie adresu, bo przejście między tymi pozycjami menu nie tworzy strony od nowa.
	$effect(() => {
		const typ = $page.url.searchParams.get('typ');
		if (typ === 'generalna' || typ === 'jednostkowa') { filterTyp = typ; lockedTyp = true; }
		else if (untrack(() => lockedTyp)) { filterTyp = 'all'; lockedTyp = false; }
	});

	// --- Menu kontekstowe (prawy przycisk na wierszu) ---
	function openClaimFor(p: Policy) {
		fclKlient = p.klient_id;
		fclPolisa = p.id;
		fclNr = ''; fclData = ''; fclOpis = '';
		formError = '';
		showClaim = true;
	}

	// --- Usuwanie (soft delete, wymaga uzasadnienia) ---
	let deleteTarget = $state<Policy | null>(null);
	let deletionReason = $state('');
	let deleting = $state(false);
	let deleteError = $state('');

	async function softDeletePolicy() {
		if (!deleteTarget) return;
		if (!deletionReason.trim()) { deleteError = 'Podaj uzasadnienie usunięcia.'; return; }
		deleting = true; deleteError = '';
		const target = deleteTarget;
		const { error } = await sb.from('crm_policies')
			.update({ deleted_at: new Date().toISOString(), deletion_reason: deletionReason.trim() })
			.eq('id', target.id);
		deleting = false;
		if (error) { deleteError = error.message; return; }
		await logAudit('policy_deleted', 'policy', target.id, target.nr_polisy, { reason: deletionReason.trim() });
		appState.policies = appState.policies.filter((p) => p.id !== target.id);
		deleteTarget = null;
		ctxToast(`Polisa ${target.nr_polisy} przeniesiona do kosza`);
	}

	function policyMenu(p: Policy): CtxItem[] {
		const isUG = p.typ_umowy === 'generalna';
		return [
			{ label: 'Otwórz polisę', icon: Eye, onSelect: () => goto(`/policies/${p.id}`) },
			{
				label: 'Otwórz w nowej karcie',
				icon: ExternalLink,
				onSelect: () => window.open(`/policies/${p.id}`, '_blank', 'noopener')
			},
			{ separator: true },
			{ label: 'Edytuj', icon: Pencil, onSelect: () => goto(`/policies/${p.id}/edit`) },
			{ label: 'Dodaj aneks', icon: FilePlus2, onSelect: () => openAnnex(p) },
			...(isUG
				? [{
						label: 'Dodaj polisę pod tę UG',
						icon: Plus,
						onSelect: () => goto(`/policies/new?parent_id=${p.id}`)
					} as CtxItem]
				: []),
			{ label: 'Zgłoś szkodę', icon: AlertTriangle, onSelect: () => openClaimFor(p) },
			{ separator: true },
			{
				label: 'Karta klienta',
				icon: User,
				disabled: !p.klient_id,
				onSelect: () => goto(`/clients/${p.klient_id}`)
			},
			{
				label: 'Kopiuj nr polisy',
				icon: Copy,
				onSelect: () => ctxCopy(p.nr_polisy, 'nr polisy')
			},
			{ separator: true },
			{
				label: 'Przenieś do kosza',
				icon: Trash2,
				danger: true,
				onSelect: () => { deleteTarget = p; deletionReason = ''; deleteError = ''; }
			}
		];
	}

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>{lockedTyp && filterTyp === 'generalna' ? 'Umowy generalne' : 'Polisy'} — AuraCRM</title></svelte:head>
<svelte:window onclick={() => (nowaMenu = false)} />

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">{trybUg ? 'Umowy generalne' : 'Polisy'} <span class="font-normal text-ink-3 tabular-nums">{bazowe.length.toLocaleString('pl-PL')}</span></h1>
		<p class="text-sm text-ink-3 mt-0.5">{trybUg ? 'Rejestr umów generalnych i polis podpiętych pod nie' : 'Rejestr ubezpieczeń całego portfela — terminy, składki i prowizje'}</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button onclick={() => { showClaim = true; formError = ''; }} class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">
			<AlertTriangle size={16} class="text-ink-3" /> Zgłoś szkodę
		</button>
		{#if trybUg}
			<button onclick={() => goto('/policies/new-ug')} class="h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
				<Plus size={16} /> Nowa umowa generalna
			</button>
		{:else}
			<a href="/policies/import" class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">
				<Upload size={16} class="text-ink-3" /> Import z PDF
			</a>
			<div class="relative">
				<button
					onclick={(e) => { e.stopPropagation(); nowaMenu = !nowaMenu; }}
					aria-expanded={nowaMenu}
					aria-haspopup="menu"
					class="h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors"
				>
					<Plus size={16} /> Nowa polisa <ChevronDown size={14} />
				</button>
				{#if nowaMenu}
					<div role="menu" class="absolute right-0 top-full mt-1 w-64 bg-white border border-line rounded-xl shadow-xl z-50 py-1">
						<button role="menuitem" onclick={() => goto('/policies/new')} class="w-full flex items-start gap-3 text-left px-4 py-2.5 hover:bg-surface-2">
							<FileText size={16} class="text-ink-3 mt-0.5" />
							<span><span class="block text-sm font-medium text-ink">Polisa</span><span class="block text-xs text-ink-3">jednostkowa albo pod umowę generalną</span></span>
						</button>
						<button role="menuitem" onclick={() => goto('/policies/new-ug')} class="w-full flex items-start gap-3 text-left px-4 py-2.5 hover:bg-surface-2">
							<FileStack size={16} class="text-ink-3 mt-0.5" />
							<span><span class="block text-sm font-medium text-ink">Umowa generalna</span><span class="block text-xs text-ink-3">flota, gwarancje, CPM, CAR/EAR</span></span>
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Segmenty -->
<div role="tablist" aria-label="Segmenty polis" class="flex gap-x-5 border-b border-line mb-3 overflow-x-auto">
	{#each SEGMENTY as [id, label]}
		<button
			role="tab"
			aria-selected={segment === id}
			onclick={() => (segment = id)}
			class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
				{segment === id ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
		>
			{label}
			{#if id === 'zalegle' && liczSeg[id] > 0}
				<span class="ml-0.5 px-1.5 rounded-full bg-danger-soft text-danger text-xs font-semibold leading-5 tabular-nums">{liczSeg[id]}</span>
			{:else}
				<span class="font-normal text-ink-3 tabular-nums">{liczSeg[id].toLocaleString('pl-PL')}</span>
			{/if}
		</button>
	{/each}
</div>

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<label class="w-full sm:w-auto sm:flex-[1_1_280px] sm:max-w-[420px] h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
		<Search size={16} class="text-ink-3 shrink-0" />
		<span class="sr-only">Filtruj listę</span>
		<input bind:value={search} placeholder="Nr polisy, klient, przedmiot, nr UG…" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
		{#if search}
			<button onclick={() => (search = '')} aria-label="Wyczyść wyszukiwanie" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={14} /></button>
		{/if}
	</label>
	{#snippet filtr(etykieta: string, tekst: string | null, wyczysc: () => void, opcje: Snippet, wartosc: string, ustaw: (v: string) => void)}
		<!-- Widoczna etykieta + niewidoczny natywny select na wierzchu: szerokość wybranej wartości, nie najdłuższej opcji. -->
		<span class="relative inline-flex items-center h-9 rounded-lg text-[13px] font-medium focus-within:ring-2 focus-within:ring-accent/40 {tekst ? 'border border-line bg-white text-ink pr-7' : 'border border-dashed border-[#C4CAD4] text-ink-2 hover:bg-white'}">
			<span aria-hidden="true" class="px-2.5 max-w-[240px] truncate whitespace-nowrap">{tekst ?? `+ ${etykieta}`}</span>
			<select aria-label={etykieta} value={wartosc} onchange={(e) => ustaw((e.currentTarget as HTMLSelectElement).value)} class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
				{@render opcje()}
			</select>
			{#if tekst}
				<button onclick={wyczysc} aria-label="Usuń filtr: {etykieta}" class="absolute right-1 z-10 w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={12} /></button>
			{/if}
		</span>
	{/snippet}
	{#snippet opcjeTyp()}
		<option value="">Dowolny typ umowy</option>
		<option value="jednostkowa">polisy jednostkowe</option>
		<option value="generalna">umowy generalne</option>
		<option value="w_ug">polisy w umowach generalnych</option>
	{/snippet}
	{#snippet opcjeTu()}
		<option value="">Dowolne towarzystwo</option>
		{#each towarzystwa as t}<option value={t.id}>{t.skrot || t.nazwa}</option>{/each}
	{/snippet}
	{#snippet opcjeRodzaj()}
		<option value="">Dowolny rodzaj</option>
		{#each rodzaje as r}<option value={r}>{nazwaRodzaju(r)}</option>{/each}
	{/snippet}
	{#snippet opcjeOpiekun()}
		<option value="">Dowolny opiekun klienta</option>
		{#each opiekunowie as b}<option value={b.id}>{b.imie_nazwisko || b.email}{b.id === appState.profile?.id ? ' (ja)' : ''}</option>{/each}
		<option value="-">Klient bez opiekuna</option>
	{/snippet}
	{#if !lockedTyp}
		{@render filtr('Typ umowy', fTypUmowy ? ({ jednostkowa: 'Polisy jednostkowe', generalna: 'Umowy generalne', w_ug: 'Polisy w UG' } as const)[fTypUmowy] : null, () => (fTypUmowy = ''), opcjeTyp, fTypUmowy, (v) => (fTypUmowy = v as typeof fTypUmowy))}
	{/if}
	{@render filtr('Towarzystwo', fTu ? `TU: ${towarzystwa.find(t => t.id === fTu)?.skrot || towarzystwa.find(t => t.id === fTu)?.nazwa || '—'}` : null, () => (fTu = ''), opcjeTu, fTu, (v) => (fTu = v))}
	{@render filtr('Rodzaj', fRodzaj ? `Rodzaj: ${nazwaRodzaju(fRodzaj)}` : null, () => (fRodzaj = ''), opcjeRodzaj, fRodzaj, (v) => (fRodzaj = v))}
	{@render filtr('Opiekun', fOpiekun ? (fOpiekun === '-' ? 'Klient bez opiekuna' : `Opiekun: ${opiekunWg.get(fOpiekun) ?? '—'}`) : null, () => (fOpiekun = ''), opcjeOpiekun, fOpiekun, (v) => (fOpiekun = v))}
	{#if ileFiltrow > 0}
		<button onclick={wyczyscFiltry} class="h-9 px-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść</button>
	{/if}
</div>

<section aria-label="Lista polis" class="bg-white border border-line rounded-xl overflow-hidden">
	{#if selected.size > 0}
		<div class="flex flex-wrap items-center gap-2 px-4 py-2 bg-accent-soft text-accent-text text-[13px]">
			<span class="font-semibold mr-1">{odmiana(selected.size, 'polisa zaznaczona', 'polisy zaznaczone', 'polis zaznaczonych')}</span>
			<button onclick={eksportujCsv} class="h-7 flex items-center gap-1.5 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50"><Download size={14} /> Eksportuj CSV</button>
			<button onclick={() => (selected = new Set())} class="ml-auto h-7 px-2 font-semibold hover:underline">Odznacz</button>
		</div>
	{/if}

	{#if wiersze.length === 0}
		<div class="px-4 py-12 text-center">
			<p class="text-sm text-ink-3">Brak polis dla wybranych filtrów.</p>
			{#if ileFiltrow > 0 || search}
				<button onclick={wyczyscFiltry} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść filtry</button>
			{/if}
		</div>
	{:else}
		<!-- Telefon: karty -->
		<ul class="md:hidden divide-y divide-line-soft">
			{#each naStronie as p (p.id)}
				{@const st = status(p)}
				<li use:ctxMenu={{ items: () => policyMenu(p), title: p.nr_polisy }} class="flex items-start gap-3 px-4 py-3 {selected.has(p.id) ? 'bg-blue-50' : ''}">
					<input type="checkbox" checked={selected.has(p.id)} onchange={() => toggleSelect(p.id)} aria-label="Zaznacz polisę {p.nr_polisy}" class="mt-1 w-4 h-4 accent-accent shrink-0" />
					<a href="/policies/{p.id}" class="flex-1 min-w-0">
						<span class="flex items-start justify-between gap-2">
							<span class="font-mono text-xs font-medium text-accent-text truncate pt-0.5">{p.nr_polisy}</span>
							<span class="shrink-0 h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {st.cls}">{st.tekst}</span>
						</span>
						<span class="block font-medium text-ink truncate">{p.crm_clients?.nazwa ?? '—'}</span>
						<span class="block text-xs text-ink-3">{p.typ_umowy === 'generalna' ? `UG ${ugLabel[p.ug_podtyp ?? ''] ?? p.ug_podtyp ?? ''}` : nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)}</span>
						<span class="block mt-1 text-[13px] text-ink-2 tabular-nums">do {fmtDzien(p.data_do, true)} · {fmtPln(p.skladka_przypisana)} zł</span>
					</a>
				</li>
			{/each}
		</ul>

		<!-- Komputer: tabela -->
		<div class="hidden md:block overflow-x-auto">
			<table class="w-full min-w-[1000px] text-[13px] text-left">
				<thead>
					<tr class="bg-surface-2 text-ink-2">
						<th class="w-11 pl-4 py-2.5">
							<input type="checkbox" checked={wszystkieNaStronie} onchange={toggleStrona} aria-label="Zaznacz wszystkie polisy na stronie" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
						</th>
						<SortTh s={sort} k="nr" wersaliki={false} class="px-3 py-2.5 font-semibold">Polisa</SortTh>
						<SortTh s={sort} k="klient" wersaliki={false} class="px-3 py-2.5 font-semibold">Klient</SortTh>
						<SortTh s={sort} k="tu" wersaliki={false} class="px-3 py-2.5 font-semibold">TU</SortTh>
						<SortTh s={sort} k="rodzaj" wersaliki={false} class="px-3 py-2.5 font-semibold">Rodzaj</SortTh>
						<SortTh s={sort} k="do" wersaliki={false} class="px-3 py-2.5 font-semibold whitespace-nowrap">Koniec ochrony</SortTh>
						<SortTh s={sort} k="skladka" wersaliki={false} align="right" class="px-3 py-2.5 font-semibold text-right">Składka</SortTh>
						<SortTh s={sort} k="prowizja" wersaliki={false} align="right" class="hidden min-[1600px]:table-cell px-3 py-2.5 font-semibold text-right">Prowizja</SortTh>
						<SortTh s={sort} k="status" wersaliki={false} class="px-3 py-2.5 font-semibold">Status</SortTh>
						<th class="px-3 py-2.5"><span class="sr-only">Akcje</span></th>
					</tr>
				</thead>
				<tbody>
					{#each naStronie as p (p.id)}
						{@const st = status(p)}
						{@const isUG = p.typ_umowy === 'generalna'}
						{@const nAx = liczbaAneksow.get(p.id) ?? 0}
						{@const checked = selected.has(p.id)}
						<tr use:ctxMenu={{ items: () => policyMenu(p), title: p.nr_polisy }} class="border-t border-line-soft {checked ? 'bg-blue-50' : 'hover:bg-bg'}">
							<td class="pl-4 py-2">
								<input type="checkbox" {checked} onchange={() => toggleSelect(p.id)} aria-label="Zaznacz polisę {p.nr_polisy}" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
							</td>
							<td class="px-3 py-2 whitespace-nowrap">
								<a href="/policies/{p.id}" class="font-mono text-xs font-medium text-accent-text hover:underline">{p.nr_polisy}</a>
								<span class="block text-xs text-ink-3">
									{#if p.parent_id}
										w UG <a href="/policies/{p.parent_id}" class="font-mono hover:text-accent-text hover:underline">{parentNr(p.parent_id)}</a>
									{:else if isUG}
										{odmiana(liczbaWUg.get(p.id) ?? 0, 'polisa', 'polisy', 'polis')} w umowie
									{/if}
									{#if nAx > 0}{p.parent_id || isUG ? ' · ' : ''}{odmiana(nAx, 'aneks', 'aneksy', 'aneksów')}{/if}
								</span>
							</td>
							<td class="px-3 py-2 min-w-[160px] max-w-[240px]">
								<a href="/clients/{p.klient_id}" class="block truncate font-medium text-ink hover:text-accent-text">{p.crm_clients?.nazwa ?? '—'}</a>
								{#if p.przedmiot}<span class="block truncate text-xs text-ink-3" title={p.przedmiot}>{p.przedmiot}</span>{/if}
							</td>
							<td class="px-3 py-2 whitespace-nowrap" title={p.crm_insurers?.nazwa ?? undefined}>{nazwaTu(p)}</td>
							<td class="px-3 py-2">
								{#if isUG}
									<span class="inline-flex items-center px-2 rounded-full text-xs font-semibold leading-5 whitespace-nowrap {ugPodtypCls(p.ug_podtyp ?? '')}">UG: {ugLabel[p.ug_podtyp ?? ''] ?? p.ug_podtyp}</span>
								{:else}
									{nazwaRodzaju(p.rodzaj)}
								{/if}
							</td>
							<td class="px-3 py-2 whitespace-nowrap">
								<span class="block tabular-nums">{p.data_do ? fmtDzien(p.data_do, true) : 'bezterminowo'}</span>
								{#if p.data_do && st.klucz !== 'zakonczona' && st.klucz !== 'wznowiona' && dateDiffDays(dzis, p.data_do) <= 45}
									<span class="block text-xs {dateDiffDays(dzis, p.data_do) <= 14 ? 'text-warn font-semibold' : 'text-ink-2'}">{fmtTermin(p.data_do, dzis)}</span>
								{:else}
									<span class="block text-xs text-ink-3">od {fmtDzien(p.data_od, true)}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(p.skladka_przypisana)} zł</td>
							<td class="hidden min-[1600px]:table-cell px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-2">{fmtPln(p.prowizja_przypisana)} zł</td>
							<td class="px-3 py-2">
								<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {st.cls}">{st.tekst}</span>
							</td>
							<td class="px-3 py-1.5 text-right whitespace-nowrap">
								<a href="/policies/{p.id}/edit" title="Edytuj" aria-label="Edytuj polisę {p.nr_polisy}" class="inline-flex w-8 h-8 items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Pencil size={14} /></a>
								<button onclick={() => openAnnex(p)} title="Dodaj aneks" aria-label="Dodaj aneks do polisy {p.nr_polisy}" class="inline-flex w-8 h-8 items-center justify-center rounded-lg text-ink-3 hover:text-accent-text hover:bg-accent-soft"><FilePlus2 size={14} /></button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-line-soft text-[13px] text-ink-2">
		<span class="w-full sm:w-auto sm:flex-1 min-w-0 tabular-nums">
			{odmiana(widoczne.length, 'polisa', 'polisy', 'polis')} · składka <span class="font-semibold text-ink">{fmtPln(sumy.skladka)} zł</span> · prowizja <span class="font-semibold text-ink">{fmtPln(sumy.prowizja)} zł</span>
		</span>
		<span class="tabular-nums">{zakres}</span>
		<span class="flex gap-1">
			<button onclick={() => (strona = Math.max(0, strona - 1))} disabled={strona === 0} aria-label="Poprzednia strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronLeft size={14} /></button>
			<button onclick={() => (strona = Math.min(stron - 1, strona + 1))} disabled={strona >= stron - 1} aria-label="Następna strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronRight size={14} /></button>
		</span>
	</div>
</section>

<!-- Modal: Nowa Polisa -->
<Modal title="Nowa Polisa" open={showPolicy} onclose={() => { showPolicy = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showPolicy = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveNewPolicy} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={newPolicyForm} policy={{ typ_umowy: presetTyp, ug_podtyp: presetUgPodtyp } as any} />
</Modal>

<!-- Modal: Edytuj Polisę -->
{#if editingPolicy}
<Modal title="Edytuj Polisę — {editingPolicy.nr_polisy}" open={showEdit} onclose={() => { showEdit = false; editingPolicy = null; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showEdit = false; editingPolicy = null; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEditPolicy} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={editPolicyForm} policy={editingPolicy} />
</Modal>
{/if}

<!-- Modal: Aneks -->
{#if annexingPolicy}
<Modal title="Aneks do polisy {annexingPolicy.nr_polisy}" open={showAnnex} onclose={() => { showAnnex = false; annexingPolicy = null; resetAnnexForm(); formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showAnnex = false; annexingPolicy = null; resetAnnexForm(); formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveAnnex} disabled={saving} class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Aneks'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nr Aneksu *</label>
				<input bind:value={axNr} class={inputCls} placeholder="np. 01, A-2025" />
			</div>
			<div>
				<label class={labelCls}>Data aneksu *</label>
				<input type="date" bind:value={axData} class={inputCls} />
			</div>
		</div>
		<div>
			<label class={labelCls}>Typ aneksu</label>
			<div class="grid grid-cols-2 gap-2">
				{#each [['korekta','Korekta danych / warunków'],['doubezpieczenie','Doubezpieczenie (mid-term)'],['zmiana_zakresu','Zmiana zakresu'],['inne','Inne']] as [val, label]}
					<button
						type="button"
						onclick={() => axTyp = val as typeof axTyp}
						class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
							{axTyp === val ? 'bg-blue-50 text-blue-700 border-blue-400' : 'bg-white text-slate-600 border-line hover:bg-slate-50'}"
					>{label}</button>
				{/each}
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zmiany</label>
			<input bind:value={axOpis} class={inputCls} placeholder="Krótki opis..." />
		</div>
		<hr class="border-line" />
		<p class="text-xs font-semibold text-blue-600 uppercase tracking-wide">Wartości po zmianie (zostaw puste = bez zmiany)</p>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nowa Data Do</label>
				<input type="date" bind:value={axNewDataDo} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Nowa Składka Przypisana</label>
				<input type="number" step="0.01" bind:value={axNewSkladka} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Delta Składki (+/-)</label>
				<input type="number" step="0.01" bind:value={axDeltaSkladka} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Nowy % Prowizji</label>
				<input type="number" step="0.01" bind:value={axNewProwizjaPct} class={inputCls} />
			</div>
		</div>
		{#if axTyp === 'korekta'}
			<p class="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
				Aneks <strong>Korekta</strong> automatycznie zaktualizuje dane polisy matki po zapisaniu.
			</p>
		{/if}
	</div>
</Modal>
{/if}

<!-- Modal: Szkoda -->
<Modal title="Rejestracja Szkody" open={showClaim} onclose={() => { showClaim = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showClaim = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveClaim} disabled={saving} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zgłoś Szkodę'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient *</label>
				<select bind:value={fclKlient} class={inputCls}>
					<option value="">— wybierz klienta —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Z polisy</label>
				<select bind:value={fclPolisa} class={inputCls}>
					<option value="">— opcjonalnie —</option>
					{#each appState.policies as p}<option value={p.id}>{p.nr_polisy}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Nr Szkody w TU</label>
				<input bind:value={fclNr} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Data szkody *</label>
				<input type="date" bind:value={fclData} class={inputCls} />
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zdarzenia</label>
			<input bind:value={fclOpis} placeholder="Krótki opis..." class={inputCls} />
		</div>
	</div>
</Modal>

<!-- Modal: Usuń polisę (z menu kontekstowego) -->
{#if deleteTarget}
<Modal title="Usuń polisę — {deleteTarget.nr_polisy}" open={!!deleteTarget} onclose={() => deleteTarget = null}>
	{#snippet footer()}
		<button onclick={() => deleteTarget = null} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={softDeletePolicy} disabled={deleting} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{deleting ? 'Usuwanie...' : 'Przenieś do kosza'}
		</button>
	{/snippet}
	{#if deleteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</div>{/if}
	<p class="text-sm text-slate-500 mb-3">Polisa trafi do Kosza — można ją przywrócić.</p>
	<label class={labelCls}>Uzasadnienie *</label>
	<input bind:value={deletionReason} placeholder="Powód usunięcia..." class={inputCls} />
</Modal>
{/if}
