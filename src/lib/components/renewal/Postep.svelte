<script lang="ts">
	import { Check } from 'lucide-svelte';
	import type { Krok } from './stan.svelte';

	// Pasek postępu: 1 APK, 2 Wniosek, (3 Ankieta — tylko gdy potrzebna), ostatni Podsumowanie.
	// Wcześniejsze kroki można kliknąć, żeby do nich wrócić.
	interface Props {
		kroki: Krok[];
		aktualny: Krok;
		onwybierz: (k: Krok) => void;
	}
	let { kroki, aktualny, onwybierz }: Props = $props();

	const NAZWY: Partial<Record<Krok, string>> = { apk: 'APK', wniosek: 'Wniosek', ankieta: 'Ankieta', podsumowanie: 'Podsumowanie' };
	const idx = $derived(kroki.indexOf(aktualny));
</script>

<nav aria-label="Postęp wniosku" class="mb-6">
	<ol class="flex items-start gap-1">
		{#each kroki as k, i (k)}
			{@const zrobiony = idx > i}
			{@const biezacy = idx === i}
			<li class="flex-1 min-w-0">
				{#if zrobiony}
					<button
						type="button"
						onclick={() => onwybierz(k)}
						class="group w-full flex flex-col items-center gap-1.5 rounded-lg py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
					>
						<span class="flex size-9 items-center justify-center rounded-full bg-[#2a3b69] text-white">
							<Check size={18} aria-hidden="true" />
						</span>
						<span class="text-xs font-medium text-[#2a3b69] underline-offset-2 group-hover:underline truncate max-w-full">
							{NAZWY[k]}<span class="sr-only"> — zakończony, wróć do kroku</span>
						</span>
					</button>
				{:else}
					<div class="w-full flex flex-col items-center gap-1.5 py-1" aria-current={biezacy ? 'step' : undefined}>
						<span
							class="flex size-9 items-center justify-center rounded-full text-sm font-bold {biezacy
								? 'bg-rose-600 text-white ring-4 ring-rose-100'
								: 'bg-white text-slate-400 border border-slate-300'}"
						>
							{i + 1}
						</span>
						<span class="text-xs truncate max-w-full {biezacy ? 'font-semibold text-slate-900' : 'text-slate-500'}">
							{NAZWY[k]}
						</span>
					</div>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
