import test from 'node:test';
import assert from 'node:assert/strict';
import { DYSTRYBUTOR_PDF, stopkaHtml, stopkaTekst } from './dystrybutor.ts';

const PDF = 'https://pliki.auraexpert.pl/media/beautypolisa/informacja-o-dystrybutorze-aura-expert.pdf';

test('adres informacji o dystrybutorze to PDF Z001 z domeny plików Aura Expert', () => assert.equal(DYSTRYBUTOR_PDF, PDF));

test('stopka maili programu (HTML) wskazuje dystrybutora i linkuje informację o dystrybutorze', () => {
	const h = stopkaHtml();
	assert.match(h, /Dystrybutor: <a [^>]*href="https:\/\/auraexpert\.pl\/"[^>]*>Aura Expert sp\. z o\.o\.<\/a>, agent ubezpieczeniowy \(RPU 11229690\/A\)/);
	assert.ok(h.includes(`href="${PDF}"`), 'link do PDF');
	assert.match(h, />Informacja o dystrybutorze \(PDF\)<\/a>/);
});

test('stopka maili programu (tekst) ma dystrybutora i pełny adres PDF', () => {
	const t = stopkaTekst();
	assert.ok(t.includes('Dystrybutor: Aura Expert sp. z o.o., agent ubezpieczeniowy (RPU 11229690/A)'));
	assert.ok(t.includes(`Informacja o dystrybutorze: ${PDF}`));
});
