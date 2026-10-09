<script lang="ts">
	import { wczytajFormularzeApk, wczytajKlientow, wczytajKontakty, wczytajPojazdy, wczytajPolisy, wczytajSzkody, wczytajZadania } from '$lib/kolekcje';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import type { Snippet } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import { Search, Pencil, Building2, User, Eye, ExternalLink, FileText, Copy, Mail, Phone, ChevronDown, ChevronLeft, ChevronRight, X, Download } from 'lucide-svelte';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import RegonLookup from '$lib/components/RegonLookup.svelte';
	import { page } from '$app/stores';
	import { logAudit } from '$lib/utils/audit';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import { dateDiffDays, fmtDzien, fmtPln, fmtTermin, inicjaly, miastoZAdresu, odmiana, todayStr } from '$lib/utils';

	function clientMenu(c: Client): CtxItem[] {
		return [
			{ label: 'Profil 360°', icon: Eye, onSelect: () => goto(`/clients/${c.id}`) },
			{
				label: 'Otwórz w nowej karcie',
				icon: ExternalLink,
				onSelect: () => window.open(`/clients/${c.id}`, '_blank', 'noopener')
			},
			{ label: 'Edytuj dane', icon: Pencil, onSelect: () => goto(`/clients/${c.id}/edit`) },
			{ separator: true },
			{
				label: 'Nowa polisa dla klienta',
				icon: FileText,
				onSelect: () => goto(`/policies/new?klient=${c.id}`)
			},
			{ separator: true },
			{
				label: 'Napisz e-mail',
				icon: Mail,
				disabled: !c.email,
				onSelect: () => window.open(`mailto:${c.email}`, '_self')
			},
			{
				label: 'Zadzwoń',
				icon: Phone,
				disabled: !c.telefon,
				onSelect: () => window.open(`tel:${c.telefon}`, '_self')
			},
			{ separator: true },
			{ label: 'Kopiuj nazwę', icon: Copy, onSelect: () => ctxCopy(c.nazwa, 'nazwę') },
			{
				label: c.typ === 'osoba' ? 'Kopiuj PESEL' : 'Kopiuj NIP',
				icon: Copy,
				disabled: !(c.typ === 'osoba' ? c.pesel : c.nip),
				onSelect: () => ctxCopy(c.typ === 'osoba' ? c.pesel : c.nip, c.typ === 'osoba' ? 'PESEL' : 'NIP')
			},
			{ label: 'Kopiuj e-mail', icon: Copy, disabled: !c.email, onSelect: () => ctxCopy(c.email, 'e-mail') },
			{ label: 'Kopiuj telefon', icon: Copy, disabled: !c.telefon, onSelect: () => ctxCopy(c.telefon, 'telefon') }
		];
	}

	let search = $state('');
	let kompakt = $state(false);
	try { kompakt = localStorage.getItem('crm-klienci-gestosc') === 'kompakt'; } catch { /* noop */ }
	function ustawGestosc(k: boolean) {
		kompakt = k;
		try { localStorage.setItem('crm-klienci-gestosc', k ? 'kompakt' : 'komfort'); } catch { /* noop */ }
	}
	let nowyMenu = $state(false);
	let showModal = $state(false);
	let modalTyp = $state<'firma' | 'osoba'>('firma');

	let fNazwa = $state('');
	let fNazwaSkrocona = $state('');
	let fUlica = $state('');
	let fNip = $state('');
	let fRegon = $state('');
	let fKrs = $state('');
	let fPesel = $state('');
	let fEmail = $state('');
	let fTelefon = $state('');
	let fGwarancje = $state(false);
	let saving = $state(false);
	let formError = $state('');

	// Duplicate detection
	let showDuplicates = $state(false);
	type DupGroup = { reason: string; clients: typeof appState.clients };
	const duplicateGroups = $derived((): DupGroup[] => {
		const groups: DupGroup[] = [];
		const nipMap = new Map<string, typeof appState.clients>();
		const peselMap = new Map<string, typeof appState.clients>();
		for (const c of appState.clients) {
			if (c.nip) {
				const norm = c.nip.replace(/\s/g, '');
				const arr = nipMap.get(norm) ?? [];
				arr.push(c);
				nipMap.set(norm, arr);
			}
			if (c.pesel) {
				const arr = peselMap.get(c.pesel) ?? [];
				arr.push(c);
				peselMap.set(c.pesel, arr);
			}
		}
		for (const [nip, cs] of nipMap) if (cs.length > 1) groups.push({ reason: `Duplikat NIP: ${nip}`, clients: cs });
		for (const [pesel, cs] of peselMap) if (cs.length > 1) groups.push({ reason: `Duplikat PESEL: ${pesel}`, clients: cs });
		return groups;
	});

	// Klucz grupy = powód + dokładny zestaw ID klientów. Dzięki temu odrzucenie
	// grupy jako "nie duplikat" chowa ją trwale, ale jeśli do tego samego
	// NIP/PESEL dołączy NOWY klient, zestaw ID się zmieni i grupa wróci jako nowa.
	function dedupeKey(group: DupGroup): string {
		const ids = group.clients.map(c => c.id).sort().join(',');
		return `${group.reason}::${ids}`;
	}

	let dismissedKeys = $state<Set<string>>(new Set());
	const visibleDuplicateGroups = $derived(duplicateGroups().filter(g => !dismissedKeys.has(dedupeKey(g))));

	async function loadDismissedDuplicates() {
		const { data } = await sb.from('crm_dismissed_duplicates').select('dedupe_key');
		dismissedKeys = new Set((data ?? []).map(r => r.dedupe_key as string));
	}
	loadDismissedDuplicates();

	let dismissing = $state<string | null>(null);
	async function dismissGroup(group: DupGroup) {
		const key = dedupeKey(group);
		dismissing = key;
		const { error } = await sb.from('crm_dismissed_duplicates').insert({
			tenant_id: appState.profile!.tenant_id,
			dedupe_key: key,
			dismissed_by: appState.profile!.id
		});
		if (!error) dismissedKeys = new Set([...dismissedKeys, key]);
		dismissing = null;
	}

	// Merge / delete duplicates
	const KLIENT_ID_TABLES = ['crm_client_contacts', 'crm_policies', 'crm_claims', 'crm_vehicles', 'apk_forms', 'crm_tasks', 'crm_task_history'];
	let mergeTarget = $state<Record<string, string>>({});
	let mergeError = $state<Record<string, string>>({});
	let merging = $state<string | null>(null);

	function policyCount(clientId: string) {
		return appState.policies.filter(p => p.klient_id === clientId && !p.deleted_at).length;
	}
	function apkCount(clientId: string) {
		return appState.apkForms.filter(f => f.klient_id === clientId && f.status === 'submitted').length;
	}
	function mustKeep(clientId: string) {
		return policyCount(clientId) > 0 || apkCount(clientId) > 0;
	}

	async function mergeGroup(group: DupGroup) {
		const targetId = mergeTarget[group.reason];
		if (!targetId) { mergeError[group.reason] = 'Wybierz rekord, który ma zostać zachowany.'; return; }
		const others = group.clients.filter(c => c.id !== targetId);
		const blocked = others.find(c => mustKeep(c.id));
		if (blocked) {
			mergeError[group.reason] = `Rekord "${blocked.nazwa_skrocona ?? blocked.nazwa}" ma przypisaną polisę lub złożone APK i musi zostać zachowany w bazie — wybierz go jako rekord docelowy.`;
			return;
		}
		merging = group.reason;
		mergeError[group.reason] = '';
		const otherIds = others.map(c => c.id);

		// Wnioski o odnowienie i historia e-maili należą do klienta (usunięcie kasuje je razem z nim),
		// a pracownik nie może ich przepiąć — rekord z nimi musi zostać jako docelowy.
		const [{ count: nWnioskow }, { count: nEmaili }] = await Promise.all([
			sb.from('crm_renewals').select('id', { count: 'exact', head: true }).in('klient_id', otherIds),
			sb.from('crm_client_emails').select('id', { count: 'exact', head: true }).in('klient_id', otherIds)
		]);
		if ((nWnioskow ?? 0) > 0 || (nEmaili ?? 0) > 0) {
			mergeError[group.reason] = 'Usuwany rekord ma wnioski o odnowienie albo historię e-maili — wybierz go jako rekord docelowy.';
			merging = null;
			return;
		}

		// Identyfikator firmy z BEAUTY przechodzi na zachowany rekord, gdy ten go nie ma — inaczej
		// synchronizacja nie znajdzie odpowiednika usuniętego duplikatu. Stan z bazy, bo lista mogła
		// się zestarzeć (synchronizacja działa w tle).
		const { data: bidRows } = await sb.from('crm_clients').select('id, beauty_id').in('id', [targetId, ...otherIds]);
		const bidZ = (id: string) => {
			const row = (bidRows as { id: string; beauty_id: number | string | null }[] | null)?.find(r => r.id === id);
			return row ? row.beauty_id : group.clients.find(c => c.id === id)?.beauty_id ?? null;
		};
		const beautyId = bidZ(targetId) == null
			? otherIds.map(bidZ).find(b => b != null) ?? null
			: null;

		for (const table of KLIENT_ID_TABLES) {
			await sb.from(table).update({ klient_id: targetId }).in('klient_id', otherIds);
		}
		// crm_policies.ubezpieczony_id (drugi ubezpieczony) też wskazuje na klienta —
		// jeśli go nie przepniemy, usunięcie duplikatu poniżej padnie na FK i wróci przy odświeżeniu.
		await sb.from('crm_policies').update({ ubezpieczony_id: targetId }).in('ubezpieczony_id', otherIds);
		const { error: delError } = await sb.from('crm_clients').delete().in('id', otherIds);
		if (delError) {
			mergeError[group.reason] = `Nie udało się usunąć duplikatów: ${delError.message}`;
			merging = null;
			return;
		}
		// Dopiero po usunięciu duplikatów: (beauty_id, tenant_id) jest unikalne.
		let beautyPrzeniesiony = false;
		if (beautyId != null) {
			const { error: bidError } = await sb.from('crm_clients').update({ beauty_id: beautyId } as never).eq('id', targetId);
			if (bidError) {
				// Grupa po scaleniu znika z listy, więc komunikat przy niej nie byłby widoczny.
				alert(`Duplikaty scalone, ale nie udało się przenieść identyfikatora BEAUTY (${beautyId}): ${bidError.message}\nSynchronizacja może odtworzyć usunięty rekord — zgłoś to administratorowi.`);
			} else beautyPrzeniesiony = true;
		}
		await logAudit('clients_merged', 'client', targetId, group.reason, {
			merged_ids: otherIds,
			...(beautyId != null ? (beautyPrzeniesiony ? { beauty_id: beautyId } : { beauty_id_blad: beautyId }) : {})
		});

		const [rC, rP, rCl, rV, rA, rT, rCc] = await Promise.all([
			wczytajKlientow(),
			wczytajPolisy(),
			wczytajSzkody(),
			wczytajPojazdy(),
			wczytajFormularzeApk(),
			wczytajZadania(),
			wczytajKontakty()
		]);
		// Lista z bazy ma już beauty_id zachowanego rekordu; gdy odczyt zawiedzie, poprawiamy ją lokalnie.
		appState.clients = !rC.error && rC.data
			? rC.data as typeof appState.clients
			: appState.clients
				.filter(c => !otherIds.includes(c.id))
				.map(c => (beautyPrzeniesiony && c.id === targetId ? { ...c, beauty_id: beautyId } : c));
		if (!rP.error && rP.data) appState.policies = rP.data as typeof appState.policies;
		appState.claims = (rCl.data ?? []) as typeof appState.claims;
		appState.vehicles = (rV.data ?? []) as typeof appState.vehicles;
		appState.apkForms = (rA.data ?? []) as typeof appState.apkForms;
		appState.tasks = (rT.data ?? []) as typeof appState.tasks;
		appState.clientContacts = (rCc.data ?? []) as typeof appState.clientContacts;

		merging = null;
	}

	// ── Portfel klienta: aktywne polisy (ubezpieczający), składka, najbliższe odnowienie ──
	const dzis = todayStr();
	type Portfel = { polisy: number; skladka: number; odnowienie: string | null; tu: Set<string>; rodzaje: Set<string> };
	const portfele = $derived.by(() => {
		const m = new Map<string, Portfel>();
		for (const p of appState.policies) {
			if (p.deleted_at || (p.data_do !== null && p.data_do < dzis)) continue;
			let w = m.get(p.klient_id);
			if (!w) { w = { polisy: 0, skladka: 0, odnowienie: null, tu: new Set(), rodzaje: new Set() }; m.set(p.klient_id, w); }
			w.polisy++;
			w.skladka += Number(p.skladka_przypisana ?? 0);
			if (p.data_do && (!w.odnowienie || p.data_do < w.odnowienie)) w.odnowienie = p.data_do;
			if (p.tu_id) w.tu.add(p.tu_id);
			if (p.rodzaj) w.rodzaje.add(p.rodzaj);
		}
		return m;
	});

	type Wiersz = { c: Client; p: Portfel | undefined; opiekun: string | null };
	const opiekunWg = $derived(new Map(appState.brokers.map(b => [b.id, b.imie_nazwisko || b.email])));
	const wiersze = $derived<Wiersz[]>(appState.clients.map(c => ({
		c,
		p: portfele.get(c.id),
		opiekun: c.opiekun_id ? (opiekunWg.get(c.opiekun_id) ?? null) : null
	})));

	// Segmenty (zakładki nad listą)
	type Segment = 'wszyscy' | 'portfel' | 'bez' | 'rodo';
	let segment = $state<Segment>('wszyscy');
	const wSegmencie = (w: Wiersz, s: Segment) =>
		s === 'wszyscy' || (s === 'portfel' ? !!w.p : s === 'bez' ? !w.p : !w.c.rodo_zgoda);
	const liczSeg = $derived({
		wszyscy: wiersze.length,
		portfel: wiersze.filter(w => w.p).length,
		bez: wiersze.filter(w => !w.p).length,
		rodo: wiersze.filter(w => !w.c.rodo_zgoda).length
	});
	const SEGMENTY: [Segment, string][] = [['wszyscy', 'Wszyscy'], ['portfel', 'Z polisami'], ['bez', 'Bez polis'], ['rodo', 'Bez zgody RODO']];
	const podpowiedz = $derived.by(() => {
		if (segment === 'wszyscy') return 'Cała kartoteka, także firmy z importu BEAUTY bez polis. Prawy przycisk myszy na kliencie: więcej akcji.';
		if (segment === 'portfel') return 'Klienci z co najmniej jedną aktywną polisą (jako ubezpieczający).';
		if (segment === 'bez') {
			const proc = liczSeg.wszyscy ? Math.round((liczSeg.bez / liczSeg.wszyscy) * 100) : 0;
			const beauty = wiersze.filter(w => !w.p && w.c.beauty_id != null).length;
			return `${proc}% kartoteki${beauty ? `, w tym ${odmiana(beauty, 'firma', 'firmy', 'firm')} z importu BEAUTY` : ''} — kandydaci do kampanii lub przeniesienia do Leadów.`;
		}
		return 'Klienci bez zarejestrowanej zgody RODO — zgodę zapiszesz w edycji danych klienta.';
	});

	// Filtry
	let fOpiekun = $state('');
	let fTu = $state('');
	let fRodzaj = $state('');
	let fZrodlo = $state<'' | 'beauty' | 'crm'>('');
	const towarzystwa = $derived(
		[...appState.insurers].filter(i => [...portfele.values()].some(p => p.tu.has(i.id)))
			.sort((a, b) => (a.skrot || a.nazwa).localeCompare(b.skrot || b.nazwa, 'pl'))
	);
	const rodzaje = $derived([...new Set([...portfele.values()].flatMap(p => [...p.rodzaje]))].sort((a, b) => a.localeCompare(b, 'pl')));
	const opiekunowie = $derived([...appState.brokers].sort((a, b) => (a.imie_nazwisko || a.email).localeCompare(b.imie_nazwisko || b.email, 'pl')));
	const ileFiltrow = $derived([fOpiekun, fTu, fRodzaj, fZrodlo].filter(Boolean).length);
	function wyczyscFiltry() { fOpiekun = ''; fTu = ''; fRodzaj = ''; fZrodlo = ''; search = ''; }

	const cyfry = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const qCyfry = cyfry(q);
		return wiersze.filter((w) => {
			const c = w.c;
			if (!wSegmencie(w, segment)) return false;
			if (fOpiekun && (fOpiekun === '-' ? !!c.opiekun_id : c.opiekun_id !== fOpiekun)) return false;
			if (fTu && !w.p?.tu.has(fTu)) return false;
			if (fRodzaj && !w.p?.rodzaje.has(fRodzaj)) return false;
			if (fZrodlo && (fZrodlo === 'beauty') !== (c.beauty_id != null)) return false;
			if (!q) return true;
			return c.nazwa.toLowerCase().includes(q) ||
				(c.nazwa_skrocona ?? '').toLowerCase().includes(q) ||
				(c.nip ?? '').toLowerCase().includes(q) ||
				(c.pesel ?? '').toLowerCase().includes(q) ||
				(c.regon ?? '').toLowerCase().includes(q) ||
				(c.krs ?? '').toLowerCase().includes(q) ||
				(c.email ?? '').toLowerCase().includes(q) ||
				(c.telefon ?? '').toLowerCase().includes(q) ||
				(c.ulica ?? '').toLowerCase().includes(q) ||
				// NIP / telefon wpisane z kreskami lub spacjami
				(qCyfry.length >= 4 && (cyfry(c.nip).includes(qCyfry) || cyfry(c.telefon).includes(qCyfry)));
		});
	});

	const nazwaKlienta = (c: Client) => c.nazwa_skrocona ?? c.nazwa;
	const sort = new Sortowanie<Wiersz>({
		klient: (w) => nazwaKlienta(w.c),
		nip: (w) => w.c.nip ?? w.c.pesel,
		polisy: (w) => w.p?.polisy ?? null,
		skladka: (w) => w.p?.skladka ?? null,
		odnowienie: (w) => w.p?.odnowienie ?? null,
		opiekun: (w) => w.opiekun,
		rodo: (w) => w.c.rodo_zgoda
	}, { klucz: 'klient' }, 'klienci');
	const posortowane = $derived(sort.sortuj(filtered));

	// Stronicowanie
	const NA_STRONE = 50;
	let strona = $state(0);
	const stron = $derived(Math.max(1, Math.ceil(posortowane.length / NA_STRONE)));
	$effect(() => {
		// Nowy filtr / segment / sortowanie → wracamy na pierwszą stronę.
		void segment; void search; void fOpiekun; void fTu; void fRodzaj; void fZrodlo; void sort.klucz; void sort.kierunek;
		strona = 0;
	});
	const naStronie = $derived(posortowane.slice(strona * NA_STRONE, (strona + 1) * NA_STRONE));
	const zakres = $derived(
		posortowane.length === 0
			? '0 z 0'
			: `${strona * NA_STRONE + 1}–${Math.min((strona + 1) * NA_STRONE, posortowane.length)} z ${posortowane.length.toLocaleString('pl-PL')}`
	);

	// Wiersz: miasto z adresu (po kodzie pocztowym), typ, źródło
	function podpis(c: Client): string {
		return [miastoZAdresu(c.ulica), c.typ === 'osoba' ? 'osoba' : 'firma', c.beauty_id != null ? 'import BEAUTY' : null].filter(Boolean).join(' · ');
	}
	// PESEL na liście tylko częściowo — pełny jest w profilu klienta.
	const maskaPesel = (p: string) => (p.length > 4 ? `${p.slice(0, 2)}${'•'.repeat(p.length - 4)}${p.slice(-2)}` : p);
	const blisko = (d: string) => dateDiffDays(dzis, d) <= 14;

	// Zaznaczanie i akcje zbiorcze
	let selected = $state<Set<string>>(new Set());
	$effect(() => {
		void segment;
		selected = new Set();
	});
	function toggleSelect(id: string) {
		const n = new Set(selected);
		if (n.has(id)) n.delete(id); else n.add(id);
		selected = n;
	}
	const wszystkieNaStronie = $derived(naStronie.length > 0 && naStronie.every(w => selected.has(w.c.id)));
	function toggleStrona() {
		const n = new Set(selected);
		if (wszystkieNaStronie) naStronie.forEach(w => n.delete(w.c.id));
		else naStronie.forEach(w => n.add(w.c.id));
		selected = n;
	}

	let toast = $state<{ tekst: string; blad?: boolean; cofnij?: () => void } | null>(null);
	let nowyOpiekun = $state('');

	async function przypiszOpiekuna() {
		const ids = [...selected];
		if (ids.length === 0 || nowyOpiekun === '') return;
		const opiekunId = nowyOpiekun === '-' ? null : nowyOpiekun;
		const poprzedni = new Map(appState.clients.filter(c => selected.has(c.id)).map(c => [c.id, c.opiekun_id]));
		const { error } = await sb.from('crm_clients').update({ opiekun_id: opiekunId } as never).in('id', ids);
		nowyOpiekun = '';
		if (error) { toast = { tekst: `Nie udało się zapisać: ${error.message}`, blad: true }; return; }
		appState.clients = appState.clients.map(c => (poprzedni.has(c.id) ? { ...c, opiekun_id: opiekunId } : c));
		void logAudit('clients_owner_assigned', 'client', null, odmiana(ids.length, 'klient', 'klientów', 'klientów'), { ids, opiekun_id: opiekunId });
		selected = new Set();
		const kto = opiekunId ? opiekunWg.get(opiekunId) ?? 'opiekun' : 'bez opiekuna';
		toast = {
			tekst: `${odmiana(ids.length, 'klient', 'klientów', 'klientów')} → ${kto}`,
			cofnij: async () => {
				toast = null;
				// Przywracamy grupami według poprzedniego opiekuna.
				const grupy = new Map<string | null, string[]>();
				for (const [id, o] of poprzedni) grupy.set(o, [...(grupy.get(o) ?? []), id]);
				for (const [o, gIds] of grupy) {
					const { error: e } = await sb.from('crm_clients').update({ opiekun_id: o } as never).in('id', gIds);
					if (e) { toast = { tekst: `Nie udało się cofnąć: ${e.message}`, blad: true }; return; }
				}
				appState.clients = appState.clients.map(c => (poprzedni.has(c.id) ? { ...c, opiekun_id: poprzedni.get(c.id) ?? null } : c));
			}
		};
	}

	function eksportujCsv() {
		const wybrane = posortowane.filter(w => selected.has(w.c.id));
		const pole = (v: string | number | null | undefined) => {
			const s = v == null ? '' : String(v);
			return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const naglowek = ['Nazwa', 'Nazwa skrócona', 'Typ', 'NIP', 'PESEL', 'REGON', 'KRS', 'Adres', 'E-mail', 'Telefon', 'Aktywne polisy', 'Składka aktywnych polis', 'Najbliższe odnowienie', 'Opiekun', 'Zgoda RODO'];
		const linie = wybrane.map(({ c, p, opiekun }) => [
			c.nazwa, c.nazwa_skrocona, c.typ, c.nip, c.pesel, c.regon, c.krs, c.ulica, c.email, c.telefon,
			p?.polisy ?? 0, fmtPln(p?.skladka ?? 0), p?.odnowienie ?? '', opiekun ?? '', c.rodo_zgoda ? 'tak' : 'nie'
		].map(pole).join(';'));
		// BOM — Excel rozpozna polskie znaki.
		const blob = new Blob(['﻿' + [naglowek.join(';'), ...linie].join('\r\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `klienci-${dzis}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		void logAudit('clients_exported', 'client', null, odmiana(wybrane.length, 'klient', 'klientów', 'klientów'), { ids: wybrane.map(w => w.c.id) });
		toast = { tekst: `Wyeksportowano: ${odmiana(wybrane.length, 'klient', 'klientów', 'klientów')}` };
	}

	function openNew(typ: 'firma' | 'osoba') {
		modalTyp = typ;
		fNazwa = ''; fNazwaSkrocona = ''; fUlica = ''; fNip = ''; fRegon = ''; fKrs = ''; fPesel = '';
		fEmail = ''; fTelefon = ''; fGwarancje = false; formError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			typ: modalTyp,
			nazwa: fNazwa.trim(),
			nazwa_skrocona: fNazwaSkrocona.trim() || null,
			ulica: fUlica.trim() || null,
			nip: modalTyp === 'firma' ? (fNip.trim() || null) : null,
			pesel: modalTyp === 'osoba' ? (fPesel.trim() || null) : null,
			regon: modalTyp === 'firma' ? (fRegon.trim() || null) : null,
			krs: modalTyp === 'firma' ? (fKrs.trim() || null) : null,
			email: fEmail.trim() || null,
			telefon: fTelefon.trim() || null,
			gwarancje: fGwarancje
		};

		const { error } = await sb.from('crm_clients').insert([{
			tenant_id: appState.profile!.tenant_id,
			opiekun_id: appState.profile!.id,
			...payload
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		await logAudit('client_created', 'client', undefined, payload.nazwa as string);
		closeModal();
		const { data } = await wczytajKlientow();
		appState.clients = (data ?? []) as typeof appState.clients;
	}

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('new') === '1') openNew('firma');
	});

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const modalTitle = $derived(modalTyp === 'firma' ? 'Nowa Firma' : 'Nowa Osoba');
</script>

<svelte:head><title>Klienci — AuraCRM</title></svelte:head>
<svelte:window onclick={() => (nowyMenu = false)} />

<div class="flex flex-wrap items-end justify-between gap-3 mb-4">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Klienci <span class="font-normal text-ink-3 tabular-nums">{appState.clients.length.toLocaleString('pl-PL')}</span></h1>
		<p class="text-sm text-ink-3 mt-0.5">Portfel, dane kontaktowe i zgody RODO</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button onclick={() => (showDuplicates = true)} class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">
			Duplikaty
			{#if visibleDuplicateGroups.length > 0}
				<span class="px-1.5 rounded-full bg-warn-soft text-warn text-xs font-semibold leading-5 tabular-nums">{visibleDuplicateGroups.length}</span>
			{/if}
		</button>
		<div class="relative">
			<button
				onclick={(e) => { e.stopPropagation(); nowyMenu = !nowyMenu; }}
				aria-expanded={nowyMenu}
				aria-haspopup="menu"
				class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors"
			>
				Nowy klient <ChevronDown size={14} />
			</button>
			{#if nowyMenu}
				<div role="menu" class="absolute right-0 top-full mt-1 w-60 bg-white border border-line rounded-xl shadow-xl z-50 py-1">
					<button role="menuitem" onclick={() => { nowyMenu = false; openNew('firma'); }} class="w-full flex items-start gap-3 text-left px-4 py-2.5 hover:bg-surface-2">
						<Building2 size={16} class="text-ink-3 mt-0.5" />
						<span><span class="block text-sm font-medium text-ink">Firma</span><span class="block text-xs text-ink-3">NIP, REGON, KRS — dane z GUS</span></span>
					</button>
					<button role="menuitem" onclick={() => { nowyMenu = false; openNew('osoba'); }} class="w-full flex items-start gap-3 text-left px-4 py-2.5 hover:bg-surface-2">
						<User size={16} class="text-ink-3 mt-0.5" />
						<span><span class="block text-sm font-medium text-ink">Osoba prywatna</span><span class="block text-xs text-ink-3">PESEL, adres, kontakt</span></span>
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Segmenty -->
<div role="tablist" aria-label="Segmenty klientów" class="flex gap-x-5 border-b border-line mb-3 overflow-x-auto">
	{#each SEGMENTY as [id, label]}
		<button
			role="tab"
			aria-selected={segment === id}
			onclick={() => (segment = id)}
			class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
				{segment === id ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
		>
			{label} <span class="font-normal text-ink-3 tabular-nums">{liczSeg[id].toLocaleString('pl-PL')}</span>
		</button>
	{/each}
</div>

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<label class="w-full sm:w-auto sm:flex-[1_1_280px] sm:max-w-[420px] h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
		<Search size={16} class="text-ink-3 shrink-0" />
		<span class="sr-only">Filtruj listę</span>
		<input bind:value={search} placeholder="Nazwa, NIP, PESEL, e-mail, telefon…" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
		{#if search}
			<button onclick={() => (search = '')} aria-label="Wyczyść wyszukiwanie" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={14} /></button>
		{/if}
	</label>
	{#snippet filtr(etykieta: string, tekst: string | null, wyczysc: () => void, opcje: Snippet, wartosc: string, ustaw: (v: string) => void)}
		<!-- Widoczna etykieta + niewidoczny natywny select na wierzchu: przycisk ma szerokość wybranej wartości, nie najdłuższej opcji. -->
		<span class="relative inline-flex items-center h-9 rounded-lg text-[13px] font-medium focus-within:ring-2 focus-within:ring-accent/40 {tekst ? 'border border-line bg-white text-ink pr-7' : 'border border-dashed border-[#C4CAD4] text-ink-2 hover:bg-white'}">
			<span aria-hidden="true" class="px-2.5 max-w-[240px] truncate whitespace-nowrap">{tekst ?? `+ ${etykieta}`}</span>
			<select
				aria-label={etykieta}
				value={wartosc}
				onchange={(e) => ustaw((e.currentTarget as HTMLSelectElement).value)}
				class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
			>
				{@render opcje()}
			</select>
			{#if tekst}
				<button onclick={wyczysc} aria-label="Usuń filtr: {etykieta}" class="absolute right-1 z-10 w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={12} /></button>
			{/if}
		</span>
	{/snippet}
	{#snippet opcjeOpiekun()}
		<option value="">Dowolny opiekun</option>
		{#each opiekunowie as b}<option value={b.id}>{b.imie_nazwisko || b.email}{b.id === appState.profile?.id ? ' (ja)' : ''}</option>{/each}
		<option value="-">Bez opiekuna</option>
	{/snippet}
	{#snippet opcjeTu()}
		<option value="">Dowolne towarzystwo</option>
		{#each towarzystwa as t}<option value={t.id}>{t.skrot || t.nazwa}</option>{/each}
	{/snippet}
	{#snippet opcjeRodzaj()}
		<option value="">Dowolny rodzaj polisy</option>
		{#each rodzaje as r}<option value={r}>{r.replace(/_/g, ' ')}</option>{/each}
	{/snippet}
	{#snippet opcjeZrodlo()}
		<option value="">Dowolne źródło</option>
		<option value="beauty">import BEAUTY</option>
		<option value="crm">dodani w CRM</option>
	{/snippet}
	{@render filtr('Opiekun', fOpiekun ? (fOpiekun === '-' ? 'Bez opiekuna' : `Opiekun: ${opiekunWg.get(fOpiekun) ?? '—'}`) : null, () => (fOpiekun = ''), opcjeOpiekun, fOpiekun, (v) => (fOpiekun = v))}
	{@render filtr('Towarzystwo', fTu ? `TU: ${towarzystwa.find(t => t.id === fTu)?.skrot || towarzystwa.find(t => t.id === fTu)?.nazwa || '—'}` : null, () => (fTu = ''), opcjeTu, fTu, (v) => (fTu = v))}
	{@render filtr('Rodzaj polisy', fRodzaj ? `Rodzaj: ${fRodzaj.replace(/_/g, ' ')}` : null, () => (fRodzaj = ''), opcjeRodzaj, fRodzaj, (v) => (fRodzaj = v))}
	{@render filtr('Źródło', fZrodlo ? (fZrodlo === 'beauty' ? 'Źródło: import BEAUTY' : 'Źródło: dodani w CRM') : null, () => (fZrodlo = ''), opcjeZrodlo, fZrodlo, (v) => (fZrodlo = v as typeof fZrodlo))}
	{#if ileFiltrow > 0}
		<button onclick={wyczyscFiltry} class="h-9 px-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść</button>
	{/if}
	<div role="group" aria-label="Gęstość listy" class="hidden md:flex ml-auto p-0.5 rounded-lg bg-surface-2 border border-line-soft">
		<button aria-pressed={!kompakt} onclick={() => ustawGestosc(false)} class="h-[30px] px-3 rounded-md text-[13px] {!kompakt ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">Komfort</button>
		<button aria-pressed={kompakt} onclick={() => ustawGestosc(true)} class="h-[30px] px-3 rounded-md text-[13px] {kompakt ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium'}">Kompakt</button>
	</div>
</div>

<section aria-label="Lista klientów" class="bg-white border border-line rounded-xl overflow-hidden">
	{#if selected.size > 0}
		<div class="flex flex-wrap items-center gap-2 px-4 py-2 bg-accent-soft text-accent-text text-[13px]">
			<span class="font-semibold mr-1">{odmiana(selected.size, 'zaznaczony', 'zaznaczonych', 'zaznaczonych')}</span>
			<label class="inline-flex">
				<span class="sr-only">Przypisz opiekuna</span>
				<select bind:value={nowyOpiekun} onchange={przypiszOpiekuna} class="h-7 pl-2.5 pr-7 border border-blue-300 rounded-lg bg-white font-medium text-accent-text cursor-pointer">
					<option value="">Przypisz opiekuna…</option>
					{#each opiekunowie as b}<option value={b.id}>{b.imie_nazwisko || b.email}</option>{/each}
					<option value="-">— bez opiekuna —</option>
				</select>
			</label>
			<button onclick={eksportujCsv} class="h-7 flex items-center gap-1.5 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50"><Download size={14} /> Eksportuj CSV</button>
			<button onclick={() => (selected = new Set())} class="ml-auto h-7 px-2 font-semibold hover:underline">Odznacz</button>
		</div>
	{/if}

	{#if posortowane.length === 0}
		<div class="px-4 py-12 text-center">
			<p class="text-sm text-ink-3">Brak klientów dla wybranych filtrów.</p>
			{#if ileFiltrow > 0 || search}
				<button onclick={wyczyscFiltry} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Wyczyść filtry</button>
			{/if}
		</div>
	{:else}
		<!-- Telefon: karty -->
		<ul class="md:hidden divide-y divide-line-soft">
			{#each naStronie as { c, p, opiekun } (c.id)}
				<li use:ctxMenu={{ items: () => clientMenu(c), title: nazwaKlienta(c) }} class="flex items-start gap-3 px-4 py-3 {selected.has(c.id) ? 'bg-blue-50' : ''}">
					<input type="checkbox" checked={selected.has(c.id)} onchange={() => toggleSelect(c.id)} aria-label="Zaznacz {nazwaKlienta(c)}" class="mt-1 w-4 h-4 accent-accent shrink-0" />
					<a href="/clients/{c.id}" class="flex-1 min-w-0">
						<span class="flex items-start justify-between gap-2">
							<span class="font-medium text-ink truncate">{nazwaKlienta(c)}</span>
							{#if !c.rodo_zgoda}<span class="shrink-0 px-2 rounded-full bg-danger-soft text-danger text-xs font-semibold leading-5">Brak zgody</span>{/if}
						</span>
						<span class="block text-xs text-ink-3">{podpis(c)}{opiekun ? ` · ${opiekun}` : ''}</span>
						{#if p}
							<span class="block mt-1 text-[13px] text-ink-2 tabular-nums">
								{odmiana(p.polisy, 'polisa', 'polisy', 'polis')} · {fmtPln(p.skladka)} zł
								{#if p.odnowienie} · <span class={blisko(p.odnowienie) ? 'text-warn font-semibold' : ''}>odnowienie {fmtDzien(p.odnowienie)}</span>{/if}
							</span>
						{/if}
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
							<input type="checkbox" checked={wszystkieNaStronie} onchange={toggleStrona} aria-label="Zaznacz wszystkich na stronie" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
						</th>
						<SortTh s={sort} k="klient" wersaliki={false} class="px-3 py-2.5 font-semibold">Klient</SortTh>
						<SortTh s={sort} k="nip" wersaliki={false} class="px-3 py-2.5 font-semibold w-[150px]">NIP / PESEL</SortTh>
						<SortTh s={sort} k="polisy" wersaliki={false} align="right" class="px-3 py-2.5 font-semibold text-right w-[84px]">Polisy</SortTh>
						<SortTh s={sort} k="skladka" wersaliki={false} align="right" class="px-3 py-2.5 font-semibold text-right w-[140px] whitespace-nowrap">Składka</SortTh>
						<SortTh s={sort} k="odnowienie" wersaliki={false} class="px-3 py-2.5 font-semibold w-[200px] whitespace-nowrap">Najbliższe odnowienie</SortTh>
						<SortTh s={sort} k="opiekun" wersaliki={false} class="px-3 py-2.5 font-semibold w-[190px]">Opiekun</SortTh>
						<SortTh s={sort} k="rodo" wersaliki={false} class="pl-3 pr-4 py-2.5 font-semibold w-[110px]">RODO</SortTh>
					</tr>
				</thead>
				<tbody>
					{#each naStronie as { c, p, opiekun } (c.id)}
						{@const checked = selected.has(c.id)}
						{@const py = kompakt ? 'py-1.5' : 'py-2.5'}
						<tr use:ctxMenu={{ items: () => clientMenu(c), title: nazwaKlienta(c) }} class="border-t border-line-soft {checked ? 'bg-blue-50' : 'hover:bg-bg'}">
							<td class="pl-4 {py}">
								<input type="checkbox" {checked} onchange={() => toggleSelect(c.id)} aria-label="Zaznacz {nazwaKlienta(c)}" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
							</td>
							<td class="px-3 {py} max-w-[380px]">
								<a href="/clients/{c.id}" title={c.nazwa_skrocona ? c.nazwa : undefined} class="block text-ink hover:text-accent-text">
									<span class="block truncate font-medium">{nazwaKlienta(c)}</span>
									{#if !kompakt}<span class="block truncate text-xs text-ink-3">{podpis(c)}</span>{/if}
								</a>
							</td>
							<td class="px-3 {py} font-mono text-xs whitespace-nowrap text-ink-2">
								{#if c.nip}{c.nip}{:else if c.pesel}<span title="PESEL — pełny w profilu klienta">{maskaPesel(c.pesel)}</span>{:else}<span class="text-ink-3">—</span>{/if}
							</td>
							<td class="px-3 {py} text-right tabular-nums">{p ? p.polisy : '—'}</td>
							<td class="px-3 {py} text-right tabular-nums whitespace-nowrap">{p ? `${fmtPln(p.skladka)} zł` : '—'}</td>
							<td class="px-3 {py} whitespace-nowrap">
								{#if p?.odnowienie}
									{fmtDzien(p.odnowienie)}<span class={blisko(p.odnowienie) ? 'text-warn font-semibold' : 'text-ink-2'}>{` · ${fmtTermin(p.odnowienie, dzis)}`}</span>
								{:else}
									<span class="text-ink-3">—</span>
								{/if}
							</td>
							<td class="px-3 {py} whitespace-nowrap">
								<span class="flex items-center gap-2 min-w-0">
									<span class="w-6 h-6 shrink-0 rounded-full bg-surface-2 text-ink-2 text-xs font-semibold flex items-center justify-center">{inicjaly(opiekun)}</span>
									{#if opiekun}<span class="truncate">{opiekun}</span>{:else}<span class="italic text-ink-3">bez opiekuna</span>{/if}
								</span>
							</td>
							<td class="pl-3 pr-4 {py}">
								{#if c.rodo_zgoda}
									<span class="text-xs font-semibold text-ok">Zgoda</span>
								{:else}
									<span class="inline-block px-2 rounded-full bg-danger-soft text-danger text-xs font-semibold leading-5 whitespace-nowrap">Brak zgody</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-line-soft text-[13px] text-ink-2">
		<span class="w-full sm:w-auto sm:flex-1 min-w-0">{podpowiedz}</span>
		<span class="tabular-nums">{zakres}</span>
		<span class="flex gap-1">
			<button onclick={() => (strona = Math.max(0, strona - 1))} disabled={strona === 0} aria-label="Poprzednia strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronLeft size={14} /></button>
			<button onclick={() => (strona = Math.min(stron - 1, strona + 1))} disabled={strona >= stron - 1} aria-label="Następna strona" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronRight size={14} /></button>
		</span>
	</div>
</section>

{#if toast}
	<Toast tekst={toast.tekst} blad={toast.blad} oncofnij={toast.cofnij} onzamknij={() => (toast = null)} />
{/if}

<Modal title={modalTitle} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : (modalTyp === 'firma' ? 'Zapisz Firmę' : 'Zapisz Osobę')}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<!-- Row 1: Nazwa (full width) -->
		<div class="col-span-2">
			<label class={labelCls}>{modalTyp === 'firma' ? 'Nazwa firmy *' : 'Imię i Nazwisko *'}</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		{#if modalTyp === 'firma'}
			<!-- Row 2: Nazwa skrócona | Ulica i miasto -->
			<div>
				<label class={labelCls}>Nazwa skrócona (wyświetlana domyślnie)</label>
				<input bind:value={fNazwaSkrocona} class={inputCls} placeholder="np. Kowalski sp. z o.o." />
			</div>
			<div>
				<label class={labelCls}>Ulica i miasto</label>
				<input bind:value={fUlica} class={inputCls} />
			</div>
			<!-- RegonLookup: full width -->
			<div class="col-span-2">
				<RegonLookup onResult={(d) => { fNazwa = fNazwa || d.nazwa; fNip = d.nip || fNip; fRegon = d.regon || fRegon; fUlica = fUlica || d.adres; }} />
			</div>
			<!-- Row 3: NIP | REGON -->
			<div>
				<label class={labelCls}>NIP</label>
				<input bind:value={fNip} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>REGON</label>
				<input bind:value={fRegon} class={inputCls} />
			</div>
			<!-- KRS: full width -->
			<div class="col-span-2">
				<label class={labelCls}>KRS</label>
				<input bind:value={fKrs} class={inputCls} />
			</div>
		{:else}
			<!-- Row 2: PESEL | Ulica i miasto -->
			<div>
				<label class={labelCls}>PESEL</label>
				<input bind:value={fPesel} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Ulica i miasto</label>
				<input bind:value={fUlica} class={inputCls} />
			</div>
		{/if}
		<!-- Row 4 (firma) / Row 3 (osoba): Telefon | E-mail -->
		<div>
			<label class={labelCls}>Telefon</label>
			<input bind:value={fTelefon} type="tel" class={inputCls} placeholder="+48 600 000 000" />
		</div>
		<div>
			<label class={labelCls}>E-mail</label>
			<input bind:value={fEmail} type="email" class={inputCls} placeholder="kontakt@firma.pl" />
		</div>
		<!-- Gwarancje — po zaznaczeniu Panel Klienta pokaże zakładkę Gwarancje -->
		<div class="col-span-2">
			<label class="flex items-center gap-2 cursor-pointer text-sm text-slate-700 bg-slate-50 border border-line rounded-lg px-3 py-2.5">
				<input type="checkbox" bind:checked={fGwarancje} class="w-4 h-4 accent-blue-600" />
				<span class="font-medium">Gwarancje</span>
				<span class="text-xs text-slate-400">— klient korzysta z gwarancji ubezpieczeniowych (pokaże zakładkę Gwarancje)</span>
			</label>
		</div>
	</div>
</Modal>

<Modal title="Wykryte duplikaty klientów" open={showDuplicates} onclose={() => showDuplicates = false}>
	{#snippet footer()}
		<button onclick={() => showDuplicates = false} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
	{/snippet}
	{#if visibleDuplicateGroups.length === 0}
		<div class="text-center py-6 text-emerald-600 font-medium">✓ Brak nowych duplikatów (NIP / PESEL)</div>
	{:else}
		<div class="space-y-4">
			{#each visibleDuplicateGroups as group}
			<div class="border border-amber-200 rounded-lg overflow-hidden">
				<div class="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center justify-between">
					<span>{group.reason}</span>
					<button onclick={() => dismissGroup(group)} disabled={dismissing === dedupeKey(group)}
						class="text-xs font-medium text-amber-700 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-100 disabled:opacity-60 normal-case">
						{dismissing === dedupeKey(group) ? 'Zapisywanie...' : 'To nie są duplikaty'}
					</button>
				</div>
				<div class="divide-y divide-line-soft">
					{#each group.clients as c}
					{@const pCount = policyCount(c.id)}
					{@const aCount = apkCount(c.id)}
					<div class="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="radio" name="merge-{group.reason}" value={c.id}
								checked={mergeTarget[group.reason] === c.id}
								onchange={() => { mergeTarget[group.reason] = c.id; mergeError[group.reason] = ''; }}
								class="accent-blue-600" />
							<div>
								<div class="text-sm font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}</div>
								{#if c.nazwa_skrocona}<div class="text-xs text-slate-400">{c.nazwa}</div>{/if}
								{#if pCount > 0 || aCount > 0}
									<div class="text-xs text-emerald-600 mt-0.5">
										{#if pCount > 0}{pCount} polis{pCount === 1 ? 'a' : ''}{/if}
										{#if pCount > 0 && aCount > 0} · {/if}
										{#if aCount > 0}{aCount} APK złożone{/if}
									</div>
								{/if}
							</div>
						</label>
						<a href="/clients/{c.id}" onclick={() => showDuplicates = false} class="text-xs text-blue-600 hover:underline">Otwórz →</a>
					</div>
					{/each}
				</div>
				<div class="px-4 py-3 bg-slate-50 border-t border-line-soft">
					{#if mergeError[group.reason]}
						<div class="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{mergeError[group.reason]}</div>
					{/if}
					<button onclick={() => mergeGroup(group)} disabled={merging === group.reason}
						class="text-xs bg-accent text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
						{merging === group.reason ? 'Scalanie...' : 'Scal i usuń pozostałe'}
					</button>
					<span class="text-xs text-slate-400 ml-2">Wybierz rekord do zachowania, pozostałe zostaną scalone i usunięte.</span>
				</div>
			</div>
			{/each}
		</div>
	{/if}
</Modal>
