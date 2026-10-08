<script lang="ts">
	import { TYPY_ZALACZNIKOW, ZALACZNIKI_MAX, ZALACZNIKI_MAX_LACZNIE, ZALACZNIK_MAX_BAJTOW } from '$lib/renewals/program';
	import PlikSlot from './PlikSlot.svelte';
	import { fmtRozmiar } from './klient';
	import type { Odnowienie } from './stan.svelte';

	// Dodatkowe dokumenty do ankiety Ergo Hestii (opcjonalne). Dyplomy i certyfikaty osób są w kroku
	// „Osoby i dokumenty” — przy każdej osobie i jej zabiegach.
	interface Props {
		s: Odnowienie;
	}
	let { s }: Props = $props();
</script>

<fieldset class="rounded-2xl border border-slate-200 p-4 sm:p-5">
	<legend class="px-1 text-base font-semibold text-[#2a3b69]">Dodatkowe dokumenty (opcjonalnie)</legend>
	<p class="text-sm text-slate-600">
		Pliki PDF albo zdjęcia (JPG, PNG, WEBP, HEIC), do {fmtRozmiar(ZALACZNIK_MAX_BAJTOW)} każdy; na cały wniosek najwyżej {ZALACZNIKI_MAX} plików
		i {fmtRozmiar(ZALACZNIKI_MAX_LACZNIE)}.
	</p>
	<div class="mt-4 space-y-3">
		<PlikSlot {s} typ="zgoda" etykieta={TYPY_ZALACZNIKOW.zgoda} />
		<PlikSlot {s} typ="inny" etykieta={TYPY_ZALACZNIKOW.inny} />
	</div>
</fieldset>
