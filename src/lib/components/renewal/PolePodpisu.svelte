<script lang="ts">
	// Podpis klienta palcem, rysikiem albo myszą (port PolePodpisu z aplikacji wniosków majątkowych).
	//
	// Pole w formularzu otwiera okno na cały ekran — na telefonie to jedyny sposób, żeby mieć miejsce na podpis
	// i żeby przeciąganie palcem nie przewijało strony. Zapisujemy obraz PNG (do PDF) i przebieg ruchu ręki
	// (punkty, czas, nacisk rysika) jako ślad dowodowy. Proporcje pola są stałe, więc obrót telefonu nie
	// zniekształca podpisu. Bez zewnętrznej biblioteki: Pointer Events, Canvas 2D, toDataURL.
	import { tick } from 'svelte';
	import { PenLine } from 'lucide-svelte';
	import { LIMITY_PODPISU, PODPIS_ZA_KROTKI, PROPORCJE_PODPISU, wystarczajacyPodpis, type Podpis, type Punkt } from '$lib/renewals/podpis';
	import { BTN_DRUGI, BTN_GLOWNY, BTN_LINK } from './klient';

	interface Props {
		wartosc: Podpis | null;
		onzmiana: (p: Podpis | null) => void;
		/** Co klient podpisuje — nagłówek okna i etykieta pola. */
		tytul?: string;
		przycisk?: string;
		opis?: string;
		blad?: string;
	}
	let { wartosc, onzmiana, tytul = 'Podpis', przycisk = 'Podpisz', opis = 'palcem, rysikiem lub myszą', blad = '' }: Props = $props();

	const ATRAMENT = '#0b2545';
	/** Grubość linii jako ułamek szerokości pola — taka sama na ekranie i w PNG. */
	const GRUBOSC = 0.0055;
	const PNG_SZEROKOSC = 1000;

	let otwarte = $state(false);

	// ---------- Okno podpisu ----------
	let ramka = $state<HTMLDivElement | null>(null);
	let plotno = $state<HTMLCanvasElement | null>(null);
	let kreski: Punkt[][] = [];
	let rysik: boolean[] = [];
	let start: number | null = null;
	let aktywny: number | null = null;
	let wymiary = $state({ szer: 0, wys: 0 });
	let pusto = $state(true);
	let zaKrotki = $state(false);
	let pionowo = $state(false);

	function rysuj(ctx: CanvasRenderingContext2D, szer: number, wys: number) {
		ctx.clearRect(0, 0, szer, wys);
		ctx.strokeStyle = ATRAMENT;
		ctx.fillStyle = ATRAMENT;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		kreski.forEach((kreska, k) => {
			const pkt = kreska.map(([x, y, , p]) => ({ x: x * szer, y: y * wys, p }));
			const grubosc = (p: number) => szer * GRUBOSC * (rysik[k] ? 0.55 + 0.9 * p : 1);
			if (pkt.length === 1) {
				ctx.beginPath();
				ctx.arc(pkt[0].x, pkt[0].y, grubosc(pkt[0].p) / 2, 0, Math.PI * 2);
				ctx.fill();
				return;
			}
			// Wygładzanie: krzywe kwadratowe przez środki kolejnych odcinków.
			for (let i = 1; i < pkt.length; i++) {
				const a = pkt[i - 1];
				const b = pkt[i];
				const poprzedniSrodek = i > 1 ? { x: (pkt[i - 2].x + a.x) / 2, y: (pkt[i - 2].y + a.y) / 2 } : a;
				const srodek = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
				ctx.beginPath();
				ctx.lineWidth = grubosc((a.p + b.p) / 2);
				ctx.moveTo(poprzedniSrodek.x, poprzedniSrodek.y);
				ctx.quadraticCurveTo(a.x, a.y, srodek.x, srodek.y);
				if (i === pkt.length - 1) ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
		});
	}

	// Osobne płótno 1000×400, ta sama funkcja rysująca, przezroczyste tło.
	function doPng(): string {
		const c = document.createElement('canvas');
		c.width = PNG_SZEROKOSC;
		c.height = Math.round(PNG_SZEROKOSC / PROPORCJE_PODPISU);
		rysuj(c.getContext('2d')!, c.width, c.height);
		return c.toDataURL('image/png');
	}

	// Płótno skalowane o devicePixelRatio; przy każdej zmianie rozmiaru rysujemy od nowa z zapisanych punktów.
	function odswiez() {
		const c = plotno;
		if (!c || !wymiary.szer) return;
		const dpr = window.devicePixelRatio || 1;
		c.width = Math.round(wymiary.szer * dpr);
		c.height = Math.round(wymiary.wys * dpr);
		const ctx = c.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		rysuj(ctx, wymiary.szer, wymiary.wys);
	}

	// Pole o stałych proporcjach, jak największe w dostępnym miejscu (ResizeObserver + orientationchange).
	function dopasuj() {
		const r = ramka;
		if (!r) return;
		const { width, height } = r.getBoundingClientRect();
		const szer = Math.max(0, Math.floor(Math.min(width, height * PROPORCJE_PODPISU)));
		wymiary = { szer, wys: Math.floor(szer / PROPORCJE_PODPISU) };
		pionowo = window.innerHeight > window.innerWidth && window.innerWidth < 640;
	}

	$effect(() => {
		if (!otwarte || !ramka) return;
		dopasuj();
		const obserwator = new ResizeObserver(dopasuj);
		obserwator.observe(ramka);
		window.addEventListener('orientationchange', dopasuj);
		return () => {
			obserwator.disconnect();
			window.removeEventListener('orientationchange', dopasuj);
		};
	});

	$effect(() => {
		void wymiary;
		void plotno;
		odswiez();
	});

	// Okno modalne: blokada przewijania strony pod spodem, Esc zamyka.
	$effect(() => {
		if (!otwarte) return;
		const poprzednie = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const klawisz = (e: KeyboardEvent) => e.key === 'Escape' && anuluj();
		window.addEventListener('keydown', klawisz);
		return () => {
			document.body.style.overflow = poprzednie;
			window.removeEventListener('keydown', klawisz);
		};
	});

	const zaokr = (v: number, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

	function punktZ(e: PointerEvent): Punkt {
		const r = plotno!.getBoundingClientRect();
		if (start === null) start = e.timeStamp;
		return [
			zaokr((e.clientX - r.left) / r.width),
			zaokr((e.clientY - r.top) / r.height),
			Math.max(0, Math.round(e.timeStamp - start)),
			zaokr(e.pointerType === 'pen' ? e.pressure : 0.5, 2)
		];
	}

	const liczbaPunktow = () => kreski.reduce((a, k) => a + k.length, 0);

	// Tylko jeden aktywny wskaźnik: drugi palec albo dłoń są ignorowane.
	function dol(e: PointerEvent) {
		if (aktywny !== null || kreski.length >= LIMITY_PODPISU.kresek) return;
		e.preventDefault();
		(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
		aktywny = e.pointerId;
		kreski.push([punktZ(e)]);
		rysik.push(e.pointerType === 'pen');
		pusto = false;
		zaKrotki = false;
		odswiez();
	}

	function ruch(e: PointerEvent) {
		if (aktywny !== e.pointerId) return;
		e.preventDefault();
		const zdarzenia: PointerEvent[] = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
		const kreska = kreski[kreski.length - 1];
		for (const z of zdarzenia.length ? zdarzenia : [e]) {
			if (liczbaPunktow() >= LIMITY_PODPISU.punktow) break;
			kreska.push(punktZ(z));
		}
		odswiez();
	}

	function gora(e: PointerEvent) {
		if (aktywny === e.pointerId) aktywny = null;
	}

	function wyczysc() {
		kreski = [];
		rysik = [];
		start = null;
		aktywny = null;
		pusto = true;
		zaKrotki = false;
		odswiez();
	}

	async function otworz() {
		wyczysc();
		otwarte = true;
		await tick();
		dopasuj();
	}

	function anuluj() {
		otwarte = false;
	}

	function zatwierdz() {
		if (!wystarczajacyPodpis(kreski)) {
			zaKrotki = true;
			return;
		}
		onzmiana({ png: doPng(), punkty: kreski.map((k) => k.slice()), proporcje: PROPORCJE_PODPISU });
		otwarte = false;
	}
</script>

<div data-testid="pole-podpisu">
	<p class="text-base font-semibold text-[#2a3b69] mb-2">{tytul} <span class="text-rose-600" aria-hidden="true">*</span></p>
	{#if wartosc}
		<div class="rounded-xl border border-slate-300 bg-white p-3" data-testid="podpis-gotowy">
			<img src={wartosc.png} alt="Twój podpis" class="mx-auto h-24 w-auto max-w-full" />
			<div class="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2">
				<span class="text-xs text-slate-500">Podpis trafi do PDF.</span>
				<button type="button" class={BTN_LINK} onclick={otworz}>Podpisz ponownie</button>
			</div>
		</div>
	{:else}
		<button
			type="button"
			onclick={otworz}
			data-testid="podpis-otworz"
			class="flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed bg-white px-4 py-4 text-slate-600 transition-colors hover:border-rose-400 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 {blad ? 'border-red-400' : 'border-slate-300'}"
		>
			<PenLine size={24} aria-hidden="true" />
			<span class="text-base font-semibold">{przycisk}</span>
			<span class="text-xs text-slate-500">{opis}</span>
		</button>
	{/if}
	{#if blad}<p class="mt-2 text-sm font-medium text-red-700" role="alert">{blad}</p>{/if}
</div>

{#if otwarte}
	<!-- Wyśrodkowane okno tylko na dużym ekranie; telefon (także poziomo) — cały ekran. -->
	<div
		role="dialog"
		aria-modal="true"
		aria-label={tytul}
		data-testid="okno-podpisu"
		class="fixed inset-0 z-50 flex bg-slate-900/70 [@media(min-width:640px)_and_(min-height:560px)]:items-center [@media(min-width:640px)_and_(min-height:560px)]:justify-center [@media(min-width:640px)_and_(min-height:560px)]:p-6"
	>
		<div
			class="flex h-[100dvh] w-full flex-col bg-white [@media(min-width:640px)_and_(min-height:560px)]:h-auto [@media(min-width:640px)_and_(min-height:560px)]:max-w-3xl [@media(min-width:640px)_and_(min-height:560px)]:rounded-2xl [@media(min-width:640px)_and_(min-height:560px)]:shadow-xl"
		>
			<div class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
				<div>
					<p class="text-base font-semibold text-slate-900">{tytul}</p>
					<p class="text-xs text-slate-500">Palcem, rysikiem lub myszą — tak jak na papierze.</p>
				</div>
				<button type="button" onclick={anuluj} class="min-h-10 px-2 text-sm font-medium text-slate-500 hover:text-slate-800">Anuluj</button>
			</div>

			{#if pionowo}
				<p class="bg-rose-50 px-4 py-2 text-center text-xs text-[#2a3b69]" data-testid="podpis-obroc">Obróć telefon poziomo — będzie więcej miejsca na podpis.</p>
			{/if}

			<div bind:this={ramka} class="flex min-h-0 flex-1 items-center justify-center p-3 [@media(min-width:640px)_and_(min-height:560px)]:h-[340px] [@media(min-width:640px)_and_(min-height:560px)]:flex-none">
				{#if wymiary.szer > 0}
					<div class="relative" style="width:{wymiary.szer}px;height:{wymiary.wys}px">
						<canvas
							bind:this={plotno}
							aria-label="Pole podpisu"
							data-testid="plotno-podpisu"
							onpointerdown={dol}
							onpointermove={ruch}
							onpointerup={gora}
							onpointercancel={gora}
							class="absolute inset-0 h-full w-full cursor-crosshair rounded-lg border border-slate-300 bg-white"
							style="touch-action:none"
						></canvas>
						<div class="pointer-events-none absolute inset-x-[6%] bottom-[22%] border-b border-dashed border-slate-300"></div>
						{#if pusto}
							<span class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Podpisz się tutaj</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if zaKrotki}
				<p class="px-4 text-center text-sm font-medium text-red-700" role="alert" data-testid="podpis-za-krotki">{PODPIS_ZA_KROTKI}</p>
			{/if}

			<div class="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
				<button type="button" class={BTN_DRUGI} onclick={wyczysc} disabled={pusto}>Wyczyść</button>
				<button type="button" class={BTN_GLOWNY} onclick={zatwierdz} disabled={pusto} data-testid="podpis-zatwierdz">Zatwierdź podpis</button>
			</div>
		</div>
	</div>
{/if}
