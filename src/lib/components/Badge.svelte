<script lang="ts">
	interface Props {
		variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
		children: import('svelte').Snippet;
	}
	let { variant = 'neutral', children }: Props = $props();

	const classes = {
		success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
		warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20',
		error: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
		info: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
		neutral: 'bg-slate-100 text-slate-700 ring-1 ring-slate-600/10'
	};
</script>

<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {classes[variant]}">
	{@render children()}
</span>
