<script lang="ts">
	import { confirmState, resolveConfirm } from '$lib/stores/confirm.svelte';
	import { AlertTriangle } from 'lucide-svelte';

	let confirmBtn = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		if (!confirmState.open) return;
		confirmBtn?.focus();

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				resolveConfirm(false);
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if confirmState.open}
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4"
		onclick={(e) => e.target === e.currentTarget && resolveConfirm(false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
			<div class="flex items-start gap-3 px-5 pt-5 pb-4">
				<div class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center
					{confirmState.danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}">
					<AlertTriangle size={18} />
				</div>
				<div class="min-w-0">
					<h2 class="text-base font-semibold text-slate-900">{confirmState.title}</h2>
					{#if confirmState.message}
						<p class="text-sm text-slate-600 mt-1">{confirmState.message}</p>
					{/if}
					{#if confirmState.detail}
						<p class="text-xs text-slate-400 mt-2">{confirmState.detail}</p>
					{/if}
				</div>
			</div>
			<div class="px-5 py-3 border-t border-line bg-slate-50 flex justify-end gap-3">
				<button
					onclick={() => resolveConfirm(false)}
					class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-white transition-colors"
				>
					{confirmState.cancelLabel}
				</button>
				<button
					bind:this={confirmBtn}
					onclick={() => resolveConfirm(true)}
					class="px-4 py-2 text-sm text-white rounded-lg font-semibold transition-colors
						{confirmState.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'}"
				>
					{confirmState.confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
