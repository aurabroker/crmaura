<script lang="ts">
	import { ctxMenuState, ctxToastState, closeCtxMenu, type CtxItem } from '$lib/stores/ctxmenu.svelte';

	const MARGIN = 8;

	let menuEl = $state<HTMLDivElement | null>(null);
	let px = $state(0);
	let py = $state(0);
	let placed = $state(false);

	$effect(() => {
		if (!ctxMenuState.open) {
			placed = false;
			return;
		}
		const x = ctxMenuState.x;
		const y = ctxMenuState.y;
		const el = menuEl;
		if (!el) return;

		const w = el.offsetWidth;
		const h = el.offsetHeight;
		px = x + w + MARGIN > window.innerWidth ? Math.max(MARGIN, x - w) : x;
		py = y + h + MARGIN > window.innerHeight ? Math.max(MARGIN, y - h) : y;
		placed = true;

		el.querySelector<HTMLButtonElement>('button[data-ctx-item]:not(:disabled)')?.focus();
	});

	$effect(() => {
		if (!ctxMenuState.open) return;

		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && e.composedPath().includes(menuEl)) return;
			closeCtxMenu();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				closeCtxMenu();
			}
		};
		const close = () => closeCtxMenu();

		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);

		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
		};
	});

	function select(item: CtxItem) {
		if (item.separator || item.disabled) return;
		const run = item.onSelect;
		closeCtxMenu();
		run();
	}

	function onMenuKeyDown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
		const btns = Array.from(
			menuEl?.querySelectorAll<HTMLButtonElement>('button[data-ctx-item]:not(:disabled)') ?? []
		);
		if (!btns.length) return;
		e.preventDefault();
		const i = btns.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			e.key === 'Home' ? 0
			: e.key === 'End' ? btns.length - 1
			: e.key === 'ArrowDown' ? (i + 1) % btns.length
			: (i - 1 + btns.length) % btns.length;
		btns[next].focus();
	}
</script>

{#if ctxMenuState.open}
	<div
		bind:this={menuEl}
		role="menu"
		tabindex="-1"
		onkeydown={onMenuKeyDown}
		oncontextmenu={(e) => e.preventDefault()}
		style="left: {px}px; top: {py}px;"
		class="fixed z-[60] min-w-56 max-w-72 bg-[#0b2a5b] border border-blue-900 rounded-xl shadow-2xl py-1 overflow-hidden
			{placed ? 'opacity-100' : 'opacity-0'}"
	>
		{#if ctxMenuState.title}
			<div class="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-white text-center truncate border-b border-white/10">
				{ctxMenuState.title}
			</div>
		{/if}
		{#each ctxMenuState.items as item}
			{#if item.separator}
				<div class="my-1 border-t border-white/10"></div>
			{:else}
				<button
					data-ctx-item
					role="menuitem"
					disabled={item.disabled}
					onclick={() => select(item)}
					class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
						focus:outline-none disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent
						{item.danger
							? 'text-red-300 hover:bg-red-500/25 focus:bg-red-500/25'
							: 'text-blue-50 hover:bg-blue-500 focus:bg-blue-500'}"
				>
					{#if item.icon}
						<item.icon size={14} class="shrink-0 {item.danger ? 'text-red-300' : 'text-blue-300/70'}" />
					{:else}
						<span class="w-3.5 shrink-0"></span>
					{/if}
					<span class="flex-1 truncate">{item.label}</span>
					{#if item.hint}
						<span class="text-[10px] text-blue-300/60 shrink-0">{item.hint}</span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

{#if ctxToastState.msg}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-[#0b2a5b] text-white text-sm px-4 py-2 rounded-lg shadow-xl border border-blue-900">
		{ctxToastState.msg}
	</div>
{/if}
