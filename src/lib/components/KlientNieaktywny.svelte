<script lang="ts">
	// Okno „Klient nieaktywny”: zakończenie / zawieszenie działalności albo rezygnacja z usług.
	// Razem z oznaczeniem można zakończyć aktywne polisy klienta (na koniec okresu albo od dnia) i zamknąć leada.
	import Modal from '$lib/components/Modal.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import { POWODY_NIEAKTYWNOSCI, nazwaRodzaju, nazwaTu, type TrybZakonczenia } from '$lib/statusPolisy';
	import { oznaczKlientaNieaktywnego, polisyDoZakonczenia, type WynikNieaktywnosci } from '$lib/zakonczenie';
	import { fmtDzien, odmiana, todayStr } from '$lib/utils';

	type Wynik = Extract<WynikNieaktywnosci, { ok: true }>;
	interface Props {
		/** Klient do oznaczenia; null = okno zamknięte. */
		client: Client | null;
		onclose: () => void;
		onzapisano?: (w: Wynik) => void;
	}
	let { client, onclose, onzapisano }: Props = $props();

	const dzis = todayStr();
	let powod = $state('zakonczenie_dzialalnosci');
	let od = $state(dzis);
	let notatka = $state('');
	let zakonczPolisy = $state(true);
	let trybPolis = $state<TrybZakonczenia>('koniec_okresu');
	let usunRaty = $state(true);
	let zamknijLeada = $state(true);
	let zapisuje = $state(false);
	let blad = $state('');

	const polisy = $derived(client ? polisyDoZakonczenia(appState.policies, client.id, dzis) : []);

	$effect(() => {
		if (!client) return;
		powod = 'zakonczenie_dzialalnosci';
		const gus = client.gus_wynik === 'zakonczona' ? client.gus_dane?.data_zakonczenia?.slice(0, 10) : null;
		od = gus && gus <= dzis ? gus : dzis;
		notatka = gus ? 'Według rejestru REGON (GUS) firma zakończyła działalność.' : '';
		zakonczPolisy = polisyDoZakonczenia(appState.policies, client.id, dzis).length > 0;
		trybPolis = 'koniec_okresu';
		usunRaty = true;
		zamknijLeada = true;
		blad = '';
	});

	async function zapisz() {
		if (!client) return;
		zapisuje = true; blad = '';
		const w = await oznaczKlientaNieaktywnego(client, { powod, od, notatka, zakonczPolisy, trybPolis, usunRaty, zamknijLeada }, dzis);
		zapisuje = false;
		if (!w.ok) { blad = w.message; return; }
		onzapisano?.(w);
		onclose();
	}

	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<Modal title="Klient nieaktywny — {client?.nazwa_skrocona ?? client?.nazwa ?? ''}" open={!!client} onclose={onclose}>
	{#snippet footer()}
		<button onclick={onclose} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={zapisz} disabled={zapisuje} data-testid="nieaktywny-zapisz" class="px-4 py-2 text-sm bg-ink text-white rounded-lg font-semibold hover:opacity-90 disabled:opacity-60">
			{zapisuje ? 'Zapisywanie...' : 'Oznacz jako nieaktywnego'}
		</button>
	{/snippet}
	{#if blad}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{blad}</div>{/if}
	{#if client}
		<div class="space-y-4" data-testid="klient-nieaktywny">
			<p class="text-sm text-ink-2">Klient nieaktywny znika z domyślnej listy klientów, nie dostaje wniosków o odnowienie ani przypomnień, a jego polisy nie trafiają do Odnowień. Dane i historia zostają.</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="nk-powod">Powód</label>
					<select id="nk-powod" bind:value={powod} class={inp}>
						{#each POWODY_NIEAKTYWNOSCI as p (p.val)}<option value={p.val}>{p.label}</option>{/each}
					</select>
				</div>
				<div>
					<label class={lbl} for="nk-od">Nieaktywny od</label>
					<input id="nk-od" type="date" bind:value={od} max={dzis} class={inp} />
				</div>
			</div>
			<div>
				<label class={lbl} for="nk-notatka">Notatka</label>
				<input id="nk-notatka" bind:value={notatka} class={inp} placeholder="np. informacja od klienta, data wykreślenia z CEIDG" />
			</div>

			<div class="rounded-lg border border-line p-3 space-y-2 text-sm">
				{#if polisy.length}
					<label class="flex items-start gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={zakonczPolisy} class="mt-0.5 w-4 h-4 accent-blue-600" />
						<span class="font-medium text-ink">Zakończ {odmiana(polisy.length, 'aktywną polisę klienta', 'aktywne polisy klienta', 'aktywnych polis klienta')}</span>
					</label>
					<ul class="pl-6 text-xs text-ink-2 space-y-0.5">
						{#each polisy as p (p.id)}
							<li><span class="font-mono">{p.nr_polisy}</span> · {nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)} · do {fmtDzien(p.data_do, true)}</li>
						{/each}
					</ul>
					{#if zakonczPolisy}
						<div class="pl-6 flex flex-col gap-1.5">
							<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tryb-polis" value="koniec_okresu" bind:group={trybPolis} class="accent-blue-600" /> na koniec okresu ubezpieczenia (nie odnawiamy)</label>
							<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="tryb-polis" value="od_dnia" bind:group={trybPolis} class="accent-blue-600" /> od dnia {fmtDzien(od, true)} (wypowiedzenie)</label>
							{#if trybPolis === 'od_dnia'}
								<label class="flex items-center gap-2 cursor-pointer text-ink-2"><input type="checkbox" bind:checked={usunRaty} class="w-4 h-4 accent-blue-600" /> usuń nieopłacone raty z terminem po dniu zakończenia</label>
							{/if}
						</div>
					{/if}
				{:else}
					<p class="text-ink-2">Klient nie ma aktywnych polis do zakończenia.</p>
				{/if}
				<label class="flex items-center gap-2 cursor-pointer pt-1 border-t border-line-soft">
					<input type="checkbox" bind:checked={zamknijLeada} class="w-4 h-4 accent-blue-600" />
					<span>Lead klienta w Sprzedaży (jeśli jest) oznacz jako przegrany</span>
				</label>
			</div>
		</div>
	{/if}
</Modal>
