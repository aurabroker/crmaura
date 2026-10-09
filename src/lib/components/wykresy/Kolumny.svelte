<script lang="ts">
	// Wykres kolumnowy jednej serii (np. przypis miesięcznie). Kolumna ≤ 24 px, zaokrąglony koniec,
	// podpisy tylko przy maksimum i ostatniej kolumnie, podpowiedź po najechaniu i z klawiatury.
	// Wartości są też w widoku tabeli na ekranie, który go używa — podpowiedź niczego nie ukrywa.
	import { KOLOR, etykietaOsi, liczba, podzialki, zl, type Kolumna } from '$lib/analityka';

	let {
		dane,
		pieniadze = true,
		wysokosc = 240,
		gora: goraZewn,
		opis,
		osY = true
	}: { dane: Kolumna[]; pieniadze?: boolean; wysokosc?: number; gora?: number; opis: string; osY?: boolean } = $props();

	const fmt = (v: number) => (pieniadze ? zl(v) : liczba(v));
	const skala = $derived(podzialki(goraZewn ?? Math.max(0, ...dane.map((d) => d.wartosc))));
	const maks = $derived(Math.max(0, ...dane.map((d) => d.wartosc)));
	const iMaks = $derived(dane.findIndex((d) => d.wartosc === maks && maks > 0));
	let aktywna = $state<number | null>(null);
	// Przy wielu kolumnach co druga etykieta osi X, żeby się nie zlewały.
	const coIle = $derived(dane.length > 16 ? 2 : 1);
	const wys = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / skala.gora) * 100));
</script>

<div role="group" aria-label={opis}>
	<div class="flex gap-2">
		{#if osY}
			<div aria-hidden="true" class="relative w-14 shrink-0" style="height: {wysokosc}px">
				{#each skala.kroki as t}
					<span class="absolute right-0 translate-y-1/2 text-xs text-ink-3 tabular-nums whitespace-nowrap" style="bottom: {(t / skala.gora) * 100}%">{etykietaOsi(t, pieniadze)}</span>
				{/each}
			</div>
		{/if}
		<div class="relative flex-1 min-w-0 border-b" style="height: {wysokosc}px; border-color: {KOLOR.os}">
			{#each skala.kroki.slice(1) as t}
				<span aria-hidden="true" class="absolute inset-x-0 h-px" style="bottom: {(t / skala.gora) * 100}%; background: {KOLOR.siatka}"></span>
			{/each}
			<div class="absolute inset-0 flex">
				{#each dane as d, i (d.klucz)}
					{@const h = wys(d.wartosc)}
					{@const nad = aktywna === i}
					<button
						type="button"
						aria-label="{d.pelna}: {fmt(d.wartosc)}{d.dodatek ? `, ${d.dodatek}` : ''}"
						onpointerenter={() => (aktywna = i)}
						onpointerleave={() => (aktywna = null)}
						onfocus={() => (aktywna = i)}
						onblur={() => (aktywna = null)}
						class="relative flex-1 h-full p-0 rounded-md cursor-default outline-offset-[-2px] {nad ? 'bg-accent/5' : ''}"
					>
						<span
							class="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t"
							style="height: {h}%; width: min(24px, calc(100% - 4px)); background: {d.jasna ? KOLOR.seriaJasna : nad ? '#1D44B3' : KOLOR.seria}"
						></span>
						{#if !nad && d.wartosc > 0 && (i === iMaks || i === dane.length - 1)}
							<span class="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-ink whitespace-nowrap" style="bottom: calc({h}% + 6px)">{pieniadze ? etykietaOsi(d.wartosc, true) : liczba(d.wartosc)}</span>
						{/if}
						{#if nad}
							<span
								role="tooltip"
								class="absolute z-20 min-w-[168px] px-2.5 py-2 rounded-lg bg-white shadow-[0_8px_24px_rgba(18,24,38,0.16),0_0_0_1px_rgba(18,24,38,0.08)] flex flex-col gap-0.5 text-left pointer-events-none {i > dane.length / 2 ? 'right-1' : 'left-1'}"
								style="bottom: calc({Math.min(h, 80)}% + 10px)"
							>
								<span class="text-[15px] font-semibold text-ink whitespace-nowrap">{fmt(d.wartosc)}</span>
								<span class="text-xs text-ink-2 whitespace-nowrap">{d.pelna}</span>
								{#if d.dodatek}<span class="text-xs text-ink-3 whitespace-nowrap">{d.dodatek}</span>{/if}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<div aria-hidden="true" class="flex gap-2 mt-1.5">
		{#if osY}<span class="w-14 shrink-0"></span>{/if}
		<div class="flex flex-1 min-w-0">
			{#each dane as d, i (d.klucz)}
				<span class="flex-1 text-center text-xs text-ink-3 truncate">{i % coIle === 0 ? d.etykieta : ''}</span>
			{/each}
		</div>
	</div>
</div>
