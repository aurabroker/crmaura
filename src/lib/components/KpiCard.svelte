<script lang="ts">
	interface Props {
		label: string;
		value: string | number;
		sub?: string;
		color?: string;
	}
	let { label, value, sub, color = 'text-slate-900' }: Props = $props();
</script>

<div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all hover:shadow-md hover:border-slate-300">
	<p class="text-sm font-medium text-slate-500 mb-2">{label}</p>
	<p class="text-3xl font-semibold {color}">{value}</p>
	{#if sub}<p class="text-xs text-slate-400 mt-1">{sub}</p>{/if}
</div>
