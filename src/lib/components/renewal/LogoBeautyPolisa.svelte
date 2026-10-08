<script lang="ts">
	import { LOGO_SCIEZKI, LOGO_VIEWBOX } from '$lib/renewals/logo';

	// Logo Beauty❤️Polisa w nagłówku strony odnowienia (jasne tło — napis jest granatowy).
	// Wysokość ustala klasa (np. h-7); szerokość wynika z proporcji.
	interface Props {
		class?: string;
	}
	let { class: klasa = 'h-7' }: Props = $props();
</script>

<svg
	viewBox="0 0 {LOGO_VIEWBOX.szer} {LOGO_VIEWBOX.wys}"
	class="w-auto shrink-0 {klasa}"
	role="img"
	aria-label="BeautyPolisa"
	focusable="false"
	xmlns="http://www.w3.org/2000/svg"
>
	{#each LOGO_SCIEZKI as s, i (i)}<path fill={s.fill} d={s.d} />{/each}
</svg>
