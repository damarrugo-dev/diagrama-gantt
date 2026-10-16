-- Esquema de la base de datos del Diagrama de Gantt (Supabase / PostgreSQL).
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run.
-- Se puede volver a ejecutar sin perder datos (usa "if not exists" / "or replace").
--
-- Privacidad: todas las tablas tienen RLS (Row Level Security). Cada usuario solo ve
-- los proyectos que creó o en los que fue agregado como miembro. Sin iniciar sesión no se ve nada.

-- ============ Tablas ============

create table if not exists public.proyectos (
  id               uuid primary key default gen_random_uuid(),
  propietario      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre           text not null check (char_length(nombre) between 1 and 200),
  inicio           date not null default current_date,
  dias_laborables  smallint[] not null default '{1,2,3,4,5}',   -- 0 = domingo ... 6 = sábado
  horas_dia        numeric(4,2) not null default 8 check (horas_dia > 0 and horas_dia <= 24),
  moneda           text not null default 'COP',
  creado           timestamptz not null default now(),
  actualizado      timestamptz not null default now()
);

-- Personas con acceso a un proyecto ajeno (el propietario siempre tiene acceso total)
create table if not exists public.miembros (
  proyecto_id  uuid not null references public.proyectos (id) on delete cascade,
  usuario_id   uuid not null references auth.users (id) on delete cascade,
  rol          text not null default 'editor' check (rol in ('editor', 'lector')),
  primary key (proyecto_id, usuario_id)
);

-- Días festivos y días laborables especiales del calendario del proyecto
create table if not exists public.excepciones_calendario (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references public.proyectos (id) on delete cascade,
  fecha        date not null,
  laborable    boolean not null default false,
  nombre       text,
  unique (proyecto_id, fecha)
);

create table if not exists public.tareas (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid not null references public.proyectos (id) on delete cascade,
  posicion           integer not null default 0,               -- orden en la lista (Id de fila)
  nivel              smallint not null default 1 check (nivel between 1 and 20),  -- nivel de esquema
  nombre             text not null default '',
  duracion           numeric(10,2) not null default 1 check (duracion >= 0),     -- días laborables; 0 = hito
  modo               text not null default 'auto' check (modo in ('auto', 'manual')),
  comienzo_manual    date,
  restriccion        text not null default 'ASAP'
                       check (restriccion in ('ASAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO')),
  fecha_restriccion  date,
  fecha_limite       date,
  porcentaje         smallint not null default 0 check (porcentaje between 0 and 100),
  costo_fijo         numeric(14,2) not null default 0,
  notas              text,
  lb_comienzo        date,      -- línea base
  lb_fin             date,
  lb_duracion        numeric(10,2),
  lb_costo           numeric(14,2),
  color              text,
  unique (proyecto_id, id)
);
create index if not exists tareas_proyecto_idx on public.tareas (proyecto_id, posicion);

-- Vínculos entre tareas: FS = fin-comienzo, SS = comienzo-comienzo, FF = fin-fin, SF = comienzo-fin
create table if not exists public.dependencias (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references public.proyectos (id) on delete cascade,
  predecesora  uuid not null,
  sucesora     uuid not null,
  tipo         text not null default 'FS' check (tipo in ('FS', 'SS', 'FF', 'SF')),
  retraso      numeric(10,2) not null default 0,               -- días; negativo = adelanto
  check (predecesora <> sucesora),
  unique (predecesora, sucesora),
  foreign key (proyecto_id, predecesora) references public.tareas (proyecto_id, id) on delete cascade,
  foreign key (proyecto_id, sucesora)    references public.tareas (proyecto_id, id) on delete cascade
);
create index if not exists dependencias_proyecto_idx on public.dependencias (proyecto_id);

create table if not exists public.recursos (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references public.proyectos (id) on delete cascade,
  nombre         text not null,
  iniciales      text,
  tipo           text not null default 'trabajo' check (tipo in ('trabajo', 'material', 'costo')),
  max_unidades   numeric(6,2) not null default 1 check (max_unidades >= 0),   -- 1 = 100 %
  tasa_estandar  numeric(14,2) not null default 0,   -- por hora (trabajo) o por unidad (material)
  costo_por_uso  numeric(14,2) not null default 0,
  grupo          text,
  correo         text,
  unique (proyecto_id, id)
);
create index if not exists recursos_proyecto_idx on public.recursos (proyecto_id);

create table if not exists public.asignaciones (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references public.proyectos (id) on delete cascade,
  tarea_id     uuid not null,
  recurso_id   uuid not null,
  unidades     numeric(6,2) not null default 1 check (unidades >= 0),
  unique (tarea_id, recurso_id),
  foreign key (proyecto_id, tarea_id)   references public.tareas (proyecto_id, id) on delete cascade,
  foreign key (proyecto_id, recurso_id) references public.recursos (proyecto_id, id) on delete cascade
);
create index if not exists asignaciones_proyecto_idx on public.asignaciones (proyecto_id);

-- ============ Fecha de última modificación ============
-- La aplicación actualiza la fila del proyecto en cada guardado; esto le pone la hora.

create or replace function public.marcar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists marcar_actualizado on public.proyectos;
create trigger marcar_actualizado before update on public.proyectos
  for each row execute function public.marcar_actualizado();

-- ============ Permisos (RLS) ============

create or replace function public.puede_ver(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.proyectos where id = p and propietario = auth.uid())
      or exists (select 1 from public.miembros  where proyecto_id = p and usuario_id = auth.uid());
$$;

create or replace function public.puede_editar(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.proyectos where id = p and propietario = auth.uid())
      or exists (select 1 from public.miembros  where proyecto_id = p and usuario_id = auth.uid() and rol = 'editor');
$$;

alter table public.proyectos              enable row level security;
alter table public.miembros               enable row level security;
alter table public.excepciones_calendario enable row level security;
alter table public.tareas                 enable row level security;
alter table public.dependencias           enable row level security;
alter table public.recursos               enable row level security;
alter table public.asignaciones           enable row level security;

drop policy if exists ver      on public.proyectos;
drop policy if exists crear    on public.proyectos;
drop policy if exists editar   on public.proyectos;
drop policy if exists eliminar on public.proyectos;
create policy ver      on public.proyectos for select to authenticated using (public.puede_ver(id));
create policy crear    on public.proyectos for insert to authenticated with check (propietario = auth.uid());
create policy editar   on public.proyectos for update to authenticated using (public.puede_editar(id)) with check (public.puede_editar(id));
create policy eliminar on public.proyectos for delete to authenticated using (propietario = auth.uid());

drop policy if exists ver        on public.miembros;
drop policy if exists administrar on public.miembros;
create policy ver         on public.miembros for select to authenticated using (public.puede_ver(proyecto_id));
create policy administrar on public.miembros for all to authenticated
  using (exists (select 1 from public.proyectos where id = proyecto_id and propietario = auth.uid()))
  with check (exists (select 1 from public.proyectos where id = proyecto_id and propietario = auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['excepciones_calendario', 'tareas', 'dependencias', 'recursos', 'asignaciones'] loop
    execute format('drop policy if exists ver on public.%I', t);
    execute format('drop policy if exists editar on public.%I', t);
    execute format('create policy ver on public.%I for select to authenticated using (public.puede_ver(proyecto_id))', t);
    execute format('create policy editar on public.%I for all to authenticated
                    using (public.puede_editar(proyecto_id)) with check (public.puede_editar(proyecto_id))', t);
  end loop;
end $$;

-- Nadie sin sesión iniciada puede tocar las tablas
revoke all on public.proyectos, public.miembros, public.excepciones_calendario, public.tareas,
              public.dependencias, public.recursos, public.asignaciones from anon;
