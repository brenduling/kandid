-- WITHDRAWN / NO-GO: pg_net queued-header credential exposure. Do not execute.
-- Retained only as historical local preparation; use the GitHub Actions proposal.
-- Approval-gated activation SQL. Do not run until worker deployment, secret
-- presence, auth preflight, and backlog processing have been separately approved.
-- The request's headers are queued in pg_net; see the migration's trust warning.

do $activate_anchor_worker$
declare
  v_job_id bigint;
  v_schedule constant text := '*/5 * * * *';
  v_command constant text := $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'kandid_anchor_function_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'kandid_anchor_gateway_jwt'
        ),
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'kandid_anchor_publishable_key'
        ),
        'x-anchor-worker-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'kandid_anchor_worker_token'
        )
      ),
      body := jsonb_build_object('source', 'kandid-supabase-cron'),
      timeout_milliseconds := 90000
    );
  $job$;
begin
  if current_user <> 'postgres' then
    raise exception 'Anchor Cron activation must run as postgres';
  end if;

  if (
    select count(distinct name)
    from vault.decrypted_secrets
    where name in (
      'kandid_anchor_function_url',
      'kandid_anchor_gateway_jwt',
      'kandid_anchor_publishable_key',
      'kandid_anchor_worker_token'
    ) and decrypted_secret is not null and decrypted_secret <> ''
  ) <> 3 then
    raise exception 'Required Anchor Cron Vault secrets are missing';
  end if;

  select jobid into v_job_id
  from cron.job
  where jobname = 'kandid-anchor-ballot-hashes';

  if found then
    if exists (
      select 1
      from cron.job
      where jobid = v_job_id
        and (schedule <> v_schedule or command <> v_command)
    ) then
      raise exception 'Existing job name is owned by a different schedule';
    end if;
    perform cron.alter_job(v_job_id, active := true);
  else
    select cron.schedule(
      'kandid-anchor-ballot-hashes',
      v_schedule,
      v_command
    ) into v_job_id;
  end if;
end;
$activate_anchor_worker$;
