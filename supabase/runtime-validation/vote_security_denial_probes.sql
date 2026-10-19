-- MUTATION-SHAPED PRIVILEGE PROBES. Local KANDID only.
-- Run only after target identity is verified. Every probe is wrapped in a nested
-- subtransaction, and the outer transaction always rolls back. No row-producing
-- INSERT/UPDATE/DELETE is used. TRUNCATE is transactionally rolled back if it
-- unexpectedly succeeds; the resulting exception also rolls back its subtransaction.

begin;
set local role anon;

do $probe$
declare
  table_name text;
  operation text;
  statement text;
begin
  foreach table_name in array array['votes', 'vote_ballots'] loop
    foreach operation in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      statement := case operation
        when 'select' then format('select 1 from public.%I limit 0', table_name)
        when 'insert' then format('insert into public.%I default values', table_name)
        when 'update' then format('update public.%I set id = id where false', table_name)
        when 'delete' then format('delete from public.%I where false', table_name)
        when 'truncate' then format('truncate table public.%I', table_name)
      end;
      begin
        execute statement;
        raise exception using errcode = 'P0001', message = format('UNEXPECTEDLY ALLOWED: anon %s on public.%s', operation, table_name);
      exception
        when insufficient_privilege then
          raise notice 'PASS: anon % denied on public.%', operation, table_name;
      end;
    end loop;
  end loop;
end
$probe$;

rollback;

begin;
set local role authenticated;

do $probe$
declare
  table_name text;
  operation text;
  statement text;
begin
  foreach table_name in array array['votes', 'vote_ballots'] loop
    foreach operation in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      statement := case operation
        when 'select' then format('select 1 from public.%I limit 0', table_name)
        when 'insert' then format('insert into public.%I default values', table_name)
        when 'update' then format('update public.%I set id = id where false', table_name)
        when 'delete' then format('delete from public.%I where false', table_name)
        when 'truncate' then format('truncate table public.%I', table_name)
      end;
      begin
        execute statement;
        raise exception using errcode = 'P0001', message = format('UNEXPECTEDLY ALLOWED: authenticated %s on public.%s', operation, table_name);
      exception
        when insufficient_privilege then
          raise notice 'PASS: authenticated % denied on public.%', operation, table_name;
      end;
    end loop;
  end loop;
end
$probe$;

rollback;
