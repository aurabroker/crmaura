<script lang="ts">
	// „Wyślij polisę klientowi” z karty polisy: polisa z programu — treść z szablonu Resend programu (Beauty Polisa);
	// każda inna — ogólny szablon „polisa-wystawiona” z Resend firmy albo wbudowana treść CRM. Dane polisy
	// podstawia serwer, w załącznikach PDF polisy i OWU z magazynu. Przed wysyłką podgląd dokładnie tego, co dostanie klient.
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { fmtDzien } from '$lib/utils';
	import {
		RODZAJ_PLIKU, kontekstMailaPolisy, podgladMailaPolisy, rozmiar, wyslijMailPolisy,
		type KontekstMailaPolisy, type PodgladMailaPolisy
	} from '$lib/plikiPolis';
	import { AlertTriangle, Eye, Paperclip, Send } from 'lucide-svelte';

	let { open, polisaId, onclose, onwyslano }: { open: boolean; polisaId: string; onclose: () => void; onwyslano: () => void } = $props();

	let ktx = $state<KontekstMailaPolisy | null>(null);
	let wczytywanie = $state(false);
	let blad = $state('');
	let wybrani = $state(new Set<string>());
	let powitanie = $state('');
	let termin = $state('');
	let pliki = $state(new Set<string>());
	let podglad = $state<PodgladMailaPolisy | null>(null);
	let pracuje = $state<'' | 'podglad' | 'wysylka'>('');

	async function wczytaj(id: string) {
		wczytywanie = true;
		blad = '';
		podglad = null;
		try {
			const k = await kontekstMailaPolisy(id);
			if (id !== polisaId) return;
			ktx = k;
			wybrani = new Set(k.domyslne.do);
			powitanie = k.domyslne.powitanie;
			termin = k.domyslne.termin_platnosci ?? '';
			pliki = new Set(k.domyslne.pliki);
		} catch (e) {
			ktx = null;
			blad = (e as Error).message;
		} finally {
			wczytywanie = false;
		}
	}
	$effect(() => {
		if (open) untrack(() => void wczytaj(polisaId));
	});

	const zadanie = () => ({ do: [...wybrani], powitanie, termin_platnosci: termin, pliki: [...pliki] });
	// Polisa bez informacji o płatnościach (np. Leadenhall): mail bez składki i terminu, więc termin nie jest potrzebny.
	const bezPlatnosci = $derived(!!ktx?.bez_info_platnosci);
	const gotowe = $derived(!!ktx && wybrani.size > 0 && powitanie.trim().length > 0 && (bezPlatnosci || /^\d{4}-\d{2}-\d{2}$/.test(termin)) && pliki.size > 0 && !pracuje);

	function przelacz(zbior: Set<string>, v: string): Set<string> {
		const n = new Set(zbior);
		if (n.has(v)) n.delete(v);
		else n.add(v);
		podglad = null;
		return n;
	}

	async function pokazPodglad() {
		if (!gotowe) return;
		pracuje = 'podglad';
		blad = '';
		try {
			podglad = await podgladMailaPolisy(polisaId, zadanie());
		} catch (e) {
			blad = (e as Error).message;
		} finally {
			pracuje = '';
		}
	}

	async function wyslij() {
		if (!gotowe || !ktx) return;
		if (ktx.wyslane.length) {
			const ok = await askConfirm({
				title: 'Wysłać polisę jeszcze raz?',
				message: `Ta polisa była już wysłana ${fmtDzien(ktx.wyslane[0].wyslano_at.slice(0, 10), true)} na ${ktx.wyslane[0].adres}.`,
				confirmLabel: 'Wyślij ponownie'
			});
			if (!ok) return;
		}
		pracuje = 'wysylka';
		blad = '';
		try {
			const w = await wyslijMailPolisy(polisaId, zadanie());
			ctxToast(`Wysłano polisę: ${w.adresy.join(', ')}`);
			onwyslano();
			onclose();
		} catch (e) {
			blad = (e as Error).message;
		} finally {
			pracuje = '';
		}
	}

	const DOSTAWA: Record<string, string> = {
		wyslany: 'wysłany', opozniony: 'opóźniony', dostarczony: 'dostarczony', otwarty: 'otwarty', klikniety: 'kliknięty', odbity: 'odbity', spam: 'oznaczony jako spam', blad: 'błąd'
	};
</script>

<Modal title="Wyślij polisę klientowi{ktx ? ` — ${ktx.polisa.nr_polisy}` : ''}" {open} {onclose} windowed>
	{#snippet footer()}
		<button onclick={onclose} class="mr-auto px-4 py-2 text-sm border border-line rounded-lg text-ink-2 hover:bg-surface-2">Anuluj</button>
		<button onclick={pokazPodglad} disabled={!gotowe} class="flex items-center gap-1.5 px-4 py-2 text-sm border border-line rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-50">
			<Eye size={15} /> {pracuje === 'podglad' ? 'Wczytywanie…' : 'Podgląd'}
		</button>
		<button onclick={wyslij} disabled={!gotowe} class="flex items-center gap-1.5 px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-50">
			<Send size={15} /> {pracuje === 'wysylka' ? 'Wysyłanie…' : 'Wyślij'}
		</button>
	{/snippet}

	<div class="flex flex-col gap-4 text-sm">
		{#if blad}<p class="text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}
		{#if wczytywanie}
			<p class="text-[13px] text-ink-3 py-6 text-center">Wczytywanie…</p>
		{:else if ktx}
			{#if ktx.wyslane.length}
				<p class="flex items-start gap-2 text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2">
					<AlertTriangle size={15} class="shrink-0 mt-0.5" />
					<span>
						Polisa była już wysłana:
						{#each ktx.wyslane.slice(0, 3) as w, i}{i ? '; ' : ' '}{fmtDzien(w.wyslano_at.slice(0, 10), true)} na {w.adres}{w.dostawa ? ` (${DOSTAWA[w.dostawa] ?? w.dostawa})` : ''}{/each}.
					</span>
				</p>
			{/if}

			<fieldset>
				<legend class="text-[13px] font-semibold text-ink mb-1.5">Do</legend>
				{#if ktx.adresy.length === 0}
					<p class="text-[13px] text-ink-3">Klient nie ma adresu e-mail. Dodaj go w danych klienta albo przy osobie kontaktowej.</p>
				{:else}
					<div class="flex flex-col gap-1">
						{#each ktx.adresy as a (a.adres)}
							<label class="flex items-center gap-2 cursor-pointer min-w-0">
								<input type="checkbox" checked={wybrani.has(a.adres)} onchange={() => (wybrani = przelacz(wybrani, a.adres))} class="w-4 h-4 accent-accent shrink-0" />
								<span class="text-ink truncate">{a.adres}</span>
								<span class="text-xs text-ink-3 truncate min-w-0">{a.opis}</span>
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>

			<div class="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
				<label class="block">
					<span class="block text-[13px] font-semibold text-ink mb-1.5">Powitanie</span>
					<input bind:value={powitanie} oninput={() => (podglad = null)} maxlength="120" placeholder="np. Szanowna Pani Anno" class="w-full h-9 px-3 border border-line rounded-lg text-sm focus:outline-none focus:border-accent" />
					<span class="block text-xs text-ink-3 mt-1">Pierwsza linia maila — przecinek dopisze szablon.</span>
				</label>
				{#if bezPlatnosci}
					<p class="text-[13px] text-ink-2 self-end pb-2" data-testid="mail-bez-platnosci">Bez składki i terminu płatności: polisa ma zaznaczone „Nie wysyłaj klientowi informacji o płatnościach”.</p>
				{:else}
					<label class="block">
						<span class="block text-[13px] font-semibold text-ink mb-1.5">Termin płatności składki</span>
						<input type="date" bind:value={termin} oninput={() => (podglad = null)} class="w-full h-9 px-2.5 border border-line rounded-lg text-sm focus:outline-none focus:border-accent" />
					</label>
				{/if}
			</div>

			<p class="text-[13px] text-ink-2">
				Okres ochrony w mailu: <strong>{fmtDzien(ktx.polisa.data_od, true)} – {fmtDzien(ktx.polisa.data_do, true)}</strong> (z karty polisy).
			</p>

			<fieldset>
				<legend class="flex items-center gap-1.5 text-[13px] font-semibold text-ink mb-1.5"><Paperclip size={14} /> Załącznik</legend>
				{#if ktx.pliki.length === 0}
					<p class="text-[13px] text-ink-3">Polisa nie ma zapisanego PDF — dodaj go w sekcji „Dokumenty”.</p>
				{:else}
					<div class="flex flex-col gap-1">
						{#each ktx.pliki as f (f.id)}
							<label class="flex items-center gap-2 cursor-pointer min-w-0">
								<input type="checkbox" checked={pliki.has(f.id)} onchange={() => (pliki = przelacz(pliki, f.id))} class="w-4 h-4 accent-accent shrink-0" />
								<span class="text-ink truncate">{f.nazwa}</span>
								<span class="text-xs text-ink-3 whitespace-nowrap">{RODZAJ_PLIKU[f.rodzaj]}{f.zUmowy ? ' z umowy generalnej' : ''} · {rozmiar(f.rozmiar)}</span>
							</label>
						{/each}
					</div>
				{/if}
				{#if ktx.ogolny}
					<p class="text-xs text-ink-3 mt-1.5">OWU dołączasz jako załącznik — z tej polisy albo z jej Umowy Generalnej (najwyżej 3 pliki, razem do 20 MB). Jeśli OWU nie ma na liście, dodaj je w sekcji „Dokumenty” jako plik typu OWU.</p>
				{:else}
					<p class="text-xs text-ink-3 mt-1.5">Pozostałe dokumenty programu (OWU, RODO, pełnomocnictwo…) są w treści maila jako linki.</p>
				{/if}
			</fieldset>

			{#if podglad}
				<div class="border-t border-line-soft pt-3 flex flex-col gap-2">
					<p class="text-[13px]"><span class="text-ink-3">Temat:</span> <strong class="text-ink">{podglad.temat}</strong></p>
					<p class="text-xs text-ink-3">Od: {podglad.od}{podglad.odpowiedz ? ` · odpowiedzi na ${podglad.odpowiedz}` : ''} · załącznik: {podglad.zalaczniki.map((z) => z.nazwa).join(', ')}</p>
					<iframe title="Podgląd maila" sandbox="" srcdoc={podglad.html} class="w-full h-[440px] border border-line rounded-lg bg-white"></iframe>
				</div>
			{:else}
				<p class="text-xs text-ink-3 border-t border-line-soft pt-3" data-testid="opis-szablonu">
					{#if bezPlatnosci}
						Treść maila: wbudowany szablon CRM bez składki i terminu płatności (polisa, towarzystwo, okres, załączniki) — kwota w CRM różni się od tej, którą płaci klient.
					{:else if ktx.ogolny}
						Treść maila: wbudowany szablon CRM (polisa, towarzystwo, okres, składka, termin płatności, załączniki). Jeśli na koncie Resend firmy jest opublikowany szablon „{ktx.szablon}”, CRM użyje jego treści — zmienne: POWITANIE, NR_POLISY, RODZAJ, TU, PRZEDMIOT, OKRES_OD, OKRES_DO, SKLADKA, TERMIN_PLATNOSCI, KLIENT, DORADCA, FIRMA, OWU.
					{:else}
						Treść maila pochodzi z szablonu „{ktx.szablon}” w Resend — zmieniasz ją w Resend (po zmianie opublikuj szablon).
					{/if}
					Kliknij „Podgląd”, żeby zobaczyć mail z danymi tej polisy.
				</p>
			{/if}
		{/if}
	</div>
</Modal>
