-- SQL Editor only, after common-auth.sql. All test changes are rolled back.
-- Requires existing entry, storage, room and enabled common-admin records.
begin;
do $$
declare
  v_actor text;
  v_author text;
  v_entry uuid;
  v_storage uuid;
  v_room uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if (select count(*) from pg_trigger where tgname = 'business_black_garlic_write_guard' and not tgisinternal) <> 9 then
    raise exception 'Expected nine common-auth write guards.';
  end if;
  select id, worker_id into v_entry, v_author from public.black_garlic_entries order by entry_date, id limit 1;
  select id into v_storage from public.black_garlic_storage_entries order by storage_date, id limit 1;
  select id into v_room from public.black_garlic_rooms order by id limit 1;
  select p.worker_id into v_actor from business_private.permissions p
    join business_private.users u using (worker_id)
    where p.app_id = 'black_garlic' and p.role = 'admin' and u.enabled
      and u.pin_hash is not null and p.worker_id is distinct from v_author limit 1;
  if v_entry is null or v_storage is null or v_room is null or v_actor is null then
    raise exception 'Required existing test records are unavailable.';
  end if;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  begin
    update public.black_garlic_entries set note = note where id = v_entry;
    raise exception 'Anonymous update was unexpectedly allowed.';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.black_garlic_storage_entries where id = v_storage;
    raise exception 'Anonymous delete was unexpectedly allowed.';
  exception when insufficient_privilege then null;
  end;

  insert into business_private.sessions(token_hash, worker_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_actor, now() + interval '5 minutes');
  perform set_config('request.headers', jsonb_build_object('x-business-session', v_token)::text, true);
  if business_private.actor() is distinct from v_actor then
    raise exception 'Test session was not recognized.';
  end if;
  update business_private.permissions set role = 'viewer' where worker_id = v_actor and app_id = 'black_garlic';
  begin
    update public.black_garlic_entries set inventory_qty = inventory_qty where id = v_entry;
    raise exception 'Viewer update was unexpectedly allowed.';
  exception when insufficient_privilege then null;
  end;

  update business_private.permissions set role = 'operator' where worker_id = v_actor and app_id = 'black_garlic';
  update public.black_garlic_entries set inventory_qty = inventory_qty where id = v_entry;
  begin
    update public.black_garlic_entries set note = coalesce(note, '') || ' QA' where id = v_entry;
    raise exception 'Mismatched registration worker was unexpectedly allowed.';
  exception when insufficient_privilege then null;
  end;
  update public.black_garlic_storage_entries set worker_id = v_actor where id = v_storage;
  begin
    update public.black_garlic_rooms set room_name = room_name where id = v_room;
    raise exception 'Operator master update was unexpectedly allowed.';
  exception when insufficient_privilege then null;
  end;

  update business_private.permissions set role = 'admin' where worker_id = v_actor and app_id = 'black_garlic';
  update public.black_garlic_rooms set room_name = room_name where id = v_room;
end;
$$;
rollback;
select 'Common authentication checks passed; all test changes rolled back.' as result;
