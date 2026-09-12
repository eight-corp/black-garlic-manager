-- Deploy the common-menu UI before running this transaction.
begin;

do $$
begin
  if not exists (
    select 1
    from business_private.permissions p
    join business_private.users u using (worker_id)
    where p.app_id = 'black_garlic'
      and p.role = 'admin'
      and u.enabled
      and u.pin_hash is not null
  ) then
    raise exception 'Configure an enabled black-garlic administrator and common PIN first.';
  end if;
end;
$$;

create or replace function business_private.black_garlic_write_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, business_private
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
begin
  if v_role in ('anon', 'authenticated') then
    if not public.business_can('black_garlic', TG_ARGV[0]) then
      raise exception 'Common login and application permission are required.' using errcode = '42501';
    end if;
    if TG_TABLE_NAME in ('black_garlic_entries', 'black_garlic_storage_entries')
       and TG_OP in ('INSERT', 'UPDATE')
       and (to_jsonb(new)->>'worker_id') is distinct from business_private.actor() then
      -- Inventory recalculation preserves the original registration worker.
      if TG_OP <> 'UPDATE' or TG_TABLE_NAME <> 'black_garlic_entries' then
        raise exception 'Registration worker must match the common login.' using errcode = '42501';
      elsif (to_jsonb(new) - 'inventory_qty' - 'updated_at') is distinct from
            (to_jsonb(old) - 'inventory_qty' - 'updated_at') then
        raise exception 'Registration worker must match the common login.' using errcode = '42501';
      end if;
    end if;
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

revoke all on function business_private.black_garlic_write_guard() from public, anon, authenticated;

do $$
declare
  v_table text;
  v_minimum text;
begin
  foreach v_table in array array[
    'black_garlic_rooms', 'black_garlic_types', 'black_garlic_storage_types',
    'black_garlic_harvest_lots', 'black_garlic_age_brackets', 'black_garlic_maturation_rules',
    'black_garlic_entries', 'black_garlic_storage_entries', 'black_garlic_settings'
  ] loop
    v_minimum := case
      when v_table in ('black_garlic_entries', 'black_garlic_storage_entries', 'black_garlic_settings') then 'operator'
      else 'admin'
    end;
    execute format('drop trigger if exists business_black_garlic_write_guard on public.%I', v_table);
    execute format(
      'create trigger business_black_garlic_write_guard before insert or update or delete on public.%I for each row execute function business_private.black_garlic_write_guard(%L)',
      v_table, v_minimum
    );
  end loop;
end;
$$;

update business_private.apps set migrated = true where app_id = 'black_garlic';
commit;
