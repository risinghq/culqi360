import type {
  SafeappSnapshot,
  SourceRow,
  SourceTable,
} from "~/server/cutover/safeapp/source";

// An invented safeapp: two tiendas, one user per role, two clientes, one case
// of each type, three datos in two campaigns and two calls. Every value is
// made up.
const BASE: Record<SourceTable, SourceRow[]> = {
  tienda: [
    { id_tienda: "1", nombre: "Tienda Uno" },
    { id_tienda: "2", nombre: "Tienda Dos" },
  ],
  rol: [
    { id_rol: "1", nombre_rol: "ADMINISTRADOR" },
    { id_rol: "2", nombre_rol: "SUPERVISOR" },
    { id_rol: "3", nombre_rol: "AGENTE" },
  ],
  menu: [
    { id_menu: "10", permiso: "notacargo.movil.registrar" },
    { id_menu: "11", permiso: "notacargo.movil.validar" },
    { id_menu: "12", permiso: "notacargo.movil.back" },
    { id_menu: "13", permiso: "liquidacion.gestionar" },
  ],
  usuario: [
    {
      id_usuario: "1",
      usuario: "Admin.Demo",
      personal: "Ana Admin Demo",
      id_rol: "1",
      estado: "1",
      correo: "admin@demo.invalid",
    },
    {
      id_usuario: "2",
      usuario: "ejecutivo.demo",
      personal: "Eva Maria Ejecutiva Demo",
      id_rol: "3",
      estado: "1",
      correo: "ejecutivo@demo.invalid",
    },
    {
      id_usuario: "3",
      usuario: "validador.demo",
      personal: "Victor Validador",
      id_rol: "2",
      estado: "1",
      correo: "ejecutivo@demo.invalid",
    },
    {
      id_usuario: "4",
      usuario: "back.demo",
      personal: "Bruno Back Demo",
      id_rol: "3",
      estado: "0",
      correo: null,
    },
    {
      id_usuario: "5",
      usuario: "liquidador.demo",
      personal: "Lucia Liquidadora Demo",
      id_rol: "2",
      estado: "1",
      correo: "",
    },
  ],
  acceso: [
    { id_usuario: "2", id_menu: "10" },
    { id_usuario: "3", id_menu: "11" },
    { id_usuario: "4", id_menu: "12" },
    { id_usuario: "5", id_menu: "11" },
    { id_usuario: "5", id_menu: "13" },
  ],
  asignacion_tienda: [
    { id_usuario: "2", id_tienda: "2", estado: "1" },
    { id_usuario: "2", id_tienda: "1", estado: "0" },
    { id_usuario: "3", id_tienda: "1", estado: "0" },
    { id_usuario: "4", id_tienda: "2", estado: "0" },
  ],
  cliente: [
    {
      id_cliente: "1",
      ruc: "20999999001",
      razon_social: "Empresa Demo Uno SAC",
    },
    { id_cliente: "2", ruc: " 20999999002 ", razon_social: "" },
  ],
  cartera: [
    { id_cartera: "1", nombre: "CARTERA ACTIVA", estado: "1" },
    { id_cartera: "2", nombre: "CARTERA ANTIGUA", estado: "0" },
    { id_cartera: "3", nombre: "CARTERA SIN USO", estado: "0" },
  ],
  producto: [
    {
      id: "1",
      tipo: "FIJA",
      subtipo: "INTERNET",
      descripcion: "200 MB",
      estado: "1",
    },
    {
      id: "2",
      tipo: "FIJA",
      subtipo: "INTERNET",
      descripcion: "50 MB",
      estado: "0",
    },
    { id: "3", tipo: "MOVIL", subtipo: "PLAN", descripcion: "M4", estado: "1" },
  ],
  nc_movil: [
    {
      id_cargo: "100",
      id_usuario: "2",
      id_cliente: "1",
      id_cartera: "2",
      fecha_ingreso: "2026-03-02",
      zonal: "1",
      q_lineas: "5",
      cargo_fijo: "120.50",
      modalidad: "PORTABILIDAD",
      contacto: "Contacto Demo",
      telefono1: "900000001",
      telefono2: "",
      validacion: "PROCEDE",
      id_validador: "3",
      fecha_validacion: "2026-03-03",
      estado: "ACTIVADO",
      id_back: "4",
      fecha_actualizacion: "2026-03-10",
      fecha_liquidacion: "2026-04-01",
      comision: "SI",
      descuento: "NO",
    },
  ],
  nc_fija: [
    {
      id_cargo: "200",
      id_usuario: "2",
      id_cliente: "2",
      fecha_ingreso: "2026-05-04",
      subtipo: "INTERNET",
      descripcion: "50 MB",
      cargo_fijo: "80",
      zonal: "2",
      validacion: "PENDIENTE",
      id_validador: "0",
      fecha_validacion: "0000-00-00",
      estado: "XINGRESAR",
      id_back: "0",
      fecha_actualizacion: null,
    },
  ],
  quiebre: [
    {
      id_quiebre: "300",
      id_usuario: "2",
      id_cliente: "1",
      zonal_telefonica: "2",
      fecha_registro: "2026-06-01",
      estado: "PROCESANDO",
      id_validador: "3",
      fecha_validacion: "2026-06-02",
      caso_sf: "SF-1",
      back: "texto antiguo",
      validacion: "texto antiguo",
    },
  ],
  datos: [
    {
      id_dato: "1",
      id_cliente: "1",
      origen: "BASE NOVIEMBRE",
      tipo_data: "MOVIL",
      estado: "1",
      zonal: "LIMA",
      nodo: "N1",
      q_movistar: "3",
      q_entel: "0",
      q_claro: "",
      q_bitel: null,
    },
    {
      id_dato: "2",
      id_cliente: "2",
      origen: "BASE NOVIEMBRE",
      tipo_data: "MOVIL",
      estado: "0",
    },
    {
      id_dato: "3",
      id_cliente: "1",
      origen: "INHOUSE",
      tipo_data: "FIJA",
      estado: "0",
    },
  ],
  asignacion_datos: [
    {
      id_asignacion: "1",
      id_dato: "1",
      id_usuario: "2",
      fecha_asignacion: "2026-10-01",
      fecha_liberacion: null,
      activa: "1",
    },
    {
      id_asignacion: "2",
      id_dato: "2",
      id_usuario: "2",
      fecha_asignacion: "2026-10-01",
      fecha_liberacion: "2026-10-05",
      activa: null,
    },
    {
      id_asignacion: "3",
      id_dato: "2",
      id_usuario: "3",
      fecha_asignacion: "2026-10-06",
      fecha_liberacion: null,
      activa: "1",
    },
  ],
  respuesta: [
    {
      id_respuesta: "1",
      descripcion: "NO CONTESTA",
      tipo: "LLAMADA",
      contactabilidad: "0",
      negociacion: "0",
      volverllamar: "0",
    },
    {
      id_respuesta: "2",
      descripcion: "VOLVER A LLAMAR",
      tipo: "LLAMADA",
      contactabilidad: "1",
      negociacion: "0",
      volverllamar: "1",
    },
    {
      id_respuesta: "3",
      descripcion: "VISITA REALIZADA",
      tipo: "VISITA",
      contactabilidad: "1",
      negociacion: null,
      volverllamar: null,
    },
  ],
  llamada: [
    {
      id_llamada: "1",
      id_usuario: "2",
      id_respuesta: "2",
      fecha: "2026-10-02 10:30:00",
      id_cliente: "1",
      id_dato: "1",
      telefono: "900000002",
      nombre_contacto: "Contacto Demo",
      correo: "contacto@demo.invalid",
      comentario: "Llamar el lunes",
    },
    {
      id_llamada: "2",
      id_usuario: "2",
      id_respuesta: "1",
      fecha: "2026-10-03 09:00:00",
      id_cliente: "2",
      id_dato: null,
      telefono: "",
      nombre_contacto: null,
      correo: null,
      comentario: null,
    },
  ],
};

export function safeappSnapshot(
  overrides: Partial<Record<SourceTable, SourceRow[]>> = {},
): SafeappSnapshot {
  return { ...BASE, ...overrides };
}

export function sequentialIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-7000-8000-${String(next).padStart(12, "0")}`;
  };
}
