-- 020_add_promo_flag
--
-- Remembers the list price next to the price actually charged, so a ticket
-- line can later be told apart as promo or not. Mirrors the sheet's "Promo"
-- tick, which the app couldn't reproduce: unit_price alone doesn't say whether
-- a discount was applied.
--
-- treatment_items.normal_unit_price: services.price (or shelf_items.price) at
-- the moment of sale, a snapshot like unit_price. A line was sold on promo
-- when unit_price < normal_unit_price. Null on rows created before this
-- migration, which means "unknown", not "no promo" -- do not backfill, the
-- old list prices are not recoverable.
--
-- create_treatment() is replaced below; the only change from 018 is that it
-- fills normal_unit_price. Everything else is untouched.

alter table public.treatment_items
  add column if not exists normal_unit_price numeric
    check (normal_unit_price is null or normal_unit_price >= 0);

create or replace function public.create_treatment(
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_plate_number   text default null,
  p_treatment_type text default null,
  p_notes          text default null,
  p_price_mode     text default 'promo',
  p_discount       numeric default 0,
  p_wash_staff     text default null,
  p_qc_staff       text default null,
  p_payment_method text default null
)
returns public.treatments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pic        text;
  v_item       jsonb;
  v_quantity   integer;
  v_service    public.services;
  v_shelf      public.shelf_items;
  v_unit_price numeric;
  v_lines      jsonb := '[]'::jsonb;
  v_subtotal   numeric := 0;
  v_discount   numeric;
  v_total      numeric;
  v_code       text;
  v_treatment  public.treatments;
  v_attempt    integer;
  v_wash       text := nullif(btrim(p_wash_staff), '');
  v_qc         text := nullif(btrim(p_qc_staff), '');
begin
  -- Same gate as every other write since 014: an active profile, not just a
  -- session. Also gives us the PIC name.
  select full_name into v_pic
    from public.profiles
   where id = auth.uid() and is_active;
  if not found then
    raise exception 'Akun tidak aktif — hubungi admin';
  end if;

  if nullif(btrim(p_customer_name), '') is null then
    raise exception 'Nama pelanggan wajib diisi';
  end if;
  if nullif(btrim(p_customer_phone), '') is null then
    raise exception 'Nomor telepon wajib diisi';
  end if;
  if p_price_mode is null or p_price_mode not in ('promo', 'normal') then
    raise exception 'Mode harga tidak valid';
  end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'qris', 'transfer') then
    raise exception 'Metode pembayaran tidak valid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pilih minimal satu layanan atau barang';
  end if;

  -- Price every line from the catalog.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Jumlah item tidak valid';
    end if;

    if v_item ? 'service_id' and not (v_item ? 'shelf_item_id') then
      select * into v_service from public.services
       where id = (v_item->>'service_id')::bigint;
      if not found then
        raise exception 'Layanan tidak ditemukan';
      end if;
      v_unit_price := case
        when p_price_mode = 'promo'
         and v_service.promo_price is not null
         and v_service.promo_price < v_service.price
        then v_service.promo_price
        else v_service.price
      end;
      v_lines := v_lines || jsonb_build_object(
        'service_name', v_service.name,
        'unit_price', v_unit_price,
        'normal_unit_price', v_service.price,
        'quantity', v_quantity,
        'shelf_item_id', null
      );

    elsif v_item ? 'shelf_item_id' and not (v_item ? 'service_id') then
      select * into v_shelf from public.shelf_items
       where id = (v_item->>'shelf_item_id')::bigint and is_active;
      if not found then
        raise exception 'Barang tidak ditemukan';
      end if;
      v_unit_price := v_shelf.price;
      v_lines := v_lines || jsonb_build_object(
        'service_name', v_shelf.name,
        'unit_price', v_unit_price,
        'normal_unit_price', v_shelf.price,
        'quantity', v_quantity,
        'shelf_item_id', v_shelf.id
      );

    else
      raise exception 'Item tidak valid';
    end if;

    v_subtotal := v_subtotal + v_unit_price * v_quantity;
  end loop;

  v_discount := coalesce(p_discount, 0);
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Diskon tidak valid';
  end if;
  v_total := v_subtotal - v_discount;

  -- Same ND<yymmdd>-<4 digits> code the client used to generate, in shop
  -- time. The suffix is narrow, so retry on a collision.
  for v_attempt in 1..5 loop
    v_code := 'ND' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
              || '-' || (1000 + floor(random() * 9000))::integer;
    begin
      insert into public.treatments (
        treatment_code, customer_name, customer_phone, plate_number,
        treatment_type, pic, status, notes, subtotal, discount, total,
        wash_staff, qc_staff
      ) values (
        v_code, btrim(p_customer_name), btrim(p_customer_phone),
        nullif(upper(btrim(p_plate_number)), ''),
        nullif(btrim(p_treatment_type), ''), v_pic,
        case when p_payment_method is null then 'created' else 'paid' end,
        nullif(btrim(p_notes), ''), v_subtotal, v_discount, v_total,
        v_wash, v_qc
      )
      returning * into v_treatment;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.treatment_items (
    treatment_id, service_name, unit_price, normal_unit_price, quantity, subtotal,
    shelf_item_id
  )
  select v_treatment.id,
         line->>'service_name',
         (line->>'unit_price')::numeric,
         (line->>'normal_unit_price')::numeric,
         (line->>'quantity')::integer,
         (line->>'unit_price')::numeric * (line->>'quantity')::integer,
         (line->>'shelf_item_id')::bigint
    from jsonb_array_elements(v_lines) as line;

  insert into public.treatment_logs (treatment_id, action)
  values (v_treatment.id, 'status changed to created');
  if v_wash is not null then
    insert into public.treatment_logs (treatment_id, action)
    values (v_treatment.id, 'wash staff assigned: ' || v_wash);
  end if;
  if v_qc is not null then
    insert into public.treatment_logs (treatment_id, action)
    values (v_treatment.id, 'qc staff assigned: ' || v_qc);
  end if;

  if p_payment_method is not null then
    insert into public.payments (treatment_id, amount, payment_method)
    values (v_treatment.id, v_total, p_payment_method);
    insert into public.treatment_logs (treatment_id, action)
    values (v_treatment.id, 'status changed to paid');
  end if;

  return v_treatment;
end;
$function$;

revoke all on function public.create_treatment(text, text, jsonb, text, text, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.create_treatment(text, text, jsonb, text, text, text, text, numeric, text, text, text) to authenticated;
