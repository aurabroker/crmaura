<script lang="ts">
	import { X, Minus, Maximize2, Minimize2 } from 'lucide-svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
		/** Tryb okienkowy: przeciąganie, zmiana rozmiaru, minimalizacja/maksymalizacja (jak w Windows). */
		windowed?: boolean;
	}
	let { open, title, onclose, children, footer, windowed = false }: Props = $props();

	// ---- Stan okna (tryb windowed) ----
	let posX = $state(0);
	let posY = $state(0);
	let width = $state(672);
	let height = $state(560);
	let minimized = $state(false);
	let maximized = $state(false);
	let boxEl = $state<HTMLDivElement | null>(null);

	let dragging = false;
	let dragDX = 0, dragDY = 0;

	function initGeometry() {
		if (typeof window === 'undefined') return;
		width = Math.min(672, window.innerWidth - 40);
		height = Math.min(620, window.innerHeight - 80);
		posX = Math.max(20, Math.round((window.innerWidth - width) / 2));
		posY = Math.max(20, Math.round(window.innerHeight * 0.07));
		minimized = false;
		maximized = false;
	}

	// Inicjalizacja pozycji przy każdym otwarciu w trybie okienkowym
	let wasOpen = false;
	$effect(() => {
		if (windowed && open && !wasOpen) initGeometry();
		wasOpen = open;
	});

	// Synchronizacja rozmiaru po ręcznym rozciągnięciu (uchwyt CSS resize),
	// żeby przeciąganie nie cofało zmienionego rozmiaru.
	$effect(() => {
		if (!boxEl || !windowed) return;
		const ro = new ResizeObserver(() => {
			if (!boxEl || maximized || minimized) return;
			width = boxEl.offsetWidth;
			height = boxEl.offsetHeight;
		});
		ro.observe(boxEl);
		return () => ro.disconnect();
	});

	function onHeaderPointerDown(e: PointerEvent) {
		if (maximized) return;
		if ((e.target as HTMLElement).closest('button')) return;
		dragging = true;
		dragDX = e.clientX - posX;
		dragDY = e.clientY - posY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onHeaderPointerMove(e: PointerEvent) {
		if (!dragging) return;
		posX = Math.max(0, Math.min(e.clientX - dragDX, window.innerWidth - 80));
		posY = Math.max(0, Math.min(e.clientY - dragDY, window.innerHeight - 40));
	}
	function onHeaderPointerUp(e: PointerEvent) {
		dragging = false;
		try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
	}

	function toggleMaximize() { maximized = !maximized; }
	function toggleMinimize() { minimized = !minimized; }
</script>

{#if open}
	{#if windowed}
		<div class="fixed inset-0 z-50 pointer-events-none">
			<div
				bind:this={boxEl}
				class="absolute bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col pointer-events-auto overflow-hidden"
				style={maximized
					? 'left:0.5rem; top:0.5rem; width:calc(100vw - 1rem); height:calc(100vh - 1rem); resize:none;'
					: `left:${posX}px; top:${posY}px; width:${width}px; ${minimized ? 'height:auto; resize:none;' : `height:${height}px; resize:both;`} min-width:340px; min-height:48px;`}
				role="dialog"
				aria-modal="false"
				aria-label={title}
			>
				<!-- Pasek tytułu (przeciąganie) -->
				<div
					class="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50 select-none shrink-0 {maximized ? 'cursor-default' : 'cursor-move'}"
					onpointerdown={onHeaderPointerDown}
					onpointermove={onHeaderPointerMove}
					onpointerup={onHeaderPointerUp}
					ondblclick={toggleMaximize}
				>
					<h2 class="text-sm font-semibold text-slate-900 truncate">{title}</h2>
					<div class="flex items-center gap-0.5 shrink-0">
						<button onclick={toggleMinimize} title={minimized ? 'Przywróć' : 'Minimalizuj'} class="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
							<Minus size={15} />
						</button>
						<button onclick={toggleMaximize} title={maximized ? 'Przywróć' : 'Maksymalizuj'} class="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
							{#if maximized}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}
						</button>
						<button onclick={onclose} title="Zamknij" class="p-1.5 rounded hover:bg-red-100 hover:text-red-600 text-slate-500 transition-colors">
							<X size={15} />
						</button>
					</div>
				</div>
				{#if !minimized}
					<div class="px-5 py-4 overflow-y-auto flex-1 min-h-0">
						{@render children()}
					</div>
					{#if footer}
						<div class="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 shrink-0">
							{@render footer()}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{:else}
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
{/if}
