// Uruchamiany przed każdym buildem (npm run build → prebuild). Sprawdza, czy kompilator Svelte nie zmienia
// znaczenia wyrażeń logicznych i czy z TypeScriptu powstaje poprawny JavaScript. esrap 2.2.10 (drukarka kodu w kompilatorze) gubił nawiasy:
// `a && (b || c)` stawało się `a && b || c` w każdym komponencie i pliku .svelte.ts — wtedy build ma się zatrzymać.
// Dlatego package.json → overrides przypina esrap 2.2.9 (2.3.x i 2.4 z Svelte 5.56 przepuszczają TypeScript).
// Przy aktualizacji Svelte: usuń override, uruchom ten skrypt i zostaw tylko wtedy, gdy nadal potrzebny.
import { parse } from 'acorn';
import { compile, compileModule } from 'svelte/compiler';

const przypadki = [
	['a && (b || c)', (a, b, c) => a && (b || c)],
	['a || (b && c)', (a, b, c) => a || (b && c)],
	['(a || b) && c', (a, b, c) => (a || b) && c],
	['!(a && b) || c', (a, b, c) => !(a && b) || c],
	['a ?? (b || c)', (a, b, c) => a ?? (b || c)]
];

const bledy = [];
for (const [wyr, wzor] of przypadki) {
	const modul = compileModule(`export const f = (a, b, c) => ${wyr};`, { filename: 'test.svelte.js', generate: 'client' }).js.code;
	const komp = compile(`<script>let { a, b, c } = $props(); export const f = () => ${wyr};</script>`, { filename: 'T.svelte', generate: 'client' }).js.code;
	const wModule = modul.match(/export const f = \(a, b, c\) => (.*);/)?.[1] ?? '';
	const f = new Function('a', 'b', 'c', `return ${wModule};`);
	for (const a of [false, true, null]) for (const b of [false, true]) for (const c of [false, true]) {
		if (f(a, b, c) !== wzor(a, b, c)) bledy.push(`${wyr}: moduł daje inny wynik dla a=${a} b=${b} c=${c}`);
	}
	const wKomponencie = komp.match(/const f = \(\) => (.*);/)?.[1]?.replace(/\$\$props\./g, '') ?? '';
	const g = new Function('a', 'b', 'c', `return ${wKomponencie};`);
	for (const a of [false, true, null]) for (const b of [false, true]) for (const c of [false, true]) {
		if (g(a, b, c) !== wzor(a, b, c)) bledy.push(`${wyr}: komponent daje inny wynik dla a=${a} b=${b} c=${c} (${wKomponencie})`);
	}
}

// esrap 2.4.0 z Svelte 5.56 przepuszczał składnię TypeScript do kodu (`function s(a, b?)` w snippecie) —
// build padał dopiero w rolldown. Kod skompilowanego komponentu z TS musi być poprawnym JavaScriptem.
{
	const ts = compile(
		`<script lang="ts">let { x }: { x?: string } = $props();</script>{#snippet s(a: string, b?: string)}{a}{b}{/snippet}{@render s('1', x)}`,
		{ filename: 'Ts.svelte', generate: 'client' }
	).js.code;
	try {
		parse(ts, { ecmaVersion: 'latest', sourceType: 'module' });
	} catch (e) {
		bledy.push(`komponent z TypeScriptem kompiluje się do niepoprawnego JS: ${e.message}`);
	}
}

if (bledy.length) {
	console.error('Kompilator Svelte daje błędny kod — sprawdź wersję esrap/svelte (package.json → overrides, package-lock.json):');
	for (const b of [...new Set(bledy)].slice(0, 10)) console.error(' - ' + b);
	process.exit(1);
}
console.log('Kompilator Svelte: wyrażenia logiczne i TypeScript w porządku.');
