<script lang="ts">
	// Okno „Zakończ polisę”: wypowiedzenie od dnia albo brak odnowienia na koniec okresu ubezpieczenia.
	// Zapis robi $lib/zakonczenie (decyzja, porządek w ratach i wnioskach o odnowienie, pamięć CRM).
	import Modal from '$lib/components/Modal.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import type { Policy } from '$lib/types/database';
	import { POWODY_ZAKONCZENIA, nazwaRodzaju, nazwaTu, plusDni, type TrybZakonczenia } from '$lib/statusPolisy';
	import { czyAktywny } from '$lib/components/renewal/crmRenewals';
	import { dataZakonczenia, ratyPoZakonczeniu, walidujZakonczenie, zakonczPolise, type WynikZakonczenia } from '$lib/zakonczenie';
	import { fmtDzien, fmtPln, odmiana, todayStr } from '$lib/utils';

	type Wynik = Extract<WynikZakonczenia, { ok: true }>;
	interface Props {
		/** Polisa do zakończenia; null = okno zamknięte. */
		policy: Policy | null;
		onclose: () => void;
		onzakonczono?: (w: Wynik) => void;
		trybDomyslny?: TrybZakonczenia;
		powodDomyslny?: string;
	}
	let { policy, onclose, onzakonczono, trybDomyslny, powodDomyslny }: Props = $props();

	const dzis = todayStr();
	let tryb = $state<TrybZakonczenia>('od_dnia');
	let data = $state('');
	let powod = $state('');
	let notatka = $state('');
	let usunRaty = $state(true);
	let zapisuje = $state(false);
	let blad = $state('');

	$effect(() => {
		if (!policy) return;
		const poOkresie = !!policy.data_do && policy.data_do < dzis;
		tryb = trybDomyslny ?? (poOkresie ? 'koniec_okresu' : 'od_dnia');
		let d = dzis;
		if (policy.data_od && d <= policy.data_od) d = plusDni(policy.data_od, 1);
		if (policy.data_do && d > policy.data_do) d = policy.data_do;
		data = d;
		powod = powodDomyslny ?? (poOkresie ? 'brak_odnowienia' : 'wypowiedzenie_klienta');
		notatka = '';
		usunRaty = true;
		blad = '';
	});

	const zakonczonaOd = $derived(policy ? dataZakonczenia(policy, { tryb, data }) : null);
	const raty = $derived(policy && zakonczonaOd ? ratyPoZakonczeniu(appState.payments, policy.id, zakonczonaOd) : []);
	const sumaRat = $derived(raty.reduce((s, r) => s + Number(r.kwota ?? 0), 0));
	const aktywneWnioski = $derived(policy ? appState.wnioskiOdnowien.filter((w) => w.polisa_id === policy!.id && czyAktywny(w.status)).length : 0);
	const uwaga = $derived(policy ? walidujZakonczenie(policy, { tryb, data, powod }) : '');

	async function zapisz() {
		if (!policy) return;
		if (uwaga) { blad = uwaga; return; }
		zapisuje = true; blad = '';
		const w = await zakonczPolise(policy, { tryb, data, powod, notatka, usunRaty });
		zapisuje = false;
		if (!w.ok) { blad = w.message; return; }
		onzakonczono?.(w);
		onclose();
	}

	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<Modal title="Zakończ polisę {policy?.nr_polisy ?? ''}" open={!!policy} onclose={onclose}>
	{#snippet footer()}
		<button onclick={onclose} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={zapisz} disabled={zapisuje || !!uwaga} data-testid="zakoncz-zapisz" class="px-4 py-2 text-sm bg-ink text-white rounded-lg font-semibold hover:opacity-90 disabled:opacity-60">
			{zapisuje ? 'Zapisywanie...' : tryb === 'koniec_okresu' ? 'Zakończ na koniec okresu' : 'Zakończ od dnia'}
		</button>
	{/snippet}
	{#if blad}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{blad}</div>{/if}
	{#if policy}
		<div class="space-y-4" data-testid="zakoncz-polise">
			<div class="bg-slate-50 rounded-lg p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
				<div><span class="text-slate-500">Klient:</span> <strong>{policy.crm_clients?.nazwa ?? '—'}</strong></div>
				<div><span class="text-slate-500">TU:</span> <strong>{nazwaTu(policy)}</strong></div>
				<div><span class="text-slate-500">Rodzaj:</span> <strong>{nazwaRodzaju(policy.rodzaj) || '—'}</strong></div>
				<div><span class="text-slate-500">Okres:</span> <strong>{fmtDzien(policy.data_od, true)} – {policy.data_do ? fmtDzien(policy.data_do, true) : 'bezterminowo'}</strong></div>
			</div>

			<fieldset>
				<legend class={lbl}>Jak kończymy</legend>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer {tryb === 'od_dnia' ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-slate-50'}">
						<input type="radio" name="tryb" value="od_dnia" bind:group={tryb} class="mt-1 accent-blue-600" />
						<span class="min-w-0">
							<span class="block text-sm font-semibold text-ink">Od dnia</span>
							<span class="block text-xs text-ink-3 mb-2">wypowiedzenie, sprzedaż przedmiotu, zmiana brokera — ochrona kończy się przed terminem</span>
							<input type="date" aria-label="Pierwszy dzień bez ochrony" bind:value={data} disabled={tryb !== 'od_dnia'} min={policy.data_od ? plusDni(policy.data_od, 1) : undefined} max={policy.data_do ?? undefined} class="{inp} disabled:opacity-50" />
						</span>
					</label>
					<label class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer {tryb === 'koniec_okresu' ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-slate-50'} {policy.data_do ? '' : 'opacity-50'}">
						<input type="radio" name="tryb" value="koniec_okresu" bind:group={tryb} disabled={!policy.data_do} class="mt-1 accent-blue-600" />
						<span class="min-w-0">
							<span class="block text-sm font-semibold text-ink">Na koniec okresu ubezpieczenia</span>
							<span class="block text-xs text-ink-3">{policy.data_do ? `ochrona do ${fmtDzien(policy.data_do, true)} — polisy nie odnawiamy` : 'polisa bezterminowa — brak końca okresu'}</span>
						</span>
					</label>
				</div>
			</fieldset>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="zak-powod">Powód</label>
					<select id="zak-powod" bind:value={powod} class={inp}>
						{#each POWODY_ZAKONCZENIA as p (p.val)}<option value={p.val}>{p.label}</option>{/each}
					</select>
				</div>
				<div>
					<label class={lbl} for="zak-notatka">Notatka</label>
					<input id="zak-notatka" bind:value={notatka} class={inp} placeholder="np. pismo klienta z 12.10, nr sprawy w TU" />
				</div>
			</div>

			<div class="text-sm rounded-lg border border-line p-3 space-y-2">
				{#if raty.length}
					<label class="flex items-start gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={usunRaty} class="mt-0.5 w-4 h-4 accent-blue-600" />
						<span>Usuń {odmiana(raty.length, 'nieopłaconą ratę', 'nieopłacone raty', 'nieopłaconych rat')} z terminem od {zakonczonaOd ? fmtDzien(zakonczonaOd, true) : '—'} ({fmtPln(sumaRat)} zł) — po zakończeniu nie są należne.</span>
					</label>
				{:else}
					<p class="text-ink-2">Brak nieopłaconych rat po dniu zakończenia — płatności zostają bez zmian.</p>
				{/if}
				{#if aktywneWnioski}
					<p class="text-warn font-medium">Aktywny wniosek o odnowienie zostanie anulowany (link klienta przestanie działać).</p>
				{/if}
				<p class="text-xs text-ink-3">Polisa znika z Odnowień i z automatu wniosków. Decyzję można cofnąć na karcie polisy (usunięte raty nie wracają same).</p>
			</div>
			{#if uwaga}<p class="text-sm text-warn">{uwaga}</p>{/if}
		</div>
	{/if}
</Modal>
