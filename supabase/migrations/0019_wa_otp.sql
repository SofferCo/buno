-- buno — WhatsApp login-OTP support (A1 onboarding auth).
-- Native Supabase phone auth mints the session; this RPC lets the freshly
-- authenticated user attach their own verified phone to whatsapp_link, so the
-- inbound WhatsApp webhook can resolve them. SECURITY DEFINER, but it links ONLY
-- the caller's own phone (from the verified JWT) — never an arbitrary number.
create or replace function public.claim_whatsapp_link()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ph  text := nullif(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g'), '');
begin
  if uid is null or ph is null then
    raise exception 'not authenticated with a verified phone';
  end if;
  insert into whatsapp_link (user_id, phone, verified, created_at)
  values (uid, ph, true, now())
  on conflict (user_id) do update set phone = excluded.phone, verified = true;
end;
$$;

grant execute on function public.claim_whatsapp_link() to authenticated;
