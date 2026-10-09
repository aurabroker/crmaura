// Czy włączona jest weryfikacja antybotowa (Cloudflare Turnstile) w formularzach logowania.
export const turnstileEnabled = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;

// Logowanie przekazuje token Turnstile prosto do Supabase Auth (options.captchaToken).
// Gdy w Supabase → Authentication → Attack Protection włączona jest ochrona CAPTCHA, to Supabase
// weryfikuje token po stronie serwera (prawdziwa ochrona, nie do obejścia z przeglądarki).
// Gdy jest wyłączona, Supabase token ignoruje. Token jest jednorazowy — po każdej próbie
// logowania widżet trzeba zresetować.
export function isCaptchaError(err: unknown): boolean {
	const e = err as { code?: string; message?: string } | null;
	return e?.code === 'captcha_failed' || /captcha/i.test(e?.message ?? '');
}

export function captchaErrorMessage(err: unknown): string {
	const msg = (err as { message?: string } | null)?.message ?? '';
	if (/no captcha_token/i.test(msg)) {
		return turnstileEnabled
			? 'Poczekaj, aż weryfikacja antybotowa się zakończy, i spróbuj ponownie.'
			: 'Logowanie wymaga weryfikacji antybotowej, której ta strona nie ma skonfigurowanej — skontaktuj się z administratorem.';
	}
	return 'Weryfikacja antybotowa nie powiodła się. Poczekaj chwilę na ponowne sprawdzenie i spróbuj jeszcze raz.';
}
