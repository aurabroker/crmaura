<script lang="ts">
	import { formatZl, type Wycena } from '$lib/renewals/program';

	// Orientacyjna składka po zmianach (wycenaWniosku). null = składka bez zmian.
	interface Props {
		wycena: Wycena | null;
		skladkaObecna: number | null;
	}
	let { wycena, skladkaObecna }: Props = $props();
</script>

<div class="rounded-xl border border-[#2a3b69]/20 bg-[#2a3b69]/5 px-4 py-3" aria-live="polite" data-testid="wycena">
	{#if wycena?.rodzaj === 'kwota'}
		<p class="text-slate-900">
			Składka orientacyjna wg programu: <strong class="text-lg text-[#2a3b69]">{formatZl(wycena.kwota)}</strong>
			<span class="text-sm text-slate-600">({wycena.opis})</span>
		</p>
		<p class="mt-1 text-sm text-slate-600">Ostateczną składkę potwierdzi doradca.</p>
	{:else if wycena?.rodzaj === 'indywidualna'}
		<p class="text-slate-900"><strong>Składka do indywidualnej wyceny</strong> — {wycena.powod}.</p>
		<p class="mt-1 text-sm text-slate-600">Doradca przygotuje wycenę i skontaktuje się z Tobą.</p>
	{:else}
		<p class="text-slate-900">
			<strong>Składka bez zmian</strong>{#if skladkaObecna != null}: {formatZl(skladkaObecna)} rocznie{/if}.
		</p>
	{/if}
</div>
