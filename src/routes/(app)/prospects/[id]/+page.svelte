<script lang="ts">
	// Karta leada (Sprzedaż → Leady). Układ: nagłówek z etapem sprzedaży (przełącznik zapisuje od razu), kolumna główna
	// — to, co doradca robi z leadem (APK i wniosek o pierwszą polisę OC beauty ze stanem: wysłano / otwarto / APK /
	// złożono, wniosek z aplikacji Utrata Dochodu, aktywność), kolumna boczna — fakty (dane firmy i czego szuka,
	// zadania, zgłoszenia z formularza i maile kampanii). Wysłanie wniosku e-mailem albo SMS-em z CRM zapisuje serwer:
	// wpis w aktywności i etap „Nowy” → „W kontakcie” ($lib/server/renewalFlow → wyslanieWLeadzie).
	import { TYP_ZADANIA_ETYKIETA, ustawStatusZadania } from '$lib/zadania';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import { sb } from '$lib/supabase';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		Phone, Mail, Send, Pencil, UserPlus, Trash2, CheckCircle2, Circle, Clock, Plus, AlertCircle, ChevronLeft, ChevronRight,
		UserRound, Link2, MessageSquare, FileText, Ban
	} from 'lucide-svelte';
	import type { CrmTask } from '$lib/types/database';
	import { fmtDzien, inicjaly, odmiana } from '$lib/utils';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { klientBeauty, programOcBeauty, wywolajApi } from '$lib/components/renewal/crmRenewals';
	import type { LinkWniosku, OdnowienieUtworzone } from '$lib/renewals/staffApi';
	import { ADRES_TESTOWY } from '$lib/renewals/staffApi';
	import LinkDlaKlienta from '$lib/components/renewal/LinkDlaKlienta.svelte';
	import { wczytajWnioskiOdnowien } from '$lib/kolekcje';
	import {
		ETAPY, ETYKIETA_ZAINTERESOWANIA, OPIS_ZAINTERESOWANIA, ZAINTERESOWANIA, ZRODLO_LEADA, nazwaKampanii, posortujZainteresowania,
		stanMaila, type MailKampanii, type Zgloszenie
	} from '$lib/sprzedaz';
	import { wierszeWnioskuUD, type WniosekUD } from '$lib/utrataDochodu';
	import { dzienKrotko, krokiWniosku, smsyWniosku, stanWniosku, type SmsWniosku, type WniosekLeada } from '$lib/wniosekLeada';

	type Prospect = {
		id: string;
		tenant_id: string;
		nazwa: string;
		nip: string | null;
		adres: string | null;
		telefon: string | null;
		email: string | null;
		branza: string | null;
		notatki: string | null;
		zatrudnienie: number | null;
		broker_id: string | null;
		status: string;
		status_zmieniony_at: string | null;
		created_at: string;
		crm_profiles?: { imie_nazwisko: string } | null;
		klient_id: string | null;
		zainteresowania: string[] | null;
		przychod: string | null;
		zrodlo: string | null;
		data_zgloszenia: string | null;
		liczba_zgloszen: number | null;
		crm_clients?: { nazwa: string; nazwa_skrocona: string | null; nip: string | null; email: string | null; telefon: string | null; ulica: string | null; beauty_id: number | string | null; segment_beauty?: boolean | null; opiekun_id?: string | null } | null;
	};

	type Activity = {
		id: string;
		typ: 'notatka' | 'komentarz' | 'wiadomosc';
		tresc: string;
		created_at: string;
		author_id: string | null;
		crm_profiles?: { imie_nazwisko: string } | null;
	};

	const prospectId = $derived($page.params.id ?? '');

	let prospect = $state<Prospect | null>(null);
	let activities = $state<Activity[]>([]);
	let loading = $state(true);
	let newText = $state('');
	let sending = $state(false);

	// Okno „Edytuj lead” (dane firmy spoza kartoteki, branża, zatrudnienie, notatki).
	let editOpen = $state(false);
	let fNazwa = $state('');
	let fNip = $state('');
	let fAdres = $state('');
	let fTelefon = $state('');
	let fEmail = $state('');
	let fBranza = $state('');
	let fNotatki = $state('');
	let fZatrudnienie = $state<number | ''>('');
	let saving = $state(false);
	let editError = $state('');

	// Zgłoszenia z formularza i maile kampanii (BEAUTY) firmy tego leada; wnioski z aplikacji Utrata Dochodu (crm_ud_leady).
	let zgloszenia = $state<Zgloszenie[]>([]);
	let maileKampanii = $state<MailKampanii[]>([]);
	let wnioskiUD = $state<WniosekUD[]>([]);
	let wszystkieZgloszenia = $state(false);
	let wszystkieMaile = $state(false);
	const maZgloszenieUD = $derived(zgloszenia.some((z) => z.zrodlo === 'utrata_dochodu'));
	const klient = $derived(prospect?.crm_clients ?? null);
	const nazwaLeada = $derived(klient?.nazwa_skrocona ?? klient?.nazwa ?? prospect?.nazwa ?? '');
	const telefon = $derived(klient?.telefon ?? prospect?.telefon ?? null);
	const email = $derived(klient?.email ?? prospect?.email ?? null);
	const nip = $derived(klient?.nip ?? prospect?.nip ?? null);
	const adres = $derived(klient?.ulica ?? prospect?.adres ?? null);
	const opiekunKlienta = $derived.by(() => {
		const id = klient?.opiekun_id ?? prospect?.broker_id ?? null;
		const b = id ? appState.brokers.find((x) => x.id === id) : null;
		return b ? (b.imie_nazwisko ?? b.email) : (prospect?.crm_profiles?.imie_nazwisko ?? null);
	});
	// „APK i wniosek o pierwszą polisę OC beauty” to rozwiązanie branży beauty: firma prowadzi program OC beauty,
	// a lead jest z formularza BEAUTY albo jego firma jest klientem beauty (import BEAUTY / certyfikat z programu).
	const leadBeauty = $derived(
		!!prospect && programOcBeauty(appState.policies) &&
			klientBeauty({ beautyId: prospect.crm_clients?.beauty_id, segmentBeauty: prospect.crm_clients?.segment_beauty, klientId: prospect.klient_id, zrodloLeada: prospect.zrodlo }, appState.policies)
	);

	// Kolory kropek etapów — jak na liście leadów (kanban).
	const KROPKA_ETAPU: Record<string, string> = { nowy: 'bg-accent', w_kontakcie: 'bg-[#9AA3B2]', oferta_wyslana: 'bg-warn', wygrany: 'bg-ok', przegrany: 'bg-danger' };

	function extractZatrudnienie(p: Prospect) {
		if (p.zatrudnienie != null) return String(p.zatrudnienie);
		if (!p.notatki) return null;
		const m = p.notatki.match(/Zatrudnienie:\s*(\d[\d\s]*)/);
		return m ? m[1].trim() : null;
	}
	// Notatki bez linii „WWW:” i „Zatrudnienie:” (z importu) — te są osobnymi polami w karcie „Firma”.
	const notatkiBezPol = (n: string | null) => (n ?? '').split('\n').filter((l) => !/^\s*(WWW|Zatrudnienie):/i.test(l)).join('\n').trim();
	function extractWWW(notatki: string | null) {
		if (!notatki) return null;
		const m = notatki.match(/WWW:\s*(https?:\/\/\S+)/);
		return m ? m[1] : null;
	}

	async function load() {
		loading = true;
		const { data: p } = await sb.from('crm_prospects')
			.select('*, crm_profiles(imie_nazwisko), crm_clients(nazwa, nazwa_skrocona, nip, email, telefon, ulica, beauty_id, segment_beauty, opiekun_id)')
			.eq('id', prospectId)
			.single();
		prospect = p as Prospect | null;
		fPrzychodInline = prospect?.przychod ?? '';
		wszystkieZgloszenia = false;
		wszystkieMaile = false;
		wniosekLink = null;
		void wczytajZgloszeniaIMaile();
		void wczytajWniosek();
		await wczytajAktywnosc();
		loading = false;
		await loadTasks();
	}

	async function wczytajAktywnosc() {
		const id = prospectId;
		const { data: acts } = await sb.from('crm_prospect_activities')
			.select('*, crm_profiles(imie_nazwisko)')
			.eq('prospect_id', id)
			.order('created_at', { ascending: false });
		if (id === prospectId) activities = (acts ?? []) as Activity[];
	}

	// Ostatni wniosek o pierwszą polisę klienta leada (w każdym stanie) i SMS-y z linkiem wysłane z CRM —
	// karta pokazuje, czy i kiedy klient dostał wniosek, a link do SMS-a nie unieważnia linku z e-maila.
	let wniosek = $state<WniosekLeada | null>(null);
	let smsy = $state<SmsWniosku[]>([]);
	const stan = $derived(wniosek ? stanWniosku(wniosek, smsy) : null);
	const kroki = $derived(wniosek ? krokiWniosku(wniosek, smsy) : []);
	const smsyTego = $derived(wniosek ? smsyWniosku(wniosek, smsy) : []);
	const wniosekTestowy = $derived(wniosek?.email?.trim().toLowerCase() === ADRES_TESTOWY);
	async function wczytajWniosek() {
		const klientId = prospect?.klient_id ?? null;
		if (!klientId) {
			wniosek = null;
			smsy = [];
			return;
		}
		const { data } = await sb
			.from('crm_renewals')
			.select('id, klient_id, rodzaj, status, decyzja, email, wyslano_at, otwarto_at, apk_at, apk_odmowa, zlozono_at, przypomniano_at, wazny_do, created_at')
			.eq('klient_id', klientId)
			.eq('rodzaj', 'nowa')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (prospect?.klient_id !== klientId) return;
		const w = (data as WniosekLeada | null) ?? null;
		let s: SmsWniosku[] = [];
		if (w) {
			const { data: ev } = await sb.from('crm_renewal_events').select('renewal_id, at, szczegoly').eq('renewal_id', w.id).eq('zdarzenie', 'sms').order('at');
			s = ((ev ?? []) as { renewal_id: string; at: string; szczegoly: Record<string, unknown> | null }[]).map((e) => ({
				renewal_id: e.renewal_id,
				at: e.at,
				numer: typeof e.szczegoly?.numer === 'string' ? e.szczegoly.numer : null
			}));
		}
		if (prospect?.klient_id !== klientId) return;
		wniosek = w;
		smsy = s;
	}

	// Ta sama trasa `[id]` jest współdzielona między leadami — przy przejściu „Poprzedni / Następny” komponent
	// nie montuje się ponownie, więc dane przeładowujemy przez efekt reagujący na zmianę id.
	$effect(() => {
		void prospectId;
		load();
	});

	// ---- Nawigacja Poprzedni / Następny (kolejność z listy leadów) ----
	let navIds = $state<string[]>([]);
	onMount(() => {
		try {
			const raw = sessionStorage.getItem('prospects:order');
			if (raw) navIds = JSON.parse(raw);
		} catch { /* brak zapisanej kolejności — przyciski się nie pokażą */ }
	});
	const navIndex = $derived(navIds.indexOf(prospectId));
	const prevId = $derived(navIndex > 0 ? navIds[navIndex - 1] : null);
	const nextId = $derived(navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null);

	function goToProspect(id: string | null) {
		if (id) goto(`/prospects/${id}`);
	}

	// Strzałki ← / → przełączają leady (poza polami tekstowymi i oknami).
	function onKeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		if (editOpen || showTaskForm) return;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
		if (e.key === 'ArrowLeft' && prevId) { e.preventDefault(); goToProspect(prevId); }
		else if (e.key === 'ArrowRight' && nextId) { e.preventDefault(); goToProspect(nextId); }
	}

	async function wczytajZgloszeniaIMaile() {
		const lead = prospect;
		if (!lead) return;
		const [z, m, ud] = await Promise.all([
			sb.from('crm_zgloszenia')
				.select('id, klient_id, prospect_id, zrodlo, zgloszono_at, firma, kontakt, email, telefon, produkt, zainteresowania, przychod, ponowne, poprzednie_at, poprzednie_typ, historyczne, odczytane_at')
				.or(lead.klient_id ? `prospect_id.eq.${lead.id},klient_id.eq.${lead.klient_id}` : `prospect_id.eq.${lead.id}`)
				.order('zgloszono_at', { ascending: false })
				.limit(20),
			lead.klient_id
				? sb.from('crm_kampanie_maile')
					.select('id, kampania, kod, temat, adres, status, wyslano_at, dostarczono_at, otwarto_at, kliknieto_at, odbito_at')
					.eq('klient_id', lead.klient_id)
					.order('wyslano_at', { ascending: false })
					.limit(20)
				: Promise.resolve({ data: [] }),
			sb.from('crm_ud_leady')
				.select('ud_klient_id, etap, status_crm, sprzedano_at, zarchiwizowano_at, synced_at, dane')
				.eq('prospect_id', lead.id)
				.order('created_at', { ascending: false })
				.limit(5)
		]);
		if (prospect?.id !== lead.id) return;
		zgloszenia = (z.data ?? []) as Zgloszenie[];
		maileKampanii = (m.data ?? []) as MailKampanii[];
		wnioskiUD = (ud.data ?? []) as WniosekUD[];
	}

	// Lista leadów trzyma kopię w appState — zmiana etapu widać po powrocie bez przeładowania.
	function ustawWLiscie(zmiana: Partial<Prospect>) {
		if (!prospect) return;
		const i = appState.prospects.findIndex((x) => x.id === prospect!.id);
		if (i >= 0) appState.prospects[i] = { ...appState.prospects[i], ...(zmiana as object) };
	}

	// ---- Etap sprzedaży: przełącznik w nagłówku zapisuje od razu ----
	let zapisEtapu = $state(false);
	async function zmienEtap(k: string) {
		if (!prospect || prospect.status === k || zapisEtapu) return;
		zapisEtapu = true;
		const { error } = await sb.from('crm_prospects').update({ status: k } as never).eq('id', prospect.id);
		zapisEtapu = false;
		if (error) { ctxToast(`Nie udało się zmienić etapu: ${error.message}`); return; }
		const teraz = new Date().toISOString();
		prospect = { ...prospect, status: k, status_zmieniony_at: teraz };
		ustawWLiscie({ status: k, status_zmieniony_at: teraz });
	}

	// Po kontakcie (wpis, zadanie, link przekazany SMS-em z telefonu) lead „nowy” przechodzi w „w kontakcie”.
	async function promoteToWKontakcie() {
		if (!prospect || prospect.status !== 'nowy') return;
		await sb.from('crm_prospects').update({ status: 'w_kontakcie' } as never).eq('id', prospect.id);
		prospect = { ...prospect, status: 'w_kontakcie', status_zmieniony_at: new Date().toISOString() };
		ustawWLiscie({ status: 'w_kontakcie' });
	}

	// Okno „Poszukiwane ubezpieczenia”: chipy zapisują się od razu, przychód po wyjściu z pola.
	let zapisPoszukiwanych = $state(false);
	let fPrzychodInline = $state('');
	async function zapiszPoszukiwane(zmiana: { zainteresowania?: string[]; przychod?: string | null }) {
		if (!prospect || zapisPoszukiwanych) return;
		zapisPoszukiwanych = true;
		const dane = { ...zmiana, ...(zmiana.zainteresowania ? { zainteresowania: posortujZainteresowania(zmiana.zainteresowania) } : {}) };
		const { error } = await sb.from('crm_prospects').update(dane as never).eq('id', prospect.id);
		zapisPoszukiwanych = false;
		if (error) { ctxToast(`Nie udało się zapisać: ${error.message}`); return; }
		prospect = { ...prospect, ...dane };
		ustawWLiscie(dane as Partial<Prospect>);
	}
	function przelaczPoszukiwane(k: string) {
		const obecne = prospect?.zainteresowania ?? [];
		void zapiszPoszukiwane({ zainteresowania: obecne.includes(k) ? obecne.filter((x) => x !== k) : [...obecne, k] });
	}
	function zapiszPrzychod() {
		const v = fPrzychodInline.trim() || null;
		if (v === (prospect?.przychod ?? null)) return;
		void zapiszPoszukiwane({ przychod: v });
	}

	// Aktywność to jeden rodzaj wpisu; wpisy ręczne zapisujemy jako „komentarz”, systemowe (np. wysłany wniosek) — „notatka”.
	async function addActivity() {
		if (!newText.trim() || !prospect) return;
		sending = true;
		const { error } = await sb.from('crm_prospect_activities').insert([{
			tenant_id: prospect.tenant_id,
			prospect_id: prospect.id,
			author_id: appState.profile?.id ?? null,
			typ: 'komentarz',
			tresc: newText.trim()
		}] as never);
		sending = false;
		if (error) { ctxToast(`Nie udało się dodać wpisu: ${error.message}`); return; }
		newText = '';
		await promoteToWKontakcie();
		await wczytajAktywnosc();
	}

	async function notatka(tresc: string) {
		if (!prospect) return;
		await sb.from('crm_prospect_activities').insert([{
			tenant_id: prospect.tenant_id,
			prospect_id: prospect.id,
			author_id: appState.profile?.id ?? null,
			typ: 'notatka',
			tresc
		}] as never);
	}

	async function deleteActivity(id: string) {
		const ok = await askConfirm({ title: 'Usunąć wpis?', message: 'Wpis zniknie z aktywności leada.', confirmLabel: 'Usuń wpis' });
		if (!ok) return;
		await sb.from('crm_prospect_activities').delete().eq('id', id);
		await wczytajAktywnosc();
	}

	function startEdit() {
		if (!prospect) return;
		fNazwa = prospect.nazwa; fNip = prospect.nip ?? ''; fAdres = prospect.adres ?? '';
		fTelefon = prospect.telefon ?? ''; fEmail = prospect.email ?? '';
		fBranza = prospect.branza ?? ''; fNotatki = prospect.notatki ?? '';
		fZatrudnienie = prospect.zatrudnienie ?? '';
		editError = '';
		editOpen = true;
	}

	async function saveEdit() {
		if (!prospect) return;
		if (!prospect.klient_id && !fNazwa.trim()) { editError = 'Podaj nazwę firmy.'; return; }
		saving = true;
		const wspolne = {
			branza: fBranza.trim() || null, notatki: fNotatki.trim() || null,
			zatrudnienie: fZatrudnienie !== '' ? Number(fZatrudnienie) : null
		};
		// Lead powiązany z klientem: dane firmy edytuje się w kartotece klienta.
		const { error } = await sb.from('crm_prospects').update(prospect.klient_id ? (wspolne as never) : {
			...wspolne,
			nazwa: fNazwa.trim(), nip: fNip.trim() || null, adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null, email: fEmail.trim() || null
		} as never).eq('id', prospect.id);
		saving = false;
		if (error) { editError = error.message; return; }
		editOpen = false;
		await load();
	}

	// Lead spoza kartoteki → klient (albo powiązanie z istniejącym klientem o tym NIP). Etap się nie zmienia:
	// lead zamknie się jako „Wygrany” sam, gdy klient dostanie polisę.
	async function convertToClient() {
		if (!prospect) return;
		if (prospect.klient_id) { goto(`/clients/${prospect.klient_id}`); return; }
		const nipCyfry = (prospect.nip ?? '').replace(/\D/g, '');
		let klientId = nipCyfry.length === 10 ? appState.clients.find((c) => (c.nip ?? '').replace(/\D/g, '') === nipCyfry)?.id ?? null : null;
		if (!klientId) {
			if (!(await askConfirm({ title: 'Dodać do Klientów?', message: `„${prospect.nazwa}” trafi do kartoteki klientów. Lead zostaje w Sprzedaży do pierwszej polisy.`, confirmLabel: 'Dodaj', danger: false }))) return;
			const { data, error } = await sb.from('crm_clients').insert([{
				tenant_id: appState.profile!.tenant_id,
				opiekun_id: prospect.broker_id ?? appState.profile!.id,
				typ: 'firma',
				nazwa: prospect.nazwa, nip: prospect.nip, ulica: prospect.adres, email: prospect.email, telefon: prospect.telefon
			}] as never).select('id').single();
			if (error || !data) { ctxToast('Nie udało się dodać klienta: ' + (error?.message ?? 'brak odpowiedzi')); return; }
			klientId = (data as { id: string }).id;
		}
		await sb.from('crm_prospects').update({ klient_id: klientId } as never).eq('id', prospect.id);
		await load();
	}

	// ---- Pierwsza polisa OC beauty: link do APK i wniosku ----
	// Lead spoza kartoteki najpierw trafia do Klientów (convertToClient) — wniosek jest zawsze przypięty do klienta.
	let wniosekPracuje = $state<'' | 'email' | 'link' | 'sms'>('');
	let wniosekLink = $state<LinkWniosku | null>(null);
	let wniosekBlad = $state('');
	async function wyslijWniosek(tryb: 'email' | 'link') {
		if (!prospect || wniosekPracuje) return;
		wniosekBlad = '';
		if (!prospect.klient_id) {
			await convertToClient();
			if (!prospect?.klient_id) return;
		}
		wniosekPracuje = tryb;
		try {
			// Link utworzony, ale niewysłany — zastępujemy go bez pytania (klient go nie ma).
			const body = { klient_id: prospect.klient_id, tryb, oczekiwany_test: appState.tenantFeatures?.odnowienia_test === true, ...(stan?.klucz === 'link' ? { zastap: true } : {}) };
			let w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', body);
			if (!w.ok && w.status === 409 && w.aktywny) {
				const tak = await askConfirm({
					title: 'Klient ma już aktywny wniosek o pierwszą polisę.',
					message: stan?.wyslany ? `Klient dostał go ${dzienKrotko(stan.wyslanoAt)}. Wysłać nowy i unieważnić poprzedni link?` : 'Utworzyć nowy i unieważnić poprzedni link?',
					detail: 'Poprzedni link przestanie działać od razu. Żeby przypomnieć klientowi o tym samym wniosku, użyj „Link i SMS”.',
					confirmLabel: tryb === 'email' ? 'Wyślij nowy' : 'Utwórz nowy',
					cancelLabel: 'Zostaw obecny'
				});
				if (!tak) return;
				w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', { ...body, zastap: true });
			}
			if (!w.ok) {
				wniosekBlad = w.message;
				return;
			}
			wniosekLink = { id: w.data.id, link: w.data.link ?? '', krotki_link: w.data.krotki_link ?? null, wazny_do: w.data.wazny_do, sms: w.data.sms === true };
			if (tryb === 'email') {
				// Wpis w aktywności i etap „W kontakcie” zapisuje serwer przy wysyłce.
				ctxToast(w.data.test ? `TEST: wniosek wysłany na adres testowy ${w.data.adres ?? ''}` : `Wysłano link do APK i wniosku${w.data.adres ? ` na ${w.data.adres}` : ''}`);
				wniosekLink = null;
			} else {
				try {
					await navigator.clipboard.writeText(wniosekLink.krotki_link || wniosekLink.link);
					ctxToast('Skopiowano link do APK i wniosku');
				} catch {
					ctxToast('Link utworzony — skopiuj go z pola poniżej');
				}
				await notatka('Utworzono link do APK i wniosku o pierwszą polisę OC (do przekazania klientowi).');
			}
			await odswiezPoWysylce();
		} finally {
			wniosekPracuje = '';
		}
	}

	// Po wysyłce: stan wniosku, etap (serwer mógł przestawić „Nowy” → „W kontakcie”), aktywność i lista wniosków w CRM.
	async function odswiezPoWysylce() {
		if (!prospect) return;
		const id = prospect.id;
		const [{ data: p }] = await Promise.all([
			sb.from('crm_prospects').select('status, status_zmieniony_at').eq('id', id).maybeSingle(),
			wczytajWniosek(),
			wczytajAktywnosc()
		]);
		if (p && prospect?.id === id) {
			const s = p as { status: string; status_zmieniony_at: string | null };
			prospect = { ...prospect, ...s };
			ustawWLiscie(s);
		}
		void wczytajWnioskiOdnowien().then((r) => { if (!r.error && r.data) appState.wnioskiOdnowien = r.data as typeof appState.wnioskiOdnowien; }).catch(() => {});
	}

	// Link (krótki, do SMS-a) do aktywnego wniosku — bez tworzenia nowego.
	async function pokazLinkAktywnego() {
		if (!wniosek || wniosekPracuje) return;
		wniosekPracuje = 'sms';
		wniosekBlad = '';
		try {
			const w = await wywolajApi<LinkWniosku>('POST', '/api/renewals/link', { id: wniosek.id });
			if (!w.ok) {
				wniosekBlad = w.message;
				await wczytajWniosek();
				return;
			}
			wniosekLink = w.data;
		} finally {
			wniosekPracuje = '';
		}
	}

	// SMS z linkiem: wysłany z CRM (SMSAPI — wpis i etap zapisuje serwer) albo otwarty w aplikacji SMS na telefonie
	// (tego serwer nie wie — wpis i etap tutaj).
	async function poSms(numer: string, przezApi: boolean) {
		if (!prospect) return;
		if (!przezApi) {
			await notatka(`Przekazano klientowi SMS-em z telefonu link do APK i wniosku o pierwszą polisę OC (${numer}).`);
			await promoteToWKontakcie();
		}
		await odswiezPoWysylce();
	}

	function formatDate(dt: string) {
		return new Date(dt).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// ---- Zadania leada: wspólna karta zadania (TaskModal) z leadem na sztywno; lead z kartoteki niesie też klienta ----
	let tasks = $state<CrmTask[]>([]);
	let showTaskForm = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	const taskTypeLabels: Record<string, string> = TYP_ZADANIA_ETYKIETA;
	const today = new Date().toISOString().slice(0, 10);
	const otwarteZadania = $derived(tasks.filter((t) => t.status !== 'zakonczone').length);

	async function loadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.eq('prospect_id', prospectId)
			.order('termin', { ascending: true, nullsFirst: false });
		tasks = (data ?? []) as CrmTask[];
	}
	function openNewTask() { editingTask = null; showTaskForm = true; }
	function openEditTask(t: CrmTask) { editingTask = t; showTaskForm = true; }
	function cancelTaskForm() { showTaskForm = false; editingTask = null; }
	async function poZapisieZadania() {
		editingTask = null;
		await promoteToWKontakcie();
		await loadTasks();
	}
	async function toggleTaskStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		const blad = await ustawStatusZadania(t, next, appState.profile!.id);
		if (blad) ctxToast(`Nie udało się zmienić statusu: ${blad}`);
		await loadTasks();
	}
	async function deleteTask(t: CrmTask) {
		const ok = await askConfirm({ title: 'Usunąć zadanie?', message: t.tytul, detail: 'Zadania nie da się przywrócić z Kosza.', confirmLabel: 'Usuń zadanie' });
		if (!ok) return;
		await sb.from('crm_tasks').delete().eq('id', t.id);
		await loadTasks();
	}
	const isOverdue = (t: CrmTask) => (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < today;
	const priorityDotMap: Record<CrmTask['priorytet'], string> = { pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300' };

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40';
	const labelCls = 'block text-[13px] font-medium text-ink-2 mb-1';
	const przyciskCls = 'h-9 inline-flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-60';
	const glownyCls = 'h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60';
	const kartaCls = 'bg-white border border-line rounded-xl';
</script>

<svelte:head><title>{nazwaLeada || 'Lead'} — AuraCRM</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex flex-wrap items-center justify-between gap-3 mb-3">
	<nav aria-label="Ścieżka" class="flex items-center gap-1.5 text-[13px] text-ink-3 min-w-0">
		<a href="/prospects" class="text-accent-text hover:underline">Leady</a>
		<span aria-hidden="true">/</span>
		<span class="truncate">{nazwaLeada}</span>
	</nav>
	{#if navIndex >= 0 && navIds.length > 1}
		<div class="flex items-center gap-1">
			<button onclick={() => goToProspect(prevId)} disabled={!prevId} title="Poprzedni lead (←)" aria-label="Poprzedni lead" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronLeft size={15} /></button>
			<span class="text-xs text-ink-3 tabular-nums px-1.5">{navIndex + 1} z {navIds.length}</span>
			<button onclick={() => goToProspect(nextId)} disabled={!nextId} title="Następny lead (→)" aria-label="Następny lead" class="w-8 h-8 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-default"><ChevronRight size={15} /></button>
		</div>
	{/if}
</div>

{#if loading && !prospect}
	<div class="text-center text-ink-3 py-16">Ładowanie…</div>
{:else if !prospect}
	<div class="text-center text-ink-3 py-16">Nie znaleziono leada.</div>
{:else}
	{@const zatrud = extractZatrudnienie(prospect)}
	{@const www = extractWWW(prospect.notatki)}

	<!-- Nagłówek: kto to jest, skąd przyszedł, co z nim można zrobić -->
	<header class="flex flex-wrap items-start gap-4 mb-4">
		<span aria-hidden="true" class="hidden sm:flex w-12 h-12 shrink-0 rounded-xl bg-accent-soft text-accent-text font-semibold text-base items-center justify-center">{inicjaly(nazwaLeada)}</span>
		<div class="flex-[1_1_380px] min-w-0 flex flex-col gap-1.5">
			<h1 class="text-2xl font-semibold text-ink leading-tight">{nazwaLeada}</h1>
			<div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
				{#if nip}<span class="inline-flex items-center gap-0.5 font-mono text-xs">NIP {nip} <Kopiuj tekst={nip.replace(/\D/g, '')} opis="NIP" /></span>{/if}
				{#if prospect.zrodlo}<span>źródło: {ZRODLO_LEADA[prospect.zrodlo] ?? prospect.zrodlo}</span>{/if}
				{#if prospect.data_zgloszenia}<span>pierwsze zgłoszenie {fmtDzien(prospect.data_zgloszenia.slice(0, 10), true)}</span>{/if}
				{#if (prospect.liczba_zgloszen ?? 0) >= 2}<span class="h-[22px] leading-[22px] px-2 rounded-full bg-warn-soft text-warn text-xs font-semibold">{prospect.liczba_zgloszen}× zgłoszenie</span>{/if}
				<span>Opiekun: {#if opiekunKlienta}<span class="text-ink font-medium">{opiekunKlienta}</span>{:else}<span class="italic text-ink-3">brak</span>{/if}</span>
				{#if prospect.klient_id}
					<span class="text-ink-3">firma z kartoteki klientów</span>
				{:else}
					<span class="text-ink-3">spoza kartoteki klientów</span>
				{/if}
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if telefon}
				<a href="tel:{telefon}" aria-label="Zadzwoń: {telefon}" title="Zadzwoń: {telefon}" class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"><Phone size={16} /></a>
			{/if}
			{#if email}
				<a href="mailto:{email}" aria-label="Napisz e-mail: {email}" title="Napisz e-mail: {email}" class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"><Mail size={16} /></a>
			{/if}
			<button onclick={startEdit} class={przyciskCls}><Pencil size={15} class="text-ink-3" /> Edytuj</button>
			{#if prospect.klient_id}
				<a href="/clients/{prospect.klient_id}" class={przyciskCls}><UserRound size={15} class="text-ink-3" /> Panel 360° klienta</a>
			{:else}
				<button onclick={convertToClient} class={glownyCls}><UserPlus size={15} /> Dodaj do Klientów</button>
			{/if}
		</div>
	</header>

	<!-- Etap sprzedaży: jedno kliknięcie zapisuje -->
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 mb-5" data-testid="lead-etap">
		<span class="text-[13px] font-medium text-ink-2">Etap</span>
		<div role="radiogroup" aria-label="Etap sprzedaży" class="flex flex-wrap p-0.5 rounded-lg bg-surface-2 border border-line-soft">
			{#each ETAPY as e (e.key)}
				{@const wybrany = prospect.status === e.key}
				<button role="radio" aria-checked={wybrany} onclick={() => zmienEtap(e.key)} disabled={zapisEtapu}
					class="h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-[13px] transition-colors {wybrany ? 'bg-white text-ink font-semibold shadow-sm' : 'text-ink-2 font-medium hover:text-ink'}">
					<span aria-hidden="true" class="w-2 h-2 rounded-full {wybrany ? KROPKA_ETAPU[e.key] : 'bg-[#C4CAD4]'}"></span>{e.label}
				</button>
			{/each}
		</div>
		{#if prospect.status_zmieniony_at}<span class="text-xs text-ink-3">od {fmtDzien(prospect.status_zmieniony_at.slice(0, 10), true)}</span>{/if}
	</div>

	<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px] items-start">
		<!-- Kolumna główna: wniosek, aplikacja UD, aktywność -->
		<div class="flex flex-col gap-5 min-w-0">
			{#if leadBeauty}
				<section aria-labelledby="lead-wniosek-h" data-testid="lead-pierwsza-polisa" class={kartaCls}>
					<div class="px-5 pt-4 flex flex-wrap items-start gap-x-3 gap-y-1">
						<h2 id="lead-wniosek-h" class="flex-1 min-w-[220px] text-[15px] font-semibold text-ink">APK i wniosek o pierwszą polisę OC beauty</h2>
						{#if stan && stan.klucz !== 'link' && stan.klucz !== 'anulowany'}
							<span class="h-6 leading-6 px-2.5 rounded-full text-xs font-semibold {stan.cls}" data-testid="lead-wniosek-chip">{stan.chip}</span>
						{/if}
						{#if wniosekTestowy}<span class="h-6 leading-6 px-2 rounded-full bg-warn-soft text-warn text-xs font-semibold">wniosek testowy</span>{/if}
					</div>

					<!-- Stan: czy klient dostał wniosek, kiedy i jak -->
					<div class="mx-5 mt-3 rounded-lg px-4 py-3 flex items-start gap-3 {stan?.wyslany ? (stan.klucz === 'wygasl' ? 'bg-surface-2' : stan.klucz === 'rezygnacja' ? 'bg-danger-soft' : 'bg-ok-soft') : 'bg-surface-2'}" data-testid="lead-wniosek-stan">
						{#if stan?.wyslany}
							<CheckCircle2 size={18} class="shrink-0 mt-0.5 {stan.klucz === 'rezygnacja' ? 'text-danger' : stan.klucz === 'wygasl' ? 'text-ink-3' : 'text-ok'}" />
						{:else}
							<Send size={18} class="shrink-0 mt-0.5 text-ink-3" />
						{/if}
						<div class="min-w-0 text-[13px] text-ink">
							{#if !wniosek || !stan || stan.klucz === 'anulowany'}
								<p class="font-semibold">Nie wysłano jeszcze APK i wniosku{stan?.klucz === 'anulowany' ? ' — poprzedni wniosek anulowano' : ''}.</p>
								<p class="text-ink-2">Klient wypełnia online analizę potrzeb i wniosek (dane gabinetu, początek ochrony, suma, ochrona prawna) i podpisuje palcem albo myszą. PDF-y i zadanie trafią do CRM{prospect.klient_id ? '' : ' — lead zostanie najpierw dodany do Klientów'}.</p>
							{:else if stan.klucz === 'link'}
								<p class="font-semibold">Link utworzony {dzienKrotko(wniosek.created_at)}, ale nie wysłany z CRM.</p>
								<p class="text-ink-2">Gdy link trafił do klienta inną drogą, zapisz to w aktywności. Ważny do {fmtDzien(wniosek.wazny_do.slice(0, 10), true)}.</p>
							{:else}
								<p class="font-semibold">{stan.etykieta}{stan.dzien && stan.klucz !== 'wyslany' ? ` — ${dzienKrotko(stan.dzien)}` : ''}.</p>
								<ul class="text-ink-2">
									{#if wniosek.wyslano_at}<li>Wysłano e-mailem {formatDate(wniosek.wyslano_at)}{wniosek.email ? ` na ${wniosek.email}` : ''}.</li>{/if}
									{#each smsyTego as s (s.at)}<li>Wysłano SMS-em {formatDate(s.at)}{s.numer ? ` na ${s.numer}` : ''}.</li>{/each}
									{#if wniosek.przypomniano_at}<li>Przypomnienie e-mailem {formatDate(wniosek.przypomniano_at)}.</li>{/if}
									{#if stan.aktywny}<li>Link ważny do {fmtDzien(wniosek.wazny_do.slice(0, 10), true)}.</li>{/if}
								</ul>
							{/if}
						</div>
					</div>

					{#if wniosek && stan && stan.wyslany}
						<!-- Postęp: wysłano → otwarto → APK → złożono -->
						<ol class="grid grid-cols-4 gap-2 px-5 pt-3" aria-label="Postęp wniosku" data-testid="lead-wniosek-kroki">
							{#each kroki as k, i (i)}
								{@const zly = k.at && i === 3 && stan.klucz === 'rezygnacja'}
								<li class="flex flex-col gap-1 min-w-0">
									<span aria-hidden="true" class="h-1.5 rounded-full {k.at ? (zly ? 'bg-danger' : 'bg-ok') : 'bg-surface-2'}"></span>
									<span class="text-xs font-semibold truncate {k.at ? 'text-ink' : 'text-ink-3'}">{k.etykieta}</span>
									<span class="text-xs text-ink-3 tabular-nums">{k.at ? dzienKrotko(k.at) : '—'}</span>
								</li>
							{/each}
						</ol>
					{/if}

					{#if wniosekBlad}
						<p class="mx-5 mt-3 text-[13px] text-danger" role="alert">{wniosekBlad}</p>
					{/if}

					<!-- Akcje zależne od stanu -->
					<div class="mt-4 px-5 py-3 border-t border-line-soft flex flex-wrap items-center gap-2" data-testid="lead-wniosek-akcje">
						{#if stan?.zakonczony}
							<a href="/clients/{prospect.klient_id}?tab=apk" class={glownyCls}><FileText size={15} /> Wniosek, APK i PDF-y</a>
						{:else if stan?.aktywny && stan.wyslany}
							<button onclick={pokazLinkAktywnego} disabled={!!wniosekPracuje} class={glownyCls} data-testid="link-sms">
								<MessageSquare size={15} /> {wniosekPracuje === 'sms' ? 'Wczytywanie…' : 'Link i SMS'}
							</button>
							<button onclick={() => wyslijWniosek('email')} disabled={!!wniosekPracuje || !email} title={email ? 'Nowy wniosek e-mailem — poprzedni link przestanie działać' : 'Klient nie ma adresu e-mail'} class={przyciskCls}>
								<Mail size={15} class="text-ink-3" /> {wniosekPracuje === 'email' ? 'Wysyłanie…' : 'Wyślij nowy e-mailem'}
							</button>
						{:else}
							<button onclick={() => wyslijWniosek('email')} disabled={!!wniosekPracuje || !email} title={email ? `Wyślij na ${email}` : 'Klient nie ma adresu e-mail — utwórz link i wyślij go SMS-em'} class={email ? glownyCls : przyciskCls} data-testid="wniosek-email">
								<Mail size={15} /> {wniosekPracuje === 'email' ? 'Wysyłanie…' : stan?.klucz === 'wygasl' ? 'Wyślij nowy e-mailem' : 'Wyślij e-mailem'}
							</button>
							{#if stan?.klucz === 'link' && stan.aktywny}
								<button onclick={pokazLinkAktywnego} disabled={!!wniosekPracuje} class={email ? przyciskCls : glownyCls} data-testid="link-sms">
									<MessageSquare size={15} /> {wniosekPracuje === 'sms' ? 'Wczytywanie…' : 'Link i SMS'}
								</button>
							{:else}
								<button onclick={() => wyslijWniosek('link')} disabled={!!wniosekPracuje} class={email ? przyciskCls : glownyCls} data-testid="wniosek-link">
									<Link2 size={15} /> {wniosekPracuje === 'link' ? 'Tworzenie…' : 'Utwórz link do SMS-a'}
								</button>
							{/if}
						{/if}
						{#if prospect.klient_id && wniosek && !stan?.zakonczony}
							<a href="/clients/{prospect.klient_id}?tab=apk" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Przebieg na karcie klienta →</a>
						{/if}
						{#if !email && !stan?.zakonczony}
							<span class="w-full text-xs text-ink-3">Klient nie ma adresu e-mail — wyślij link SMS-em{prospect.klient_id ? '' : ' (adres dopiszesz w „Edytuj”)'}.</span>
						{/if}
					</div>
					{#if wniosekLink}
						<div class="px-5 pb-4 -mt-1">
							<LinkDlaKlienta link={wniosekLink.link} krotki={wniosekLink.krotki_link} waznyDo={wniosekLink.wazny_do} {telefon} nowa renewalId={wniosekLink.id} smsapi={wniosekLink.sms} onsms={poSms} onzamknij={() => (wniosekLink = null)} />
						</div>
					{/if}
				</section>
			{/if}

			{#if wnioskiUD.length}
				<!-- Wniosek złożony w aplikacji Utrata Dochodu (synchronizacja w bazie: crm_ud_leady). Dane medyczne zostają w aplikacji. -->
				<section aria-labelledby="lead-ud-h" data-testid="lead-ud" class="{kartaCls} px-5 py-4">
					<h2 id="lead-ud-h" class="text-[15px] font-semibold text-ink mb-2">Wniosek w aplikacji Utrata Dochodu{#if wnioskiUD.length > 1} <span class="font-normal text-ink-3">{wnioskiUD.length}</span>{/if}</h2>
					<div class="grid grid-cols-1 {wnioskiUD.length > 1 ? 'xl:grid-cols-2' : ''} gap-x-8 gap-y-3">
						{#each wnioskiUD as w (w.ud_klient_id)}
							<dl class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
								{#each wierszeWnioskuUD(w, (d) => fmtDzien(d.slice(0, 10), true)) as [etykieta, wartosc] (etykieta)}
									<dt class="text-ink-3">{etykieta}</dt>
									<dd class="text-ink">{wartosc}</dd>
								{/each}
							</dl>
						{/each}
					</div>
					<p class="mt-2.5 text-xs text-ink-3">Etap leada w CRM podąża za etapem w aplikacji (tylko do przodu); sprzedaż w aplikacji zapisuje się w aktywności.</p>
				</section>
			{/if}

			<!-- Aktywność: nowy wpis na górze, najnowsze pierwsze -->
			<section aria-labelledby="lead-aktywnosc-h" class={kartaCls}>
				<div class="px-5 pt-4 pb-3">
					<h2 id="lead-aktywnosc-h" class="text-[15px] font-semibold text-ink">Aktywność <span class="font-normal text-ink-3">{activities.length || ''}</span></h2>
					<p class="text-xs text-ink-3">Notatki z rozmów i ustalenia; wpisy systemowe (wysłany wniosek, SMS, złożony wniosek) dodaje CRM.</p>
				</div>
				<div class="px-5 pb-4">
					<textarea
						bind:value={newText}
						placeholder="Dodaj wpis — notatka z rozmowy, ustalenia…"
						rows="2"
						aria-label="Nowy wpis w aktywności"
						class="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y bg-white"
						onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addActivity(); }}
					></textarea>
					<div class="flex items-center justify-between gap-2 mt-2">
						<span class="text-xs text-ink-3">Ctrl+Enter — dodaj</span>
						<button onclick={addActivity} disabled={sending || !newText.trim()} class="{glownyCls} h-8 text-[13px]"><Send size={13} /> {sending ? 'Dodawanie…' : 'Dodaj wpis'}</button>
					</div>
				</div>
				{#if activities.length === 0}
					<p class="px-5 py-6 border-t border-line-soft text-center text-sm text-ink-3">Brak wpisów — dodaj pierwszy powyżej.</p>
				{:else}
					<ul class="border-t border-line-soft divide-y divide-line-soft max-h-[560px] overflow-y-auto" data-testid="lead-aktywnosc">
						{#each activities as act (act.id)}
							{@const system = act.typ === 'notatka' && !act.author_id}
							<li class="px-5 py-3 flex gap-3 group">
								<span aria-hidden="true" class="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-semibold {system ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-ink-2'}">
									{system ? 'CRM' : inicjaly(act.crm_profiles?.imie_nazwisko ?? 'U')}
								</span>
								<div class="flex-1 min-w-0">
									<p class="text-xs text-ink-3"><span class="font-semibold text-ink-2">{act.crm_profiles?.imie_nazwisko ?? (act.author_id ? 'Użytkownik' : 'CRM')}</span> · {formatDate(act.created_at)}</p>
									<p class="text-sm text-ink whitespace-pre-wrap leading-relaxed">{act.tresc}</p>
								</div>
								<button onclick={() => deleteActivity(act.id)} aria-label="Usuń wpis" title="Usuń wpis" class="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-danger hover:bg-danger-soft self-start shrink-0">
									<Trash2 size={13} />
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- Kolumna boczna: dane firmy i czego szuka, zadania, zgłoszenia i kampanie -->
		<aside class="flex flex-col gap-5 min-w-0" aria-label="Dane leada">
			<section aria-labelledby="lead-firma-h" class={kartaCls} data-testid="lead-firma">
				<div class="px-5 pt-4 pb-2 flex items-center gap-2">
					<h2 id="lead-firma-h" class="flex-1 text-[15px] font-semibold text-ink">Firma</h2>
					<button onclick={startEdit} class="text-[13px] font-semibold text-accent-text hover:underline">Edytuj</button>
				</div>
				<dl class="px-5 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
					<dt class="text-ink-3">Telefon</dt>
					<dd class="text-ink min-w-0">{#if telefon}<a href="tel:{telefon}" class="hover:underline">{telefon}</a>{:else}<span class="text-ink-3">—</span>{/if}</dd>
					<dt class="text-ink-3">E-mail</dt>
					<dd class="text-ink min-w-0 truncate">{#if email}<a href="mailto:{email}" class="text-accent-text hover:underline" title={email}>{email}</a>{:else}<span class="text-ink-3">—</span>{/if}</dd>
					<dt class="text-ink-3">Adres</dt>
					<dd class="text-ink min-w-0">{adres ?? '—'}</dd>
					{#if www}
						<dt class="text-ink-3">WWW</dt>
						<dd class="min-w-0 truncate"><a href={www} target="_blank" rel="noopener" class="text-accent-text hover:underline">{www.replace(/^https?:\/\//, '')}</a></dd>
					{/if}
					{#if prospect.branza}
						<dt class="text-ink-3">Branża</dt>
						<dd class="text-ink min-w-0">{prospect.branza}</dd>
					{/if}
					{#if zatrud}
						<dt class="text-ink-3">Zatrudnienie</dt>
						<dd class="text-ink">{zatrud} os.</dd>
					{/if}
					<dt class="text-ink-3">Dodano</dt>
					<dd class="text-ink">{fmtDzien(prospect.created_at.slice(0, 10), true)}</dd>
				</dl>
				{#if prospect.klient_id}
					<p class="px-5 mt-2 text-xs text-ink-3">Dane firmy są w kartotece — zmieniasz je w <a href="/clients/{prospect.klient_id}" class="font-semibold text-accent-text hover:underline">Panelu 360° klienta</a>.</p>
				{/if}
				{#if notatkiBezPol(prospect.notatki)}
					<p class="px-5 mt-2 text-[13px] text-ink-2 whitespace-pre-wrap line-clamp-4" title={notatkiBezPol(prospect.notatki)}>{notatkiBezPol(prospect.notatki)}</p>
				{/if}

				<div class="mt-4 px-5 pt-3 pb-4 border-t border-line-soft flex flex-col gap-2.5" data-testid="lead-poszukiwane">
					<div>
						<h3 class="text-[13px] font-semibold text-ink">Czego szuka</h3>
						<p class="text-xs text-ink-3">Kliknij, żeby zaznaczyć albo odznaczyć — zapisuje się od razu.</p>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each ZAINTERESOWANIA as k}
							{@const on = (prospect.zainteresowania ?? []).includes(k)}
							<button type="button" aria-pressed={on} disabled={zapisPoszukiwanych} onclick={() => przelaczPoszukiwane(k)} title={OPIS_ZAINTERESOWANIA[k]}
								class="h-7 px-2.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 {on ? 'bg-accent-soft border-accent text-accent-text' : 'bg-white border-line text-ink-2 hover:bg-surface-2'}">{ETYKIETA_ZAINTERESOWANIA[k]}</button>
						{/each}
					</div>
					<label class="flex flex-col gap-1 text-xs text-ink-3">
						Przychód roczny
						<input bind:value={fPrzychodInline} onblur={zapiszPrzychod} onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} placeholder="np. do 250 000 zł" data-testid="lead-przychod" class="h-8 border border-line rounded-lg px-2.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
					</label>
				</div>
			</section>

			<section aria-labelledby="lead-zadania-h" class={kartaCls} data-testid="lead-zadania">
				<div class="px-5 pt-4 pb-3 flex items-center gap-2">
					<h2 id="lead-zadania-h" class="flex-1 text-[15px] font-semibold text-ink">Zadania {#if otwarteZadania}<span class="ml-0.5 px-1.5 rounded-full bg-accent-soft text-accent-text text-xs font-semibold leading-5 tabular-nums">{otwarteZadania}</span>{/if}</h2>
					<button onclick={openNewTask} class="h-8 inline-flex items-center gap-1 px-2.5 text-[13px] font-semibold border border-line rounded-lg bg-white text-ink hover:bg-surface-2"><Plus size={14} /> Nowe</button>
				</div>
				{#if tasks.length === 0}
					<p class="px-5 pb-4 text-[13px] text-ink-3">Brak zadań — zaplanuj kolejny kontakt.</p>
				{:else}
					<ul class="border-t border-line-soft divide-y divide-line-soft">
						{#each tasks as t (t.id)}
							{@const done = t.status === 'zakonczone'}
							{@const overdue = isOverdue(t)}
							<li class="flex items-start gap-2.5 px-5 py-2.5 group {done ? 'opacity-60' : ''}">
								<button onclick={() => toggleTaskStatus(t)} aria-label={done ? 'Otwórz zadanie ponownie' : 'Oznacz jako zakończone'} class="shrink-0 mt-0.5 text-ink-3 hover:text-ok">
									{#if done}<CheckCircle2 size={16} class="text-ok" />{:else if t.status === 'w_toku'}<Clock size={16} class="text-accent" />{:else}<Circle size={16} />{/if}
								</button>
								<button onclick={() => openEditTask(t)} class="flex-1 min-w-0 text-left">
									<span class="flex items-center gap-1.5">
										<span aria-hidden="true" class="w-1.5 h-1.5 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
										<span class="text-[13px] font-medium text-ink truncate {done ? 'line-through' : ''}">{t.tytul}</span>
									</span>
									<span class="block text-xs {overdue ? 'text-danger font-semibold' : 'text-ink-3'}">
										{#if overdue}<AlertCircle size={11} class="inline -mt-px mr-0.5" />{/if}
										{t.termin ? fmtDzien(t.termin, true) : 'bez terminu'}{t.assigned_profile ? ` · ${t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}` : ''}{(t.typy ?? []).length ? ` · ${(t.typy ?? []).map((ty) => taskTypeLabels[ty] ?? ty).join(', ')}` : ''}
									</span>
								</button>
								<button onclick={() => deleteTask(t)} aria-label="Usuń zadanie" title="Usuń zadanie" class="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 flex items-center justify-center rounded text-ink-3 hover:text-danger hover:bg-danger-soft shrink-0"><Trash2 size={13} /></button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if zgloszenia.length || maileKampanii.length || prospect.data_zgloszenia}
				<section aria-labelledby="lead-zgl-h" class={kartaCls} data-testid="lead-zgloszenia">
					<div class="px-5 pt-4 pb-1">
						<h2 id="lead-zgl-h" class="text-[15px] font-semibold text-ink">{maZgloszenieUD ? 'Zgłoszenia i kampanie' : 'Zgłoszenia i maile kampanii'}</h2>
					</div>
					<div class="px-5 pb-3">
						<h3 class="mt-2 text-xs font-semibold text-ink-2">{maZgloszenieUD ? 'Z formularza i aplikacji' : 'Z formularza'} <span class="font-normal text-ink-3">{zgloszenia.length}</span></h3>
						{#if zgloszenia.length === 0}
							<p class="mt-1 text-[13px] text-ink-3">{prospect.data_zgloszenia ? `Zgłoszenie z ${fmtDzien(prospect.data_zgloszenia.slice(0, 10), true)} (z BEAUTY) — kolejne pojawią się tutaj.` : 'Brak zgłoszeń z formularza.'}</p>
						{:else}
							<ul>
								{#each wszystkieZgloszenia ? zgloszenia : zgloszenia.slice(0, 3) as z (z.id)}
									<li class="py-2 border-t border-line-soft first:border-t-0 text-[13px]">
										<div class="flex flex-wrap items-center gap-1.5">
											<span class="font-medium text-ink">{fmtDzien(z.zgloszono_at.slice(0, 10), true)}</span>
											{#if z.zrodlo === 'utrata_dochodu'}<span title="Wniosek złożony w aplikacji Utrata Dochodu" class="h-5 leading-5 px-1.5 rounded-full bg-surface-2 text-ink-2 text-[11px] font-semibold">aplikacja UD</span>{/if}
											{#if z.ponowne && !z.historyczne}<span class="h-5 leading-5 px-1.5 rounded-full bg-warn-soft text-warn text-[11px] font-semibold">ponowne</span>{/if}
											{#each posortujZainteresowania(z.zainteresowania) as k}
												<span title={OPIS_ZAINTERESOWANIA[k]} class="h-5 leading-5 px-1.5 rounded-full bg-accent-soft text-accent-text text-[11px] font-semibold">{ETYKIETA_ZAINTERESOWANIA[k] ?? k}</span>
											{/each}
										</div>
										{#if z.produkt || z.przychod || z.kontakt || z.telefon}
											<p class="text-xs text-ink-3">{[z.produkt, z.przychod ? `przychód ${z.przychod}` : null, z.kontakt, z.telefon].filter(Boolean).join(' · ')}</p>
										{/if}
									</li>
								{/each}
							</ul>
							{#if zgloszenia.length > 3}
								<button onclick={() => (wszystkieZgloszenia = !wszystkieZgloszenia)} class="text-xs font-semibold text-accent-text hover:underline">{wszystkieZgloszenia ? 'Pokaż mniej' : `Pokaż wszystkie (${zgloszenia.length})`}</button>
							{/if}
						{/if}
					</div>
					<div class="px-5 pt-1 pb-4 border-t border-line-soft">
						<h3 class="mt-2 text-xs font-semibold text-ink-2">Maile kampanii <span class="font-normal text-ink-3">{maileKampanii.length}</span></h3>
						{#if maileKampanii.length === 0}
							<p class="mt-1 text-[13px] text-ink-3">{prospect.klient_id ? 'Do tej firmy nie wysłano jeszcze maili kampanii.' : 'Maile kampanii widać dla firm z kartoteki.'}</p>
						{:else}
							<ul>
								{#each wszystkieMaile ? maileKampanii : maileKampanii.slice(0, 3) as m (m.id)}
									{@const st = stanMaila(m)}
									<li class="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 border-t border-line-soft first:border-t-0 text-[13px]">
										<span class="flex-1 min-w-0 truncate text-ink" title={m.temat ?? undefined}>{nazwaKampanii(m.kampania)}</span>
										<span class="text-xs text-ink-3 whitespace-nowrap">{m.wyslano_at ? fmtDzien(m.wyslano_at.slice(0, 10), true) : ''}</span>
										<span class="h-5 leading-5 px-1.5 rounded-full text-[11px] font-semibold {st.cls}">{st.tekst}</span>
									</li>
								{/each}
							</ul>
							{#if maileKampanii.length > 3}
								<button onclick={() => (wszystkieMaile = !wszystkieMaile)} class="text-xs font-semibold text-accent-text hover:underline">{wszystkieMaile ? 'Pokaż mniej' : `Pokaż wszystkie (${maileKampanii.length})`}</button>
							{/if}
						{/if}
					</div>
				</section>
			{/if}
		</aside>
	</div>

	<!-- Karta zadania: lead na sztywno; lead z kartoteki niesie też klienta (zadanie widać na obu kartach) -->
	<TaskModal
		open={showTaskForm}
		editingTask={editingTask}
		presetProspectId={prospect.id}
		presetProspectNazwa={prospect.nazwa}
		presetKlientId={prospect.klient_id ?? ''}
		presetKlientNazwa={prospect.crm_clients?.nazwa ?? prospect.nazwa}
		onclose={cancelTaskForm}
		onsaved={poZapisieZadania}
	/>

	<Modal title="Edytuj lead" open={editOpen} onclose={() => (editOpen = false)}>
		<div class="grid grid-cols-2 gap-3">
			{#if prospect.klient_id}
				<div class="col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
					<p class="font-semibold text-ink">{nazwaLeada}</p>
					<p class="text-xs text-ink-3">Nazwę, NIP, adres, telefon i e-mail zmieniasz w kartotece klienta — <a href="/clients/{prospect.klient_id}/edit" class="font-semibold text-accent-text hover:underline">edytuj klienta</a>.</p>
				</div>
			{:else}
				<div class="col-span-2"><label class={labelCls} for="lead-nazwa">Nazwa *</label><input id="lead-nazwa" bind:value={fNazwa} class={inputCls} /></div>
				<div><label class={labelCls} for="lead-nip">NIP</label><input id="lead-nip" bind:value={fNip} class={inputCls} /></div>
				<div><label class={labelCls} for="lead-tel">Telefon</label><input id="lead-tel" bind:value={fTelefon} class={inputCls} /></div>
				<div class="col-span-2"><label class={labelCls} for="lead-email">E-mail</label><input id="lead-email" bind:value={fEmail} type="email" class={inputCls} /></div>
				<div class="col-span-2"><label class={labelCls} for="lead-adres">Adres</label><input id="lead-adres" bind:value={fAdres} class={inputCls} /></div>
			{/if}
			<div><label class={labelCls} for="lead-branza">Branża</label><input id="lead-branza" bind:value={fBranza} class={inputCls} /></div>
			<div><label class={labelCls} for="lead-zatr">Zatrudnienie (os.)</label><input id="lead-zatr" type="number" bind:value={fZatrudnienie} class={inputCls} placeholder="liczba osób" min="0" /></div>
			<div class="col-span-2"><label class={labelCls} for="lead-notatki">Notatki</label><textarea id="lead-notatki" bind:value={fNotatki} rows="3" class={inputCls}></textarea></div>
			{#if editError}<p class="col-span-2 text-[13px] text-danger">{editError}</p>{/if}
		</div>
		{#snippet footer()}
			<button onclick={() => (editOpen = false)} class={przyciskCls}>Anuluj</button>
			<button onclick={saveEdit} disabled={saving} class={glownyCls}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
		{/snippet}
	</Modal>
{/if}
