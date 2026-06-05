import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (_req) => {
  let tenants_processed = 0;
  let emails_sent = 0;
  const errors: string[] = [];

  // Fetch all tenants with a Resend API key configured
  const { data: tenants, error: tenantsError } = await supabase
    .from('crm_tenants')
    .select('id, resend_api_key, nazwa')
    .not('resend_api_key', 'is', null);

  if (tenantsError) {
    return Response.json({ error: tenantsError.message }, { status: 500 });
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const plus7 = new Date(today);
  plus7.setDate(plus7.getDate() + 7);
  const plus7Str = plus7.toISOString().slice(0, 10);

  for (const tenant of tenants ?? []) {
    try {
      tenants_processed++;

      // Query upcoming payments for this tenant
      const { data: payments, error: paymentsError } = await supabase
        .from('crm_policy_payments')
        .select('id, data_platnosci, kwota, crm_policies(nr_polisy, crm_clients(nazwa, email))')
        .eq('tenant_id', tenant.id)
        .eq('status', 'Oczekująca')
        .gte('data_platnosci', todayStr)
        .lte('data_platnosci', plus7Str);

      if (paymentsError) {
        errors.push(`Tenant ${tenant.nazwa}: ${paymentsError.message}`);
        continue;
      }

      if (!payments || payments.length === 0) continue;

      // Group by client email
      type PaymentWithPolicy = {
        id: string;
        data_platnosci: string;
        kwota: number;
        crm_policies: {
          nr_polisy: string;
          crm_clients: { nazwa: string; email: string | null } | null;
        } | null;
      };

      const byEmail = new Map<string, { clientName: string; items: { nr_polisy: string; data_platnosci: string; kwota: number }[] }>();

      for (const p of payments as PaymentWithPolicy[]) {
        const client = p.crm_policies?.crm_clients;
        if (!client?.email) continue;
        if (!byEmail.has(client.email)) {
          byEmail.set(client.email, { clientName: client.nazwa, items: [] });
        }
        byEmail.get(client.email)!.items.push({
          nr_polisy: p.crm_policies?.nr_polisy ?? '—',
          data_platnosci: p.data_platnosci,
          kwota: p.kwota,
        });
      }

      for (const [email, { clientName, items }] of byEmail) {
        const rowsHtml = items
          .map(
            (it) =>
              `<tr>
                <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;">${it.nr_polisy}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;">${it.data_platnosci}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;text-align:right;">${Number(it.kwota).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</td>
              </tr>`
          )
          .join('');

        const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Przypomnienie o płatności</title></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:600px;margin:auto;padding:24px;">
  <h2 style="color:#2563eb;">Przypomnienie o płatności</h2>
  <p>Drogi/a <strong>${clientName}</strong>,</p>
  <p>Przypominamy o zbliżających się płatnościach składek ubezpieczeniowych:</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead>
      <tr style="background:#f8fafc;text-align:left;">
        <th style="padding:8px 12px;font-size:12px;color:#64748b;">Nr polisy</th>
        <th style="padding:8px 12px;font-size:12px;color:#64748b;">Termin płatności</th>
        <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:right;">Kwota</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="margin-top:24px;font-size:13px;color:#64748b;">Wiadomość wysłana automatycznie przez system ${tenant.nazwa}.</p>
</body>
</html>`;

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tenant.resend_api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'onboarding@resend.dev',
            to: [email],
            subject: `Przypomnienie o płatności — ${clientName}`,
            html,
          }),
        });

        if (resendRes.ok) {
          emails_sent++;
        } else {
          const errBody = await resendRes.text();
          errors.push(`Tenant ${tenant.nazwa}, email ${email}: ${errBody}`);
        }
      }
    } catch (err: unknown) {
      errors.push(`Tenant ${tenant.nazwa}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({ tenants_processed, emails_sent, errors });
});
