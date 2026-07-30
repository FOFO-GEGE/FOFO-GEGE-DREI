// Deployed to the 'mirroir' Supabase project. Kept here for version control.
//
// Sends the reminder pings that are due right now.
//
// The scheduling logic lives in SQL (mirroir_due_pings), where the per-user
// timezone maths already is; this function is only the Web Push transport.
// That function also claims each ping as it hands it out, so overlapping runs
// cannot double-send.
//
// Requires one secret: VAPID_PRIVATE_KEY. verify_jwt stays on, so the caller
// must present the service-role key — the pg_cron job does.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC = 'BEQDVYh644Rp_sVoE672_uAwWEckj_sAPULiCVTmU4bW-2t-uoauicyDC80xhRiofyCe-CO_rExiqaGEafOsW7I';
const VAPID_SUBJECT = 'mailto:contact@mirroir.app';

Deno.serve(async () => {
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!privateKey) {
    return json({ error: 'VAPID_PRIVATE_KEY is not set' }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, privateKey);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: pings, error } = await supabase.rpc('mirroir_due_pings');
  if (error) return json({ error: error.message }, 500);
  if (!pings?.length) return json({ sent: 0 });

  let sent = 0;
  const stale: string[] = [];

  await Promise.all(pings.map(async (p: Record<string, string>) => {
    const subscription = {
      endpoint: p.endpoint,
      keys: { p256dh: p.p256dh, auth: p.auth_key },
    };
    const payload = JSON.stringify({ title: p.title, body: p.body });
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 3000 });
      sent++;
    } catch (e) {
      // 404/410 mean the browser dropped the subscription for good.
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) stale.push(p.endpoint);
      else console.error('push failed', status, (e as Error).message);
    }
  }));

  if (stale.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale);
  }

  return json({ sent, pruned: stale.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
