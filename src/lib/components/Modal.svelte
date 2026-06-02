<script lang="ts">
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}
	let { open, title, onclose, children, footer }: Props = $props();
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && onclose()}
		role="dialog"
		aria-modal="true"
	>
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
				<h2 class="text-base font-semibold text-slate-900">{title}</h2>
				<button onclick={onclose} class="text-slate-400 hover:text-slate-600 transition-colors">
					<X size={18} />
				</button>
			</div>
			<div class="px-5 py-4 overflow-y-auto flex-1">
				{@render children()}
			</div>
			{#if footer}
				<div class="px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-end gap-3">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
