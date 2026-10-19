<script lang="ts">
	// Komunikat „Klient po raz kolejny prosi o ofertę”: nieodczytane ponowne zgłoszenia z formularza (crm_zgloszenia).
	// Widzi go opiekun klienta (albo opiekun leada), a gdy firma nie ma opiekuna — każdy; administrator widzi wszystkie.
	// Sprawdzane co minutę i po powrocie do karty. „Później” chowa okno na 30 minut, „Odczytane” zamyka zgłoszenia.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState, isAdmin } from '$lib/stores/app.svelte';
	import { ETYKIETA_ZAINTERESOWANIA, OPIS_ZAINTERESOWANIA, posortujZainteresowania, type Zgloszenie } from '$lib/sprzedaz';
	import { fmtDzien, odmiana } from '$lib/utils';
	import { BellRing, Phone, X } from 'lucide-svelte';

	type Wiersz = Zgloszenie & {
		crm_clients: { nazwa: string; nazwa_skrocona: string | null; opiekun_id: string | null } | null;
		crm_prospects: { broker_id: string | null } | null;
	};

	const ODLOZ_KLUCZ = 'zgloszenia:odlozone-do';
	const POKAZ = 3;

	let wiersze = $state<Wiersz[]>([]);
	let odlozoneDo = $state(0);
	let zapis = $state(false);

	const moje = $derived.by(() => {
		const ja = appState.profile?.id;
		if (!ja) return [];
		if (isAdmin(appState.profile)) return wiersze;
		return wiersze.filter((w) => {
			const opiekunowie = [w.crm_clients?.opiekun_id, w.crm_prospects?.broker_id].filter(Boolean);
			return opiekunowie.length === 0 || opiekunowie.includes(ja);
		});
	});
	// Kilka zgłoszeń tej samej firmy pokazujemy raz (najnowsze).
	const firmy = $derived.by(() => {
		const poKliencie = new Map<string, Wiersz>();
		for (const w of moje) {
			const k = w.klient_id ?? w.id;
			const byl = poKliencie.get(k);
			if (!byl || byl.zgloszono_at < w.zgloszono_at) poKliencie.set(k, w);
		}
		return [...poKliencie.values()].sort((a, b) => b.zgloszono_at.localeCompare(a.zgloszono_at));
	});
	const widoczne = $derived(firmy.length > 0 && Date.now() >= odlozoneDo);

	$effect(() => {
		appState.ponowneZgloszenia = firmy.length;
	});

	async function wczytaj() {
		if (!appState.profile) return;
		const { data, error } = await sb
			.from('crm_zgloszenia')
			.select('id, klient_id, prospect_id, zrodlo, zgloszono_at, firma, kontakt, email, telefon, produkt, zainteresowania, przychod, ponowne, poprzednie_at, poprzednie_typ, historyczne, odczytane_at, crm_clients(nazwa, nazwa_skrocona, opiekun_id), crm_prospects(broker_id)')
			.eq('ponowne', true)
			.is('odczytane_at', null)
			.order('zgloszono_at', { ascending: false })
			.limit(50);
		// Przed wdrożeniem migracji tabeli może nie być — komunikat po prostu się nie pokazuje.
		if (!error) wiersze = (data ?? []) as unknown as Wiersz[];
	}

	async function oznacz(ids: string[]) {
		if (!ids.length) return;
		zapis = true;
		const { error } = await sb
			.from('crm_zgloszenia')
			.update({ odczytane_at: new Date().toISOString(), odczytal: appState.profile?.id ?? null } as never)
			.in('id', ids);
		zapis = false;
		if (!error) wiersze = wiersze.filter((w) => !ids.includes(w.id));
	}

	// Otwarcie klienta zamyka wszystkie jego nieodczytane zgłoszenia.
	async function otworz(w: Wiersz) {
		const ids = moje.filter((x) => (x.klient_id ?? x.id) === (w.klient_id ?? w.id)).map((x) => x.id);
		await oznacz(ids);
		if (w.klient_id) goto(`/clients/${w.klient_id}`);
		else if (w.prospect_id) goto(`/prospects/${w.prospect_id}`);
	}

	function pozniej() {
		odlozoneDo = Date.now() + 30 * 60 * 1000;
		try { sessionStorage.setItem(ODLOZ_KLUCZ, String(odlozoneDo)); } catch { /* bez pamięci — tylko do odświeżenia strony */ }
	}

	function kiedy(at: string): string {
		const min = Math.round((Date.now() - new Date(at).getTime()) / 60000);
		if (min < 1) return 'przed chwilą';
		if (min < 60) return `${min} min temu`;
		if (min < 24 * 60) return `${Math.floor(min / 60)} godz. temu`;
		return fmtDzien(at.slice(0, 10), true);
	}

	onMount(() => {
		try { odlozoneDo = Number(sessionStorage.getItem(ODLOZ_KLUCZ) ?? 0) || 0; } catch { /* brak dostępu do pamięci sesji */ }
		void wczytaj();
		const co = setInterval(() => {
			if (document.visibilityState === 'visible') void wczytaj();
			// Po upływie „Później” okno wraca samo.
			if (odlozoneDo && Date.now() >= odlozoneDo) odlozoneDo = 0;
		}, 60_000);
		const naPowrot = () => { if (document.visibilityState === 'visible') void wczytaj(); };
		document.addEventListener('visibilitychange', naPowrot);
		return () => { clearInterval(co); document.removeEventListener('visibilitychange', naPowrot); };
	});
</script>

{#if widoczne}
	<div
		role="region"
		aria-live="polite"
		aria-label="Ponowne zgłoszenia klientów"
		class="fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:w-[400px] bg-white border border-line rounded-xl shadow-2xl overflow-hidden"
	>
		<div class="flex items-start gap-3 px-4 pt-3.5 pb-2.5 bg-warn-soft border-b border-line-soft">
			<BellRing size={18} class="text-warn shrink-0 mt-0.5" aria-hidden="true" />
			<div class="flex-1 min-w-0">
				<p class="text-sm font-semibold text-ink">Klient po raz kolejny prosi o ofertę</p>
				{#if firmy.length > 1}<p class="text-xs text-ink-2">{odmiana(firmy.length, 'firma czeka', 'firmy czekają', 'firm czeka')} na kontakt</p>{/if}
			</div>
			<button onclick={pozniej} aria-label="Przypomnij później" title="Przypomnij za 30 minut" class="w-7 h-7 -mr-1.5 -mt-1 flex items-center justify-center rounded-lg text-ink-2 hover:bg-white/60"><X size={16} /></button>
		</div>
		<ul class="max-h-[50vh] overflow-y-auto">
			{#each firmy.slice(0, POKAZ) as w (w.id)}
				{@const nazwa = w.crm_clients?.nazwa_skrocona ?? w.crm_clients?.nazwa ?? w.firma ?? 'Klient'}
				<li class="px-4 py-3 border-t border-line-soft first:border-t-0">
					<div class="flex items-baseline gap-2">
						<button onclick={() => otworz(w)} class="flex-1 min-w-0 text-left text-sm font-semibold text-accent-text hover:underline truncate">{nazwa}</button>
						<span class="text-xs text-ink-3 whitespace-nowrap">{kiedy(w.zgloszono_at)}</span>
					</div>
					<div class="flex flex-wrap items-center gap-1.5 mt-1.5">
						{#each posortujZainteresowania(w.zainteresowania) as k}
							<span title={OPIS_ZAINTERESOWANIA[k]} class="h-[22px] leading-[22px] px-2 rounded-full bg-accent-soft text-accent-text text-xs font-semibold">{ETYKIETA_ZAINTERESOWANIA[k] ?? k}</span>
						{:else}
							{#if w.produkt}<span class="text-xs text-ink-2">{w.produkt}</span>{/if}
						{/each}
						{#if w.przychod}<span class="text-xs text-ink-2">· przychód {w.przychod}</span>{/if}
					</div>
					<p class="mt-1 text-xs text-ink-2">
						{#if w.poprzednie_at}{w.poprzednie_typ === 'kartoteka' ? 'W kartotece od' : 'Poprzednie zgłoszenie'}: {fmtDzien(w.poprzednie_at.slice(0, 10), true)}{/if}
						{#if w.kontakt}{w.poprzednie_at ? ' · ' : ''}{w.kontakt}{/if}
						{#if w.zrodlo === 'utrata_dochodu'}{w.poprzednie_at || w.kontakt ? ' · ' : ''}wniosek w aplikacji Utrata Dochodu{/if}
					</p>
					<div class="flex flex-wrap items-center gap-2 mt-2">
						<button onclick={() => otworz(w)} disabled={zapis} class="h-8 px-3 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover disabled:opacity-60">Otwórz klienta</button>
						{#if w.telefon}
							<a href="tel:{w.telefon}" class="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-line text-[13px] font-medium text-ink hover:bg-surface-2"><Phone size={14} aria-hidden="true" /> {w.telefon}</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		<div class="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-line-soft bg-surface-2">
			{#if firmy.length > POKAZ}
				<a href="/prospects" onclick={pozniej} class="text-[13px] font-semibold text-accent-text hover:underline">i {firmy.length - POKAZ} kolejne w Leadach →</a>
			{/if}
			<button onclick={() => oznacz(moje.map((w) => w.id))} disabled={zapis} class="ml-auto h-8 px-3 rounded-lg border border-line bg-white text-[13px] font-medium text-ink hover:bg-surface-2 disabled:opacity-60">Oznacz jako odczytane</button>
		</div>
	</div>
{/if}
