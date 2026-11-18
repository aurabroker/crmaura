/**
 * Testy linków APK (get_apk_by_token, submit_apk, apk_form_by_token, apk_tokens)
 * na jednorazowym klastrze Postgresa.
 *
 *   node scripts/test-apk-tokeny-sql.mjs
 *
 * Stawia pusty klaster w katalogu tymczasowym, ładuje atrapę
 * supabase/tests/apk_tokeny_stub.sql (schemat jak w produkcji, funkcje sprzed
 * utwardzenia), potem migrację utwardzającą i supabase/tests/apk_tokeny.sql.
 *
 *   APK_MIGRACJA=plik.sql   podmienia migrację (np. pusty plik: testy mają wtedy
 *                           pokazać błędy starych funkcji — test mutacyjny)
 *
 * Plik testów kończy się zawsze wyjątkiem "TESTY_WYNIK pass=N fail=M", żeby ten sam
 * plik dało się puścić na produkcji bez śladu w danych. Brak binariów Postgresa
 * kończy się błędem (kod 2), nie zielonym wynikiem.
 */
import { spawnSync } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const korzen = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wczytaj = (p) => readFileSync(join(korzen, p), 'utf8');

function znajdzBinaria() {
	const kandydaci = [];
	const pg = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
	if (pg.status === 0) kandydaci.push(pg.stdout.trim());
	const lib = '/usr/lib/postgresql';
	if (existsSync(lib)) {
		for (const v of readdirSync(lib).sort((a, b) => Number(b) - Number(a))) kandydaci.push(join(lib, v, 'bin'));
	}
	return kandydaci.find((k) => existsSync(join(k, 'initdb')) && existsSync(join(k, 'postgres')));
}

const bin = znajdzBinaria();
if (!bin) {
	console.error('Nie znaleziono Postgresa (initdb/pg_ctl/psql). Test SQL NIE został wykonany — to nie jest wynik zielony.');
	process.exit(2);
}

const migracja = process.env.APK_MIGRACJA
	? readFileSync(resolve(process.env.APK_MIGRACJA), 'utf8')
	: readdirSync(join(korzen, 'supabase/migrations'))
			.filter((p) => /_apk_tokeny_utwardzenie\.sql$/.test(p))
			.sort()
			.map((p) => wczytaj(`supabase/migrations/${p}`))
			.join('\n');

const jakoRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const opakuj = (cmd, args) => (jakoRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]);
const uruchom = (cmd, args, wejscie) => {
	const [c, a] = opakuj(cmd, args);
	return spawnSync(c, a, { encoding: 'utf8', input: wejscie, maxBuffer: 64 * 1024 * 1024 });
};

const katalog = mkdtempSync(join(tmpdir(), 'crm-apk-sql-'));
if (jakoRoot) {
	const id = (f) => Number(spawnSync('id', [f, 'postgres'], { encoding: 'utf8' }).stdout);
	chownSync(katalog, id('-u'), id('-g'));
}
const dane = join(katalog, 'dane');
const port = String(20000 + Math.floor(Math.random() * 20000));
const psqlArgs = ['-h', katalog, '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'];
const psql = (sql) => uruchom(join(bin, 'psql'), psqlArgs, sql);

let wyjscie = 1;
try {
	let r = uruchom(join(bin, 'initdb'), ['-D', dane, '-U', 'postgres', '-A', 'trust', '--no-sync', '-E', 'UTF8', '--locale=C.UTF-8']);
	if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
	r = uruchom(join(bin, 'pg_ctl'), ['-D', dane, '-l', join(katalog, 'log'), '-w',
		'-o', `-k ${katalog} -p ${port} -c listen_addresses= -c fsync=off`, 'start']);
	if (r.status !== 0) throw new Error('pg_ctl start: ' + r.stderr);

	for (const [nazwa, sql] of [['atrapa', wczytaj('supabase/tests/apk_tokeny_stub.sql')], ['migracja', migracja]]) {
		r = psql(sql);
		if (r.status !== 0) throw new Error(`${nazwa}:\n${r.stderr}`);
	}

	// Migracja jest idempotentna — drugi przebieg nie może się wywrócić.
	if (!process.env.APK_MIGRACJA) {
		r = psql(migracja);
		if (r.status !== 0) throw new Error(`migracja (drugi przebieg):\n${r.stderr}`);
	}

	const przebieg = (tytul) => {
		console.log(`\n# ${tytul}`);
		const w = psql(`set testy.lokalnie = on;\n${wczytaj('supabase/tests/apk_tokeny.sql')}`);
		const linie = `${w.stderr}\n${w.stdout}`.split('\n');
		for (const l of linie) {
			const m = l.match(/NOTICE:\s+(PASS|FAIL) (.*)$/);
			if (m) console.log(`${m[1] === 'PASS' ? '  ok ' : '  ZLE'} ${m[2]}`);
		}
		const wynik = linie.find((l) => l.includes('TESTY_WYNIK'));
		const obce = linie.filter((l) => /ERROR:|FATAL:/.test(l) && !l.includes('TESTY_WYNIK'));
		if (!wynik || obce.length) {
			console.error('\nTesty nie doszły do końca:\n' + (obce.join('\n') || w.stderr));
			return false;
		}
		const m = wynik.match(/pass=(\d+) fail=(\d+)/);
		console.log(`${wynik.replace(/^.*TESTY_WYNIK/, 'Wynik:')}`);
		return Boolean(m && Number(m[2]) === 0 && Number(m[1]) > 0);
	};

	let zielono = przebieg('po migracji');
	// Druga faza: wymóg długości nowych tokenów z supabase/pending (do zastosowania po wdrożeniu CRM).
	if (!process.env.APK_MIGRACJA) {
		r = psql(wczytaj('supabase/pending/20261113000002_apk_tokeny_min_dlugosc.sql'));
		if (r.status !== 0) throw new Error(`pending/20261113000002:\n${r.stderr}`);
		zielono = przebieg('po migracji + pending/20261113000002 (min. długość tokenu)') && zielono;
	}
	if (zielono) wyjscie = 0;
} catch (e) {
	console.error(e.message);
	wyjscie = 2;
} finally {
	uruchom(join(bin, 'pg_ctl'), ['-D', dane, '-m', 'immediate', 'stop']);
	rmSync(katalog, { recursive: true, force: true });
}
process.exit(wyjscie);
