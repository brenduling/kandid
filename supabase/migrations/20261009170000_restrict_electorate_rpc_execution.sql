begin;

do $preflight$
declare
  signature text;
begin
  foreach signature in array array[
    'public.kandid_get_board_election_report_package(integer)',
    'public.kandid_get_board_electorate_preview(integer)',
    'public.kandid_get_election_turnout(integer)',
    'public.kandid_is_locked_electorate_member(integer,integer)',
    'public.kandid_lock_board_electorate(integer)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Required authorization RPC is missing: %.', signature;
    end if;
  end loop;
end
$preflight$;

-- Board reports, previews, locks, and turnout are authenticated-user RPCs;
-- each function enforces the caller's active account, role, and scope itself.
revoke all on function public.kandid_get_board_election_report_package(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_election_report_package(integer)
  to authenticated;

revoke all on function public.kandid_get_board_electorate_preview(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_electorate_preview(integer)
  to authenticated;

revoke all on function public.kandid_get_election_turnout(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_election_turnout(integer)
  to authenticated;

revoke all on function public.kandid_lock_board_electorate(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_lock_board_electorate(integer)
  to authenticated;

-- submit-vote uses the service-role client only after authenticating the
-- Student, checking election phase, and deriving the Student ID from Auth.
revoke all on function public.kandid_is_locked_electorate_member(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_is_locked_electorate_member(integer, integer)
  to service_role;

do $postflight$
begin
  if not has_function_privilege('authenticated', 'public.kandid_get_board_election_report_package(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_get_board_election_report_package(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.kandid_get_board_election_report_package(integer)', 'EXECUTE') then
    raise exception 'Board report RPC execution privileges do not match the authenticated-only contract.';
  end if;

  if not has_function_privilege('authenticated', 'public.kandid_get_board_electorate_preview(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_get_board_electorate_preview(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.kandid_get_board_electorate_preview(integer)', 'EXECUTE') then
    raise exception 'Board electorate preview RPC execution privileges do not match the authenticated-only contract.';
  end if;

  if not has_function_privilege('authenticated', 'public.kandid_get_election_turnout(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_get_election_turnout(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.kandid_get_election_turnout(integer)', 'EXECUTE') then
    raise exception 'Election turnout RPC execution privileges do not match the authenticated-only contract.';
  end if;

  if not has_function_privilege('authenticated', 'public.kandid_lock_board_electorate(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_lock_board_electorate(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.kandid_lock_board_electorate(integer)', 'EXECUTE') then
    raise exception 'Board electorate lock RPC execution privileges do not match the authenticated-only contract.';
  end if;

  if not has_function_privilege('service_role', 'public.kandid_is_locked_electorate_member(integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.kandid_is_locked_electorate_member(integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kandid_is_locked_electorate_member(integer,integer)', 'EXECUTE') then
    raise exception 'Locked electorate membership RPC execution privileges do not match the service-role-only contract.';
  end if;
end
$postflight$;

commit;
