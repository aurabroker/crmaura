<script lang="ts">
	// Znak Beauty❤️Polisa w nagłówku strony odnowienia (na ciemnym tle).
	// Gdy będzie plik logo (static/), wystarczy podmienić zawartość tego komponentu na <img>.
	interface Props {
		class?: string;
	}
	let { class: klasa = '' }: Props = $props();
</script>

<span class="inline-flex shrink-0 items-center text-lg font-bold tracking-tight text-white sm:text-xl {klasa}" role="img" aria-label="BeautyPolisa">
	<span aria-hidden="true">Beauty</span>
	<svg viewBox="0 0 24 24" class="mx-0.5 size-[1.05em] fill-rose-400" aria-hidden="true">
		<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
	</svg>
	<span aria-hidden="true">Polisa</span>
</span>
