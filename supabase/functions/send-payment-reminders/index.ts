import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * send-payment-reminders — jedno przypomnienie e-mailem o każdej racie składki.
 *
 * Woła pg_cron raz dziennie przez funkcję SQL public.crm_send_payment_reminders() z nagłówkiem
 * x-cron-token (sekret edge_cron_token w Vault, sprawdzany przez edge_cron_token_matches).
 *
 * Wysyła tylko firma, która ma w SAAS Admin klucz Resend i adres nadawcy (crm_tenants.email_from).
 * Rata dostaje przypomnienie raz: w oknie DNI_PRZED dni przed terminem. Ratę oznaczamy
 * (przypomnienie_wyslane_at) PRZED wysyłką, żeby nakładające się uruchomienia nie wysłały
 * jej dwa razy; gdy Resend odmówi, oznaczenie jest zdejmowane.
 * Zaległych rat nie przypominamy — to decyzja doradcy, nie automatu.
 *
 * Polisy w programach Beauty (Umowa Generalna oc_beauty / beauty_tax) mają podpis
 * „Beauty❤️Polisa / <firma>”. Każda wysłana wiadomość trafia do historii e-maili klienta
 * (crm_client_emails, karta klienta → E-maile).
 *
 * Body {"dry_run": true} — tylko liczy, co zostałoby wysłane.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DNI_PRZED = 7;
const MAKS_RAT_NA_FIRME = 500;
const PODTYPY_BEAUTY = ["oc_beauty", "beauty_tax"];

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/i;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Odpowiedź dostawcy do logu: bez adresów e-mail. */
function bezAdresow(tekst: string): string {
  return tekst.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, "[adres]").substring(0, 300);
}

/** Data w strefie Europe/Warsaw, YYYY-MM-DD, przesunięta o podaną liczbę dni. */
function dataWarszawa(dni = 0): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" })
    .format(new Date(Date.now() + dni * 86_400_000));
}

const kwota = (n: unknown) =>
  `${Number(n ?? 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const data = (iso: string) => iso.split("-").reverse().join(".");

/** Adres z „Nazwa <adres@domena>” albo z samego adresu — do reply_to. */
const adresZNadawcy = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim();

type Rata = {
  id: string;
  data_platnosci: string;
  kwota: number | null;
  nr_raty: number | null;
  crm_policies: {
    id: string;
    klient_id: string;
    parent_id: string | null;
    nr_polisy: string | null;
    crm_insurers: { nazwa: string | null } | null;
    crm_clients: { nazwa: string | null; email: string | null } | null;
  } | null;
};

function zbudujMail(firma: string, raty: Rata[], beauty: boolean) {
  const jedna = raty.length === 1;
  const podpis = beauty ? `Beauty❤️Polisa / ${firma}` : firma;
  const temat = jedna
    ? `Przypomnienie: termin płatności składki — polisa ${raty[0].crm_policies?.nr_polisy ?? ""}`.trim()
    : "Przypomnienie: terminy płatności składek ubezpieczeniowych";

  const wiersze = raty.map((r) => ({
    polisa: r.crm_policies?.nr_polisy ?? "—",
    tu: r.crm_policies?.crm_insurers?.nazwa ?? "—",
    rata: r.nr_raty ? String(r.nr_raty) : "—",
    termin: data(r.data_platnosci),
    kwota: kwota(r.kwota),
  }));

  const tekst = [
    "Dzień dobry,",
    "",
    jedna
      ? "przypominamy o zbliżającym się terminie płatności składki ubezpieczeniowej:"
      : "przypominamy o zbliżających się terminach płatności składek ubezpieczeniowych:",
    "",
    ...wiersze.map((w) => `• polisa ${w.polisa} (${w.tu}), rata ${w.rata}: ${w.kwota}, termin ${w.termin}`),
    "",
    "Składkę należy opłacić na rachunek wskazany w polisie lub w wezwaniu ubezpieczyciela.",
    "Jeśli płatność została już zrealizowana, prosimy potraktować tę wiadomość jako nieaktualną.",
    "Nie odpowiadaj na tę wiadomość.",
    "",
    "—",
    podpis,
  ].join("\n");

  const komorka = "padding:8px 10px;border-bottom:1px solid #eef0f3;font-size:14px;color:#1e293b;";
  const naglowek = "padding:8px 10px;font-size:12px;color:#64748b;text-align:left;background:#f8fafc;";
  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:28px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:24px 28px 8px;">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;color:#64748b;">${esc(podpis)}</p>
        <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">Przypomnienie o płatności składki</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Dzień dobry,<br>
          ${jedna
            ? "przypominamy o zbliżającym się terminie płatności składki ubezpieczeniowej:"
            : "przypominamy o zbliżających się terminach płatności składek ubezpieczeniowych:"}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px;">
          <tr><th style="${naglowek}">Polisa</th><th style="${naglowek}">Ubezpieczyciel</th><th style="${naglowek}">Rata</th><th style="${naglowek}">Termin</th><th style="${naglowek}text-align:right;">Kwota</th></tr>
          ${wiersze.map((w) => `<tr><td style="${komorka}">${esc(w.polisa)}</td><td style="${komorka}">${esc(w.tu)}</td><td style="${komorka}">${esc(w.rata)}</td><td style="${komorka}white-space:nowrap;">${esc(w.termin)}</td><td style="${komorka}text-align:right;white-space:nowrap;font-weight:600;">${esc(w.kwota)}</td></tr>`).join("\n          ")}
        </table>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">Składkę należy opłacić na rachunek wskazany w polisie lub w wezwaniu ubezpieczyciela.</p>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">Jeśli płatność została już zrealizowana, prosimy potraktować tę wiadomość jako nieaktualną.</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#334155;font-weight:600;">Nie odpowiadaj na tę wiadomość.</p>
      </td></tr>
      <tr><td style="padding:14px 28px;border-top:1px solid #eef0f3;font-size:12px;color:#94a3b8;">${esc(podpis)}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { temat, tekst, html };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("niedozwolona metoda", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Bramka: token z Vaulta, sprawdzany przed pierwszym odczytem danych.
  const token = req.headers.get("x-cron-token") ?? "";
  if (!token) return new Response("brak nagłówka x-cron-token", { status: 401 });
  const { data: zgoda, error: bladTokenu } = await supabase.rpc("edge_cron_token_matches", { token });
  if (bladTokenu) {
    console.error("send-payment-reminders: nie mogę sprawdzić tokenu:", bladTokenu.message);
    return new Response("nie mogę sprawdzić tokenu", { status: 500 });
  }
  if (zgoda !== true) return new Response("zły nagłówek x-cron-token", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dryRun = (body as { dry_run?: unknown })?.dry_run === true;

  const { data: firmy, error: bladFirm } = await supabase
    .from("crm_tenants")
    .select("id, nazwa, resend_api_key, email_from")
    .not("resend_api_key", "is", null)
    .not("email_from", "is", null);
  if (bladFirm) {
    console.error("send-payment-reminders: firmy:", bladFirm.message);
    return json({ ok: false, powod: "firmy" }, 500);
  }

  const od = dataWarszawa(0);
  const doDnia = dataWarszawa(DNI_PRZED);
  const wynik = {
    ok: true, dry_run: dryRun, od, do: doDnia, firm: 0, wiadomosci: 0, rat: 0, bez_adresu: 0, bledy: [] as string[],
    // Tylko przy próbie: tematy i podpis (bez adresów i nazw klientów).
    podglad: [] as { temat: string; beauty: boolean; rat: number }[],
  };

  for (const firma of firmy ?? []) {
    wynik.firm++;
    const { data: raty, error } = await supabase
      .from("crm_policy_payments")
      .select("id, data_platnosci, kwota, nr_raty, crm_policies!inner(id, klient_id, parent_id, nr_polisy, deleted_at, crm_insurers(nazwa), crm_clients!klient_id(nazwa, email))")
      .eq("tenant_id", firma.id)
      .eq("status", "Oczekująca")
      .is("przypomnienie_wyslane_at", null)
      .is("crm_policies.deleted_at", null)
      .gte("data_platnosci", od)
      .lte("data_platnosci", doDnia)
      .order("data_platnosci")
      .limit(MAKS_RAT_NA_FIRME);
    if (error) {
      wynik.bledy.push(`${firma.nazwa}: odczyt rat`);
      console.error("send-payment-reminders: raty:", error.message);
      continue;
    }

    // Programy Beauty rozpoznajemy po Umowie Generalnej polisy.
    const ugIds = [...new Set(((raty ?? []) as unknown as Rata[]).map((r) => r.crm_policies?.parent_id).filter((x): x is string => !!x))];
    const beautyUg = new Set<string>();
    if (ugIds.length) {
      const { data: umowy, error: bladUmow } = await supabase.from("crm_policies").select("id, ug_podtyp").in("id", ugIds);
      if (bladUmow) console.error("send-payment-reminders: umowy generalne:", bladUmow.message);
      for (const u of umowy ?? []) if (PODTYPY_BEAUTY.includes(u.ug_podtyp ?? "")) beautyUg.add(u.id);
    }
    const czyBeauty = (lista: Rata[]) => lista.some((r) => !!r.crm_policies?.parent_id && beautyUg.has(r.crm_policies.parent_id));

    // Jedna wiadomość na adres klienta, ze wszystkimi jego ratami z okna.
    const wgAdresu = new Map<string, Rata[]>();
    for (const r of (raty ?? []) as unknown as Rata[]) {
      const adres = r.crm_policies?.crm_clients?.email?.trim() ?? "";
      if (!EMAIL_RE.test(adres)) { wynik.bez_adresu++; continue; }
      const klucz = adres.toLowerCase();
      wgAdresu.set(klucz, [...(wgAdresu.get(klucz) ?? []), r]);
    }

    for (const [adres, listaRat] of wgAdresu) {
      if (dryRun) {
        wynik.wiadomosci++;
        wynik.rat += listaRat.length;
        const beauty = czyBeauty(listaRat);
        wynik.podglad.push({ temat: zbudujMail(firma.nazwa ?? "", listaRat, beauty).temat, beauty, rat: listaRat.length });
        continue;
      }

      // Zajmujemy raty przed wysyłką; rata zajęta przez równoległe uruchomienie odpada.
      const teraz = new Date().toISOString();
      const { data: zajete, error: bladZajecia } = await supabase
        .from("crm_policy_payments")
        .update({ przypomnienie_wyslane_at: teraz })
        .in("id", listaRat.map((r) => r.id))
        .is("przypomnienie_wyslane_at", null)
        .select("id");
      if (bladZajecia) {
        wynik.bledy.push(`${firma.nazwa}: oznaczenie rat`);
        console.error("send-payment-reminders: zajęcie:", bladZajecia.message);
        continue;
      }
      const zajeteId = new Set((zajete ?? []).map((z: { id: string }) => z.id));
      const doWyslania = listaRat.filter((r) => zajeteId.has(r.id));
      if (!doWyslania.length) continue;

      const { temat, tekst, html } = zbudujMail(firma.nazwa ?? "", doWyslania, czyBeauty(doWyslania));
      // Wyjątek sieciowy traktujemy jak odmowę Resend (status 0), żeby zdjąć oznaczenie rat.
      let res: { ok: boolean; status: number; text(): Promise<string> };
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${firma.resend_api_key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: firma.email_from,
            to: [adres],
            reply_to: adresZNadawcy(firma.email_from),
            subject: temat,
            html,
            text: tekst,
          }),
        });
      } catch (e) {
        res = { ok: false, status: 0, text: async () => String(e) };
      }

      if (res.ok) {
        wynik.wiadomosci++;
        wynik.rat += doWyslania.length;
        // Historia e-maili klienta: wpis dla każdego klienta z tej wiadomości (wspólny adres = kilka kart).
        const dostawcaId = await res.text().then((t) => { try { return JSON.parse(t)?.id ?? null; } catch { return null; } });
        const wgKlienta = new Map<string, string[]>();
        for (const r of doWyslania) {
          const k = r.crm_policies?.klient_id;
          if (k) wgKlienta.set(k, [...new Set([...(wgKlienta.get(k) ?? []), r.crm_policies!.id])]);
        }
        const { error: bladHistorii } = await supabase.from("crm_client_emails").insert(
          [...wgKlienta].map(([klient_id, polisa_ids]) => ({
            tenant_id: firma.id,
            klient_id,
            polisa_ids,
            rodzaj: "przypomnienie_platnosci",
            adres,
            temat,
            tresc: tekst,
            dostawca_id: dostawcaId,
            wyslano_at: new Date().toISOString(),
          })),
        );
        if (bladHistorii) console.error("send-payment-reminders: historia e-maili:", bladHistorii.message);
        continue;
      }

      // Odmowa: zdejmujemy oznaczenie, żeby następne uruchomienie spróbowało jeszcze raz.
      await supabase.from("crm_policy_payments").update({ przypomnienie_wyslane_at: null })
        .in("id", doWyslania.map((r) => r.id));
      const odp = bezAdresow(await res.text());
      wynik.bledy.push(`${firma.nazwa}: Resend HTTP ${res.status}`);
      console.error(`send-payment-reminders: Resend odmówił (HTTP ${res.status}) dla firmy ${firma.nazwa}: ${odp}`);
      // Zły klucz albo niezweryfikowana domena nadawcy: kolejne próby dla tej firmy nic nie dadzą.
      if ([401, 403, 422].includes(res.status)) break;
    }
  }

  return json(dryRun ? wynik : { ...wynik, podglad: undefined });
});
