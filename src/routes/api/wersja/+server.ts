import { json } from '@sveltejs/kit';
import { BUILD_COMMIT, WERSJA } from '$lib/wersja';
import type { RequestHandler } from './$types';

// Wersja działającego wdrożenia (bez logowania — tylko numer, data i commit builda).
export const GET: RequestHandler = () =>
	json({ wersja: WERSJA, build: __APP_BUILD__.data, commit: BUILD_COMMIT || null }, { headers: { 'cache-control': 'no-store' } });
