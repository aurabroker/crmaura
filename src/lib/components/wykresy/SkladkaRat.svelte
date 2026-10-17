<script lang="ts">
	// Składka z rat miesięcznie (pulpit): kolumna = składka rat z terminem w miesiącu, podzielona na zainkasowaną
	// (dół, kolor akcentu) i do zapłaty (góra, jaśniejszy stopień tej samej barwy). W tej samej kolumnie, węższym
	// słupkiem w drugim kolorze — prowizja z tych rat; pod miesiącem jej kwota i średnia stawka (prowizja / składka).
	// Podpowiedź po najechaniu i z klawiatury; pełne liczby w aria-label każdej kolumny.
	import { KOLOR, etykietaOsi, podzialki, proc, zl, miesiacKrotko, miesiacPelny } from '$lib/analityka';
	import type { MiesiacRat } from '$lib/rozliczenia';

	let { dane, opis, wysokosc = 200 }: { dane: MiesiacRat[]; opis: string; wysokosc?: number } = $props();

	const skala = $derived(podzialki(Math.max(0, ...dane.map((d) => d.skladka))));
	const maks = $derived(Math.max(0, ...dane.map((d) => d.skladka)));
	const iMaks = $derived(dane.findIndex((d) => d.skladka === maks && maks > 0));
	const kilkaLat = $derived(new Set(dane.map((d) => d.ym.slice(0, 4))).size > 1);
	let aktywna = $state<number | null>(null);
	let szerokosc = $state(0);
	// Wąskie kolumny (telefon): podpisy co drugi albo co trzeci miesiąc i bez roku, żeby się nie zlewały.
	// Przed pomiarem szerokości (SSR, pierwsza klatka) — pełne podpisy.
	const krok = $derived(dane.length && szerokosc ? szerokosc / dane.length : 999);
	const coIle = $derived(krok < 30 ? 3 : krok < 46 ? 2 : 1);
	const zRokiem = $derived(kilkaLat && krok >= 46);
	const wys = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / skala.gora) * 100));
	const stawka = (d: MiesiacRat) => (d.stawka == null ? '—' : proc(d.stawka, 0));
	const etykietaKolumny = (d: MiesiacRat) =>
		`${miesiacPelny(d.ym)}: składka rat ${zl(d.skladka)}, zainkasowano ${zl(d.zainkasowana)} (${d.ratRozliczonych} z ${d.rat} rat), prowizja ${zl(d.prowizja)} — średnio ${stawka(d)}`;
</script>

<div role="group" aria-label={opis} class="flex flex-col gap-1">
	<div class="flex gap-2">
		<div aria-hidden="true" class="relative w-12 shrink-0" style="height: {wysokosc}px">
			{#each skala.kroki as t}
				<span class="absolute right-0 translate-y-1/2 text-xs text-ink-3 tabular-nums whitespace-nowrap" style="bottom: {(t / skala.gora) * 100}%">{etykietaOsi(t, true)}</span>
			{/each}
		</div>
		<div class="relative flex-1 min-w-0 border-b" style="height: {wysokosc}px; border-color: {KOLOR.os}" bind:clientWidth={szerokosc}>
			{#each skala.kroki.slice(1) as t}
				<span aria-hidden="true" class="absolute inset-x-0 h-px" style="bottom: {(t / skala.gora) * 100}%; background: {KOLOR.siatka}"></span>
			{/each}
			<div class="absolute inset-0 flex">
				{#each dane as d, i (d.ym)}
					{@const h = wys(d.skladka)}
					{@const hz = wys(d.zainkasowana)}
					{@const hp = wys(d.prowizja)}
					{@const nad = aktywna === i}
					<button
						type="button"
						aria-label={etykietaKolumny(d)}
						onpointerenter={() => (aktywna = i)}
						onpointerleave={() => (aktywna = null)}
						onfocus={() => (aktywna = i)}
						onblur={() => (aktywna = null)}
						class="relative flex-1 min-w-0 h-full p-0 rounded-md cursor-default outline-offset-[-2px] {nad ? 'bg-accent/5' : ''}"
					>
						{#if d.skladka > 0}
							<!-- Składka rat: do zapłaty (jaśniejszy) nad zainkasowaną; 2 px przerwy między częściami. -->
							<span class="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col justify-end" style="height: {h}%; width: min(26px, calc(100% - 4px))">
								{#if d.skladka > d.zainkasowana}
									<span class="w-full flex-1 rounded-t" style="background: {KOLOR.seriaJasna}; opacity: {nad ? 1 : 0.9}"></span>
								{/if}
								{#if d.zainkasowana > 0}
									<span class="w-full shrink-0 {d.skladka > d.zainkasowana ? 'mt-[2px]' : 'rounded-t'}" style="height: {(hz / h) * 100}%; background: {nad ? '#1D44B3' : KOLOR.seria}"></span>
								{/if}
							</span>
							<!-- Prowizja z rat miesiąca: węższy słupek w tej samej kolumnie, z białą obwódką na tle składki. -->
							{#if d.prowizja > 0}
								<span class="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t ring-2 ring-white" style="height: {hp}%; width: min(10px, calc((100% - 4px) * 0.38)); background: {KOLOR.seria2}"></span>
							{/if}
						{/if}
						{#if !nad && d.skladka > 0 && (i === iMaks || i === dane.length - 1)}
							<span class="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-ink whitespace-nowrap" style="bottom: calc({h}% + 6px)">{etykietaOsi(d.skladka, true)}</span>
						{/if}
						{#if nad}
							<span
								role="tooltip"
								class="absolute z-20 min-w-[210px] px-2.5 py-2 rounded-lg bg-white shadow-[0_8px_24px_rgba(18,24,38,0.16),0_0_0_1px_rgba(18,24,38,0.08)] flex flex-col gap-0.5 text-left pointer-events-none {i > dane.length / 2 ? 'right-1' : 'left-1'}"
								style="bottom: calc({Math.min(h, 80)}% + 10px)"
							>
								<span class="text-xs text-ink-2 whitespace-nowrap">{miesiacPelny(d.ym)} · {d.rat} {d.rat === 1 ? 'rata' : d.rat < 5 ? 'raty' : 'rat'}</span>
								<span class="text-[15px] font-semibold text-ink whitespace-nowrap">{zl(d.skladka)} <span class="text-xs font-normal text-ink-3">składka rat</span></span>
								<span class="flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap"><span aria-hidden="true" class="w-2 h-2 rounded-sm shrink-0" style="background: {KOLOR.seria}"></span>zainkasowano <span class="font-semibold text-ink">{zl(d.zainkasowana)}</span> · {d.ratRozliczonych} z {d.rat}</span>
								{#if d.skladka > d.zainkasowana}
									<span class="flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap"><span aria-hidden="true" class="w-2 h-2 rounded-sm shrink-0" style="background: {KOLOR.seriaJasna}"></span>do zapłaty <span class="font-semibold text-ink">{zl(d.skladka - d.zainkasowana)}</span></span>
								{/if}
								<span class="mt-1 pt-1 border-t border-line-soft flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap"><span aria-hidden="true" class="w-2 h-2 rounded-sm shrink-0" style="background: {KOLOR.seria2}"></span>prowizja <span class="font-semibold text-ink">{zl(d.prowizja)}</span> · średnio {stawka(d)}</span>
								{#if d.prowizjaZainkasowana !== d.prowizja}
									<span class="pl-3.5 text-xs text-ink-3 whitespace-nowrap">z rat rozliczonych {zl(d.prowizjaZainkasowana)}</span>
								{/if}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<!-- Pod każdym miesiącem: nazwa, a niżej prowizja kwotowo i średnia stawka — w kolorze prowizji. -->
	<div aria-hidden="true" class="flex gap-2">
		<span class="w-12 shrink-0"></span>
		<div class="flex flex-1 min-w-0">
			{#each dane as d, i (d.ym)}
				<span class="flex-1 min-w-0 flex flex-col items-center text-center leading-tight">
					<span class="text-xs text-ink-3 whitespace-nowrap">{i % coIle === 0 ? miesiacKrotko(d.ym, zRokiem) : ''}</span>
					{#if d.prowizja > 0 && i % coIle === 0}
						<span class="text-[11px] font-semibold tabular-nums truncate max-w-full" style="color: {KOLOR.seria2}">{etykietaOsi(d.prowizja, true)}</span>
						<span class="text-[11px] tabular-nums" style="color: {KOLOR.seria2}">{stawka(d)}</span>
					{/if}
				</span>
			{/each}
		</div>
	</div>
</div>
