begin;

revoke insert on table public.votes from anon;
revoke insert on table public.votes from authenticated;

commit;
