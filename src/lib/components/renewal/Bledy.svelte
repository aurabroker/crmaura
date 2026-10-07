<script lang="ts">
	import { tick } from 'svelte';

	// Komunikat błędu kroku: ogólny opis z serwera i/lub lista braków z walidacji.
	// role="alert" — czytnik ekranu odczyta go od razu; fokus przenosimy, żeby był widoczny na telefonie.
	interface Props {
		message?: string;
		bledy?: string[];
	}
	let { message = '', bledy = [] }: Props = $props();

	let el = $state<HTMLDivElement | null>(null);
	const widoczny = $derived(!!message || bledy.length > 0);

	$effect(() => {
		// Każdy nowy zestaw błędów (także ten sam ponownie po kliknięciu) — pokaż go.
		void message;
		void bledy;
		if (!widoczny) return;
		tick().then(() => {
			el?.focus({ preventScroll: true });
			el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	});
</script>

<div bind:this={el} tabindex="-1" role="alert" class="focus:outline-none">
	{#if widoczny}
		<div class="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="bledy">
			{#if message}<p class="font-semibold">{message}</p>{/if}
			{#if bledy.length}
				<ul class="mt-1 list-disc space-y-1 pl-5">
					{#each bledy as b, i (i)}<li>{b}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
