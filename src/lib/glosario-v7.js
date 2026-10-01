// El texto del glosario de v7, tal cual: «Production Analyzer» y «Network Analyzer».
//
// PORTADO de `public/js/glosario.js` de v7 (origin/master, líneas 24-923). El contenido NO se reescribe
// ni se resume: es el que los consultores llevan años leyendo delante de clientes. Lo único que cambia
// es el envoltorio —v7 era un IIFE que colgaba funciones de `window`; aquí es un módulo—, y que la
// traducción al inglés (`_t`) queda como identidad hasta la fase de idiomas.
//
// Cada sección genera HTML como cadena, igual que en v7. Es texto fijo escrito por nosotros, sin
// ningún dato del usuario ni de SAP, así que pintarlo con `dangerouslySetInnerHTML` no abre nada.

const _t = (s) => s

/* ─── MICRO-HELPERS ─────────────────────────────────────────── */
function badge(sev) {
  var map = {
    red:    '<span class="glos-badge glos-red">' + _t('⛔ Alerta') + '</span>',
    yellow: '<span class="glos-badge glos-yellow">' + _t('⚠ Advertencia') + '</span>',
    ok:     '<span class="glos-badge glos-ok">' + _t('✅ OK') + '</span>',
    info:   '<span class="glos-badge glos-info">' + _t('ℹ Info') + '</span>'
  };
  return map[sev] || '';
}
function catBadge(cat) {
  var map = {
    finished:      '<span class="glos-cat glos-cat-finished">' + _t('Terminado') + '</span>',
    semi:          '<span class="glos-cat glos-cat-semi">' + _t('Semiterminado') + '</span>',
    rawmat:        '<span class="glos-cat glos-cat-rawmat">' + _t('Mat. Prima') + '</span>',
    trading:       '<span class="glos-cat glos-cat-trading">' + _t('Mercadería') + '</span>',
    uncategorized: '<span class="glos-cat glos-cat-uncategorized">' + _t('Sin cat.') + '</span>',
    all:           '<span class="glos-cat glos-cat-all">' + _t('Todos') + '</span>'
  };
  return (cat || []).map(function (c) { return map[c] || ''; }).join(' ');
}

function obsTable(rows) {
  var header = '<tr><th>' + _t('Texto en Excel') + '</th><th>' + _t('Estado') + '</th><th>' + _t('Aplica a') + '</th><th>' + _t('Por qué aparece') + '</th><th>' + _t('Qué revisar en IBP') + '</th></tr>';
  var body = rows.map(function (r) {
    return '<tr class="glos-obs-' + r[1] + '">' +
      '<td><code class="glos-obs-code">' + r[0] + '</code></td>' +
      '<td>' + badge(r[1]) + '</td>' +
      '<td>' + catBadge(r[2]) + '</td>' +
      '<td class="glos-obs-cause">' + r[3] + '</td>' +
      '<td class="glos-obs-action">' + r[4] + '</td>' +
      '</tr>';
  }).join('');
  return '<div class="glos-table-wrap"><table class="glos-obs-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
}

function colTable(rows) {
  var header = '<tr><th>' + _t('Columna') + '</th><th>' + _t('Qué significa') + '</th></tr>';
  var body = rows.map(function (r) {
    return '<tr><td><strong class="glos-col-name">' + r[0] + '</strong></td><td>' + r[1] + '</td></tr>';
  }).join('');
  return '<div class="glos-table-wrap"><table class="glos-col-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
}

function netStatusTable(rows) {
  var header = '<tr><th>' + _t('Estado de la Red') + '</th><th>' + _t('Estado') + '</th><th>' + _t('Aplica a') + '</th><th>' + _t('Significado') + '</th></tr>';
  var body = rows.map(function (r) {
    return '<tr class="glos-obs-' + r[1] + '">' +
      '<td><code class="glos-obs-code">' + r[0] + '</code></td>' +
      '<td>' + badge(r[1]) + '</td>' +
      '<td>' + catBadge(r[2]) + '</td>' +
      '<td class="glos-obs-cause">' + r[3] + '</td>' +
      '</tr>';
  }).join('');
  return '<div class="glos-table-wrap"><table class="glos-obs-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
}

function section(id, icon, title, content) {
  return '<section class="glos-section" id="' + id + '">' +
    '<h2 class="glos-section-title">' + icon + ' ' + title + '</h2>' +
    content + '</section>';
}

function sub(title, content) {
  return '<div class="glos-sub"><h3 class="glos-sub-title">' + title + '</h3>' + content + '</div>';
}

function callout(type, text) {
  return '<div class="glos-callout glos-callout-' + type + '">' + text + '</div>';
}

function p(text) { return '<p class="glos-p">' + text + '</p>'; }

/* ─── LEGEND COMUN ──────────────────────────────────────────── */
function legendEstados() {
  return sub('Estados del Excel',
    '<div class="glos-legend">' +
      '<div class="glos-legend-item">' + badge('red') + '<span>Problema crítico que bloquea o distorsiona la planificación en IBP. Requiere acción antes de ejecutar cualquier plan.</span></div>' +
      '<div class="glos-legend-item">' + badge('yellow') + '<span>Dato incompleto o sospechoso que conviene revisar. No bloquea IBP pero puede generar resultados incorrectos.</span></div>' +
      '<div class="glos-legend-item">' + badge('ok') + '<span>Todas las validaciones aplicables pasaron. El registro está correctamente configurado.</span></div>' +
      '<div class="glos-legend-item"><span class="glos-badge glos-dash">—</span><span>El dato no aplica para este registro (N/A). Celda con fondo gris claro e itálica. No indica error sino ausencia de dato para ese campo.</span></div>' +
    '</div>'
  );
}

/* ═══════════════════════════════════════════════════════════════
   PRODUCTION ANALYZER — SECCIONES
   ═══════════════════════════════════════════════════════════════ */

const PA_SECTIONS = [

  /* ── INTRO ── */
  {
    id: 'pa-intro', icon: '📋', title: 'Introducción',
    content: function () {
      return p('El <strong>Production Analyzer</strong> analiza la configuración de producción en SAP IBP y exporta un Excel con hasta 9 hojas. Cada hoja examina una entidad distinta desde el punto de vista de su completitud y consistencia para la planificación.') +
        p('El análisis cruza diez entidades: Production Source Header (PSH), Production Source Item (PSI), Production Source Resource (PSR), Resource, Resource Location, Product, Location, Location Product y Location Source. Los hallazgos se expresan siempre en términos de qué falta o qué está mal configurado respecto a lo que IBP necesita para planificar correctamente.') +
        legendEstados() +
        callout('info', '<strong>Hojas condicionales:</strong> Las hojas Product, Location, Resource, Resource Location, Prod Source Item y Prod Source Resource solo se crean si el usuario seleccionó la entidad correspondiente antes de ejecutar el análisis. La hoja Tipos Excluidos solo aparece si existen tipos de material excluidos del análisis principal. La hoja Resumen siempre se genera.') +
        callout('info', '<strong>Importante:</strong> Los resultados dependen de la categorización de tipos de material (MATTYPEID). Un mismo hallazgo puede ser ⛔ Alerta para un Producto Terminado y no aplicar para una Materia Prima. Ver sección <em>Tipos de Material</em>.');
    }
  },

  /* ── RESUMEN ── */
  {
    id: 'pa-resumen', icon: '📊', title: 'Hoja: Resumen',
    content: function () {
      return p('Primera hoja del libro. Una fila por cada hoja analizada. Permite ver de un vistazo la salud general de la configuración.') +
        colTable([
          ['#', 'Número de hoja en el libro Excel.'],
          ['Hoja', 'Nombre de la hoja analizada (Product, Location, Resource, etc.).'],
          ['Total registros', 'Cantidad de filas procesadas. Ej: 350 = se analizaron 350 productos.'],
          ['Alertas 🔴', 'Registros con problema crítico que bloquea o distorsiona la planificación.'],
          ['Advertencias 🟡', 'Registros con dato incompleto o sospechoso que conviene revisar.'],
          ['OK ✅', 'Registros sin hallazgos — todas las validaciones aplicables pasaron.'],
          ['% Consistencia', 'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100. Una hoja con 85% de consistencia tiene el 15% restante con hallazgos.']
        ]) +
        callout('tip', '<strong>Lectura recomendada:</strong> Comienza por la hoja con menor % de Consistencia y mayor cantidad de Alertas 🔴. Eso indica dónde están los problemas más críticos para la planificación.');
    }
  },

  /* ── PRODUCT ── */
  {
    id: 'pa-product', icon: '🧪', title: 'Hoja: Product',
    content: function () {
      return p('Una fila por cada producto del maestro de materiales de SAP IBP. Esta hoja valida si cada producto tiene la configuración mínima necesaria para que IBP lo pueda planificar correctamente.') +
        sub('Columnas clave', colTable([
          ['Estado', '⛔ Alerta / ⚠ Advertencia / ✅ OK. El peor hallazgo del producto determina el color de la fila.'],
          ['Observacion', 'Texto detallado de todos los hallazgos encontrados, separados por |. Si el estado es OK, describe qué validaciones pasaron.'],
          ['PRDID', 'Código único del producto en SAP IBP.'],
          ['PRDDESCR', 'Descripción del producto del maestro.'],
          ['MATTYPEID', 'Tipo de material SAP. Determina qué validaciones aplican. Es el insumo principal para la categorización.'],
          ['En Location Product', 'Sí/No — ¿El producto está habilitado en al menos una ubicación? Sin esto IBP ignora completamente el producto.'],
          ['En PSH (output)', 'Sí/No — ¿El producto tiene fuente de producción propia (SOURCETYPE=P)?'],
          ['En PSI (componente)', 'Sí/No — ¿Este producto es ingrediente en el BOM de algún otro producto?'],
          ['En Location Source', 'Sí/No — ¿Tiene arcos de transferencia entre ubicaciones?'],
          ['# Opciones prod.', 'Cuántas recetas distintas (SOURCEIDs) producen este producto. Más de una implica multi-sourcing — verificar cuotas (PRATIO).'],
          ['Opciones prod. (SOURCEIDs)', 'Códigos de los SOURCEIDs que producen este producto.'],
          ['# Plantas prod.', 'Número de plantas distintas donde se fabrica.'],
          ['Plantas prod. (códigos)', 'Códigos de las plantas productoras.'],
          ['# Componentes BOM', 'Total de ingredientes PSI definidos en todas sus recetas.'],
          ['# Recursos prod.', 'Máquinas/líneas asignadas vía PSR.'],
          ['Recursos prod. (códigos)', 'Códigos de los recursos asignados a las recetas de este producto.'],
          ['# Proveedores', 'Número de ubicaciones origen distintas en Location Source (campo LOCFR) que abastecen este producto.'],
          ['Proveedores (códigos)', 'Códigos de las ubicaciones origen en Location Source.'],
          ['# Plantas cubiertas', 'Plantas que reciben este producto con arco de abastecimiento configurado en Location Source.'],
          ['Plantas cubiertas (códigos)', 'Códigos de las plantas con arco de abastecimiento configurado.'],
          ['# Plantas sin cobertura', 'Plantas que consumen este producto como insumo pero no tienen arco de abastecimiento configurado. Si > 0: falta Location Source. ⛔ crítico.'],
          ['Plantas sin cobertura (códigos)', 'Códigos de las plantas consumidoras sin cobertura de abastecimiento.'],
          ['# Productos que lo usan', 'Cuántos otros productos distintos requieren este material como componente PSI.'],
          ['Productos que lo usan', 'Códigos de los productos de salida (PRDID) que usan este material como componente PSI.'],
          ['# Orígenes en red', 'Número de nodos origen distintos detectados en la red de este producto (LOCFR en Location Source).'],
          ['Orígenes en red (códigos)', 'Códigos de los nodos origen.'],
          ['# Plantas consumidoras', 'Número de plantas que consumen este producto como componente PSI en alguna receta.'],
          ['Plantas consumidoras (códigos)', 'Códigos de las plantas que consumen este producto como ingrediente.']
        ])) +
        sub('Observaciones posibles',
          callout('info', '<strong>Productos sin categoría:</strong> Los tipos de material sin categoría asignada reciben todas las validaciones con severidad ⚠ Advertencia. Sus observaciones van precedidas por <code>Sin categoría [MATTYPEID]</code>. Si no hay hallazgos, muestran <code>Sin categoría [MATTYPEID] — sin hallazgos en modo permisivo</code> con estado ✅ OK. Asignar la categoría correcta activa las validaciones estrictas correspondientes.') +
          obsTable([
          ['Sin cobertura en Location Product', 'red', ['all'], 'El producto no está registrado en ninguna ubicación en Location Product.', 'Habilitar el producto en Location Product para cada planta y/o DC donde se requiera. Sin esto IBP lo ignora en planificación de demanda y producción.'],
          ['Sin fuente de producción propia (PSH)', 'red', ['finished', 'semi'], 'No existe ningún Production Source Header activo con SOURCETYPE=P para este producto.', 'Crear o activar la receta de producción en IBP (PSH con SOURCETYPE=P). Verificar que el Planning Area y Version sean correctos.'],
          ['PSH sin componentes PSI', 'red', ['finished', 'semi'], 'La receta de producción existe pero no tiene ingredientes definidos — BOM vacío.', 'Revisar el BOM en IBP y cargar los componentes (PSI) necesarios en la receta del SOURCEID indicado.'],
          ['PSH sin recursos PSR asignados', 'red', ['finished', 'semi'], 'La receta existe pero no tiene ninguna máquina o línea asignada en Production Source Resource.', 'Asignar al menos un recurso productivo (RESID) al SOURCEID vía Production Source Resource en IBP.'],
          ['Planta productora no es origen en Location Source', 'red', ['finished'], 'El producto se fabrica en la planta pero no hay arco de Location Source declarando esa planta como LOCFR.', 'Crear arco en Location Source con la planta productora como LOCFR para distribuir el producto hacia DCs o clientes.'],
          ['Sin arco de abastecimiento hacia: X, Y', 'red', ['rawmat'], 'El insumo se consume en las plantas indicadas pero no hay Location Source que lo lleve ahí.', 'Crear arco(s) en Location Source con el proveedor como LOCFR y la planta consumidora como LOCID para cada insumo sin cobertura.'],
          ['Sin arco de abastecimiento (no registrado en Location Source)', 'red', ['rawmat'], 'El insumo no tiene ningún arco de transferencia en Location Source.', 'Configurar Location Source con el proveedor o planta origen como LOCFR hacia la(s) planta(s) consumidora(s).'],
          ['Sin arcos en Location Source', 'red', ['trading'], 'El producto de tipo Mercadería no tiene arcos de distribución en Location Source.', 'Configurar Location Source con el proveedor/origen del producto para que IBP pueda planificar su flujo.'],
          ['Semiterminado sin consumo PSI en planta productora ni transferencia configurada', 'red', ['semi'], 'El semiterminado se produce pero nadie lo consume ni se transfiere a otra planta — producción sin destino.', 'Verificar que el semiterminado esté en el BOM (PSI) de algún terminado en la misma planta, o configurar Location Source para transferirlo al punto de consumo.'],
          ['Transfiere a N destino(s) sin consumo PSI en ningún punto: X', 'red', ['semi'], 'El semiterminado se transfiere a destinos donde no es consumido como ingrediente, y tampoco se usa en la planta de origen.', 'Agregar el semiterminado como componente PSI en la receta de la planta destino, o eliminar el arco de transferencia si es un error de configuración.'],
          ['Transfiere a N destino(s) sin consumo PSI (sí consume en planta origen): X', 'yellow', ['semi'], 'El semiterminado se consume localmente en la planta de origen, pero también se transfiere a destinos donde no se usa como ingrediente.', 'Verificar si la transferencia a los destinos indicados es intencional. Si no, eliminar el arco de Location Source hacia esas ubicaciones.'],
          ['PLEADTIME ausente o cero en N SOURCEID(s)', 'red', ['finished'], 'El lead time de producción es 0 o está vacío en la(s) receta(s). IBP planifica como si la producción fuera instantánea.', 'Ingresar el PLEADTIME real en días en el Production Source Header de IBP para cada SOURCEID afectado.'],
          ['PLEADTIME ausente o cero en N SOURCEID(s)', 'yellow', ['semi'], 'El lead time de producción es 0 o está vacío en la(s) receta(s). IBP planifica como si la producción fuera instantánea.', 'Ingresar el PLEADTIME real en días en el Production Source Header de IBP para cada SOURCEID afectado.'],
          ['OUTPUTCOEFFICIENT ausente o cero en N SOURCEID(s)', 'red', ['finished'], 'El coeficiente de salida de la receta es 0 o está vacío. IBP no sabe cuántas unidades produce cada corrida.', 'Revisar y corregir el OUTPUTCOEFFICIENT en el Production Source Header.'],
          ['OUTPUTCOEFFICIENT ausente o cero en N SOURCEID(s)', 'yellow', ['semi'], 'El coeficiente de salida de la receta es 0 o está vacío. IBP no sabe cuántas unidades produce cada corrida.', 'Revisar y corregir el OUTPUTCOEFFICIENT en el Production Source Header.'],
          ['Configurado solo como co-producto (SOURCETYPE=C) — falta PSH primario', 'yellow', ['finished', 'semi'], 'El producto aparece en recetas como subproducto (C) pero nunca como output principal (P).', 'Verificar si es intencional (es co-producto puro de otro proceso) o si falta crear la receta principal con SOURCETYPE=P.'],
          ['Tiene BOM de fabricación (PSH) — verificar categorización', 'yellow', ['rawmat', 'trading'], 'El producto tiene una receta de producción pero está categorizado como Mat. Prima o Mercadería, que no deberían fabricarse.', 'Revisar si la categoría del MATTYPEID es correcta, o si el PSH es un error de configuración en IBP.'],
          ['No consumido como componente en ningún BOM', 'yellow', ['semi', 'rawmat'], 'El producto existe como Semiterminado o Mat. Prima pero no aparece como ingrediente en ninguna receta PSI.', 'Verificar si el material todavía está vigente y si está correctamente vinculado en el BOM de los productos que lo consumen.'],
          ['TLEADTIME = 0 en todos los arcos de Location Source', 'yellow', ['all'], 'Todos los arcos de transferencia de este producto tienen lead time = 0. IBP planifica transferencias instantáneas.', 'Revisar y completar el TLEADTIME (en días) en los arcos de Location Source para este producto.'],
          ['Con PSH, PSI y PSR', 'ok', ['finished', 'semi'], 'La receta de producción existe con BOM completo y recursos asignados.', 'Sin acción requerida.'],
          ['Planta es origen en Location Source', 'ok', ['finished'], 'La planta productora tiene al menos un arco saliente en Location Source para este producto.', 'Sin acción requerida.'],
          ['Arcos de abastecimiento completos', 'ok', ['rawmat'], 'Todas las plantas que consumen este insumo tienen arco de abastecimiento configurado en Location Source.', 'Sin acción requerida.'],
          ['Con arcos en Location Source', 'ok', ['trading'], 'El producto tiene arcos de distribución configurados en Location Source.', 'Sin acción requerida.'],
          ['PLEADTIME definido en todos los SOURCEIDs', 'ok', ['finished', 'semi'], 'Ningún SOURCEID tiene PLEADTIME = 0 o vacío.', 'Sin acción requerida.'],
          ['Coeficiente de salida definido', 'ok', ['finished', 'semi'], 'Todos los SOURCEIDs tienen OUTPUTCOEFFICIENT mayor que cero.', 'Sin acción requerida.'],
          ['PSH con SOURCETYPE=P presente', 'ok', ['finished', 'semi'], 'Al menos un registro con SOURCETYPE=P existe para este producto.', 'Sin acción requerida.'],
          ['Sin BOM de fabricación', 'ok', ['rawmat', 'trading'], 'El producto no tiene PSH, lo cual es correcto para Mat. Prima y Mercadería.', 'Sin acción requerida.'],
          ['Consumido como componente en BOM', 'ok', ['semi', 'rawmat'], 'El producto aparece como ingrediente en al menos una receta PSI.', 'Sin acción requerida.'],
          ['Consume en planta productora', 'ok', ['semi'], 'El semiterminado se produce y se consume localmente en la misma planta — no requiere transferencia.', 'Sin acción requerida.'],
          ['Consumo en destino de transferencia verificado', 'ok', ['semi'], 'El semiterminado se transfiere a otra planta y en el destino existe consumo PSI configurado.', 'Sin acción requerida.'],
          ['TLEADTIME definido en Location Source', 'ok', ['all'], 'Al menos un arco de Location Source tiene TLEADTIME mayor que cero.', 'Sin acción requerida.'],
          ['Sin categoría [MATTYPEID] — sin hallazgos en modo permisivo', 'ok', ['uncategorized'], 'El producto no tiene categoría asignada y no presentó hallazgos. Las validaciones se aplicaron en modo permisivo. El texto entre corchetes es el MATTYPEID real del producto.', 'Asignar la categoría correcta al tipo de material en el panel de categorización para activar las validaciones estrictas correspondientes.']
        ]));
    }
  },

  /* ── LOCATION ── */
  {
    id: 'pa-location', icon: '🏭', title: 'Hoja: Location',
    content: function () {
      return p('Una fila por cada ubicación (planta, DC, proveedor, etc.) detectada en los datos. El análisis infiere el <strong>rol real</strong> de cada ubicación según su comportamiento en los datos, independientemente del campo LOCTYPE de IBP. Las columnas se agrupan por rol: las columnas de planta solo tienen datos si la ubicación tiene producción, y así sucesivamente.') +
        sub('Roles inferidos', colTable([
          ['Planta de producción', 'Tiene al menos un Production Source Header (PSH) asociado — fabrica productos.'],
          ['Proveedor', 'Aparece como LOCFR en Location Source enviando productos que se consumen como PSI en la planta destino — abastece insumos.'],
          ['Nodo de transferencia', 'Aparece como LOCFR en Location Source enviando productos que NO se consumen como PSI en el destino — redistribuye o distribuye.'],
          ['Nodo receptor', 'Solo aparece como LOCID (destino) en Location Source, sin producción propia ni envíos salientes — solo recibe.'],
          ['Nodo de recursos', 'Tiene recursos asignados en Resource Location pero sin producción ni transferencias activas.'],
          ['Sin actividad', 'Existe en el maestro de ubicaciones pero no aparece en ningún otro dato — ubicación inactiva o huérfana.']
        ])) +
        sub('Columnas generales (todas las ubicaciones)', colTable([
          ['LOCID', 'Código único de la ubicación en SAP IBP.'],
          ['LOCDESCR', 'Descripción de la ubicación del maestro.'],
          ['LOCTYPE', 'Tipo de ubicación del maestro (ej: 1010 = planta). Informativo — el rol real se infiere del comportamiento.'],
          ['Rol(es) inferido(s)', 'Uno o más roles detectados según participación real en PSH, Location Source y Customer Source.'],
          ['En Location Product', 'Sí/No — ¿La ubicación está habilitada en Location Product? Sin esto IBP no planifica en esa ubicación.']
        ])) +
        sub('Columnas de planta de producción', colTable([
          ['# Productos fabricados', 'Productos distintos con al menos un SOURCEID en esta planta.'],
          ['Productos fabricados (códigos)', 'Códigos de los productos fabricados.'],
          ['# SOURCEIDs', 'Total de recetas de producción en esta planta.'],
          ['SOURCEIDs (códigos)', 'Códigos de las recetas.'],
          ['# Recursos asignados', 'Recursos con Resource Location configurado en esta planta.'],
          ['Recursos asignados (códigos)', 'Códigos de los recursos asignados.'],
          ['# Recursos activos PSR', 'Recursos que además participan en alguna receta PSR activa en esta planta.'],
          ['Recursos activos (códigos)', 'Códigos de los recursos activos.'],
          ['# Recursos ociosos', 'Recursos asignados en Resource Location pero sin ningún PSR activo — configuración sin uso.'],
          ['Recursos ociosos (códigos)', 'Códigos de los recursos ociosos.'],
          ['# BOMs sin PSI', 'SOURCEIDs de esta planta sin componentes PSI definidos.'],
          ['SOURCEIDs sin PSI (códigos)', 'Códigos de los SOURCEIDs con BOM vacío.'],
          ['# BOMs sin PSR', 'SOURCEIDs sin recurso asignado.'],
          ['SOURCEIDs sin PSR (códigos)', 'Códigos de los SOURCEIDs sin recurso.'],
          ['# Componentes externos', 'Ingredientes PSI de esta planta que no son semiterminados producidos localmente y deben llegar vía Location Source.'],
          ['# Componentes sin cobertura LocSrc', 'Insumos consumidos en esta planta sin arco de abastecimiento configurado. Crítico para planificación de compras.'],
          ['Componentes sin cobertura (códigos)', 'Códigos de los productos sin arco de abastecimiento hacia esta planta.'],
          ['# SOURCEIDs sin PLEADTIME', 'Recetas con PLEADTIME = 0 o vacío en esta planta.'],
          ['SOURCEIDs sin PLEADTIME (códigos)', 'Códigos de los SOURCEIDs sin lead time de producción.']
        ])) +
        sub('Columnas de proveedor / nodo origen', colTable([
          ['# Productos abastecidos (como proveedor)', 'Productos que esta ubicación envía hacia plantas donde se consumen como PSI.'],
          ['Productos abastecidos (códigos)', 'Códigos de esos productos.'],
          ['# Plantas abastecidas', 'Plantas destino que reciben abastecimiento desde esta ubicación.'],
          ['Plantas abastecidas (códigos)', 'Códigos de las plantas abastecidas.'],
          ['# Arcos sin consumo PSI en destino', 'Arcos donde el producto enviado no se consume como PSI en la planta destino — posible error o nodo intermedio.'],
          ['Productos sin consumo PSI (códigos)', 'Códigos de esos productos.'],
          ['# Productos sin LocProd en destino', 'Productos que se envían a plantas que no los tienen habilitados en Location Product.'],
          ['Productos sin LocProd (códigos)', 'Códigos de esos productos.']
        ])) +
        sub('Columnas de nodo de transferencia', colTable([
          ['# Productos transferidos', 'Productos que esta ubicación redistribuye hacia otros nodos sin ser consumidos como PSI en destino.'],
          ['Productos transferidos (códigos)', 'Códigos de los productos transferidos.'],
          ['# Destinos transferencia', 'Número de nodos destino hacia los que transfiere.'],
          ['Destinos transferencia (códigos)', 'Códigos de los destinos.']
        ])) +
        sub('Columnas de nodo receptor', colTable([
          ['# Productos recibidos', 'Productos que esta ubicación recibe desde otros nodos vía Location Source.'],
          ['Productos recibidos (códigos)', 'Códigos de los productos recibidos.'],
          ['# Orígenes desde los que recibe', 'Número de ubicaciones distintas que envían productos a esta ubicación.'],
          ['Orígenes (códigos)', 'Códigos de las ubicaciones origen.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['N SOURCEID(s) sin PSI', 'red', ['finished', 'semi'], 'N recetas de producción de esta planta no tienen ingredientes definidos (BOM vacío). IBP no puede planificar compra de insumos para esas recetas.', 'Revisar y completar el BOM (PSI) de los SOURCEIDs indicados en la hoja Prod Source Header.'],
          ['N SOURCEID(s) sin PSR', 'red', ['finished', 'semi'], 'N recetas no tienen ningún recurso productivo asignado. IBP no evalúa capacidad para esas recetas.', 'Asignar un recurso (RESID) a cada SOURCEID indicado vía Production Source Resource en IBP.'],
          ['N componente(s) sin arco de abastecimiento', 'red', ['finished', 'semi'], 'N insumos que se consumen en esta planta no tienen arco en Location Source que los traiga hasta aquí.', 'Crear arcos en Location Source para los componentes indicados, con el proveedor como LOCFR y esta planta como LOCID.'],
          ['N SOURCEID(s) con PLEADTIME = 0', 'red', ['finished', 'semi'], 'N recetas tienen lead time de producción cero o vacío. IBP planifica esas producciones como instantáneas.', 'Ingresar el PLEADTIME real (en días) en el Production Source Header de cada SOURCEID afectado.'],
          ['N recurso(s) asignados sin uso en PSR', 'yellow', ['all'], 'N recursos tienen Resource Location configurado en esta planta pero no participan en ninguna receta activa.', 'Verificar si los recursos son obsoletos y deben eliminarse de Resource Location, o si falta asignarlos a algún PSR.'],
          ['N producto(s) Mat. Prima/Mercadería con BOM de fabricación en esta planta — verificar categorización', 'yellow', ['rawmat', 'trading'], 'Productos categorizados como Mat. Prima o Mercadería tienen PSH en esta planta — posible error de categorización.', 'Revisar la categoría del MATTYPEID o verificar si el PSH es un error de configuración en IBP.'],
          ['N producto(s) abastecidos sin consumo PSI en destino', 'yellow', ['rawmat', 'semi'], 'Esta ubicación envía productos hacia plantas donde no son consumidos como ingrediente en ninguna receta.', 'Verificar si el arco de Location Source es correcto o si falta agregar el componente en el BOM del destino.'],
          ['N producto(s) sin Location Product en planta destino', 'red', ['all'], 'Esta ubicación envía productos hacia plantas que no los tienen habilitados en Location Product — IBP no puede planificarlos ahí.', 'Habilitar los productos indicados en Location Product para la planta destino.'],
          ['N componente(s) Mat. Prima/Semiterminado transferido(s) a planta sin consumo PSI — verificar BOM', 'red', ['rawmat', 'semi'], 'Esta ubicación envía componentes a una planta donde ninguna receta los consume. El insumo llega sin destino productivo.', 'Revisar el BOM de la planta destino y agregar el componente como PSI, o eliminar el arco de Location Source si es un error.'],
          ['N componente(s) Mat. Prima/Semiterminado transferido(s) a nodo sin producción', 'yellow', ['rawmat', 'semi'], 'Esta ubicación envía componentes a una ubicación que no tiene producción — posible nodo intermedio o configuración incompleta.', 'Verificar si el nodo destino es un punto de cross-docking o si el arco de transferencia es un error.'],
          ['N producto(s) sin categoría transferidos sin consumo PSI en destino', 'yellow', ['all'], 'Productos sin categoría asignada se transfieren a destinos donde no se usan en ningún BOM.', 'Asignar categoría al MATTYPEID de los productos indicados para que el análisis pueda aplicar las reglas correctas.'],
          ['N producto(s) recibidos sin cobertura en Location Product', 'red', ['all'], 'Esta ubicación recibe productos por Location Source pero no los tiene habilitados en Location Product — IBP no puede planificarlos aquí.', 'Habilitar los productos indicados en Location Product para esta ubicación.'],
          ['N componente(s) Mat. Prima/Semiterminado recibidos en ubicación sin producción asociada', 'yellow', ['rawmat', 'semi'], 'Esta ubicación recibe insumos o semiterminados pero no tiene ninguna receta de producción — los insumos llegan sin uso productivo declarado.', 'Verificar si esta ubicación debería tener producción configurada o si los arcos de abastecimiento son incorrectos.'],
          ['Ubicación en maestro sin actividad en otros datos', 'info', ['all'], 'La ubicación existe en el maestro pero no aparece en ninguna entidad de red (PSH, Location Source, Customer Source, Location Product).', 'Verificar si la ubicación es obsoleta y puede depurarse del maestro, o si falta configurar su participación en la red.'],
          ['BOMs con PSI, PSR y lead time | Sin componentes sin cobertura | Sin recursos ociosos', 'ok', ['finished', 'semi'], 'Planta completamente configurada: todas las recetas tienen BOM, recursos y lead time; todos los insumos tienen cobertura; no hay recursos sin uso.', 'Sin acción requerida.'],
          ['Abastecimiento con consumo PSI y cobertura LP en destino', 'ok', ['rawmat', 'semi'], 'Todos los productos que esta ubicación envía son consumidos como PSI en las plantas destino y están habilitados en Location Product.', 'Sin acción requerida.'],
          ['Distribuye N producto(s) terminado(s)/mercadería sin hallazgos', 'ok', ['finished', 'trading'], 'Nodo de transferencia que redistribuye productos terminados o mercadería sin anomalías detectadas.', 'Sin acción requerida.'],
          ['Nodo de transferencia sin hallazgos', 'ok', ['all'], 'La ubicación actúa como nodo de transferencia y no se detectaron problemas de configuración en los productos que redistribuye.', 'Sin acción requerida.'],
          ['Recibe N producto(s) | Location Product OK | Sin componentes sin producción', 'ok', ['all'], 'Nodo receptor correctamente configurado: todos los productos recibidos están habilitados en Location Product y ningún insumo llega a una ubicación sin producción asociada.', 'Sin acción requerida.'],
          ['Nodo receptor sin hallazgos', 'ok', ['all'], 'La ubicación solo recibe productos y no se detectaron problemas de configuración.', 'Sin acción requerida.'],
          ['Ubicación activa sin hallazgos', 'ok', ['all'], 'La ubicación tiene actividad en la red y no se detectaron anomalías de configuración.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── RESOURCE ── */
  {
    id: 'pa-resource', icon: '⚙️', title: 'Hoja: Resource',
    content: function () {
      return p('Una fila por cada recurso productivo (máquina, línea, horno, etc.) del maestro de recursos de SAP IBP. Valida que cada recurso tenga planta asignada y esté en uso en alguna receta.') +
        sub('Columnas clave', colTable([
          ['RESID', 'Código único del recurso en SAP IBP. Ej: LINEA-01, HORNO-A.'],
          ['RESDESCR', 'Descripción del recurso del maestro.'],
          ['En PSR', 'Sí/No — ¿Este recurso está asignado a al menos una fuente de producción en Production Source Resource? Si No, IBP nunca lo usa para planificar capacidad.'],
          ['En Resource Location', 'Sí/No — ¿Este recurso tiene al menos una planta configurada en Resource Location? Si No, IBP no sabe dónde opera físicamente.'],
          ['# Plantas asignadas', 'Número de plantas donde este recurso tiene Resource Location configurado.'],
          ['Plantas asignadas (códigos)', 'Códigos de las plantas donde está configurado el recurso.'],
          ['# Fuentes prod.', 'Número de SOURCEIDs a los que está asignado este recurso vía PSR.'],
          ['Fuentes prod. (SOURCEIDs)', 'Códigos de los SOURCEIDs a los que está asignado este recurso.'],
          ['# Productos que fabrica', 'Número de productos distintos que este recurso ayuda a producir.'],
          ['Productos que fabrica (códigos)', 'Códigos de los productos que produce este recurso.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Recurso huérfano: sin uso en producción ni planta asignada', 'red', ['all'], 'El recurso existe en el maestro pero no aparece ni en PSR ni en Resource Location — completamente desconectado de la configuración productiva.', 'Verificar si el recurso es obsoleto y puede eliminarse del maestro, o si falta asignarlo a recetas (PSR) y a su planta (Resource Location).'],
          ['Sin uso en producción (no aparece en PSR)', 'yellow', ['all'], 'El recurso tiene planta asignada en Resource Location pero ninguna receta lo usa. IBP tiene el recurso ubicado pero nunca lo considera para planificar capacidad.', 'Asignar el recurso a al menos una receta (SOURCEID) vía Production Source Resource, o verificar si es obsoleto.'],
          ['Sin planta asignada en Resource Location', 'yellow', ['all'], 'El recurso participa en recetas (PSR) pero no tiene planta configurada en Resource Location. IBP no sabe en qué planta opera físicamente.', 'Agregar la combinación RESID+LOCID correspondiente en Resource Location en IBP.'],
          ['En uso en PSR y con planta asignada en Resource Location', 'ok', ['all'], 'El recurso está activo en al menos una receta y tiene su planta correctamente configurada.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── RESOURCE LOCATION ── */
  {
    id: 'pa-resloc', icon: '📍', title: 'Hoja: Resource Location',
    content: function () {
      return p('Una fila por cada combinación Recurso + Planta configurada en Resource Location. Valida si cada combinación está siendo efectivamente usada en alguna receta de producción.') +
        sub('Columnas clave', colTable([
          ['RESID', 'Código del recurso productivo.'],
          ['RESDESCR', 'Descripción del recurso.'],
          ['LOCID', 'Código de la planta donde está configurado este recurso.'],
          ['LOCDESCR', 'Descripción de la planta.'],
          ['RESID+LOCID usado en PSR', 'Sí/No — ¿Esta combinación aparece en al menos un Production Source Resource activo? Si No, el recurso está en el maestro de esa planta pero no participa en ninguna receta.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Recurso activo en PSR para esta planta', 'ok', ['all'], 'La combinación RESID+LOCID está en uso en al menos una receta de producción en esa planta.', 'Sin acción requerida.'],
          ['Recurso asignado a planta pero sin uso en PSR para esta planta', 'yellow', ['all'], 'El recurso está en el maestro de la planta (Resource Location) pero ninguna receta activa lo usa en esa planta. IBP lo conoce pero nunca lo considera para planificación de capacidad en ese sitio.', 'Verificar si el recurso es obsoleto para esa planta y puede eliminarse de Resource Location, o si falta asignarlo a alguna receta (PSR) en esa planta.']
        ]));
    }
  },

  /* ── PROD SOURCE HEADER ── */
  {
    id: 'pa-psh', icon: '📄', title: 'Hoja: Prod Source Header',
    content: function () {
      return p('Una fila por cada fuente de producción (SOURCEID) en SAP IBP. Cada SOURCEID representa una receta que transforma insumos en un producto terminado o semiterminado en una planta específica.') +
        sub('Columnas clave', colTable([
          ['SOURCEID', 'Identificador único de la receta de producción.'],
          ['PRDID output', 'Producto que produce esta receta (output principal).'],
          ['PRDDESCR output', 'Descripción del producto output.'],
          ['MATTYPEID output', 'Tipo de material del producto output. Determina qué validaciones aplican a esta receta.'],
          ['LOCID planta', 'Planta donde se ejecuta esta producción.'],
          ['LOCDESCR planta', 'Descripción de la planta.'],
          ['SOURCETYPE(s)', 'P = fuente primaria (output principal) | C = co-producto (subproducto del mismo proceso). Una receta puede tener P y C simultáneamente.'],
          ['PLEADTIME', 'Lead time de producción en días. 0 o vacío → IBP planifica producción instantánea (⛔).'],
          ['OUTPUTCOEFFICIENT', 'Unidades del producto terminado por corrida de producción. Afecta el cálculo de cuántas corridas se necesitan para cubrir la demanda.'],
          ['PRATIO', 'Proporción asignada a esta fuente cuando hay múltiples SOURCEIDs para el mismo producto+planta. IBP usa este valor para distribuir la demanda entre recetas. Vacío = fuente única o sin cuota definida.'],
          ['PRDID+LOCID en Location Product', 'Sí/No — ¿Esta combinación producto+planta está habilitada en Location Product? Sin esto la receta existe pero IBP no la activa.'],
          ['# Componentes PSI', 'Ingredientes definidos en el BOM. 0 = BOM vacío → IBP no planifica compra de insumos.'],
          ['# Recursos PSR', 'Recursos asignados a esta receta. 0 = sin capacidad modelada.'],
          ['Recursos PSR (códigos)', 'Códigos de los recursos asignados a esta receta vía Production Source Resource.'],
          ['# Componentes con alternativa', 'Ingredientes marcados como material de reemplazo (ISALTITEM=X). Útil para conocer la flexibilidad de sustitución del BOM.'],
          ['Tiene PSR', 'Sí/No — resumen directo de si la receta tiene al menos un recurso asignado en Production Source Resource.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['BOM vacío: sin componentes PSI', 'red', ['finished', 'semi'], 'La receta no tiene ningún ingrediente definido. IBP no genera demanda de insumos para este producto.', 'Cargar los componentes (PSI) necesarios en el BOM del SOURCEID indicado en IBP.'],
          ['PLEADTIME = 0 o no definido', 'red', ['finished', 'semi'], 'El lead time de producción es cero o está vacío. IBP planifica como si el producto se fabricara de forma instantánea, lo que genera fechas de entrega incorrectas.', 'Ingresar el lead time real de producción (en días) en el campo PLEADTIME del Production Source Header en IBP.'],
          ['PRDID+LOCID sin cobertura en Location Product', 'red', ['all'], 'La combinación producto+planta de esta receta no está habilitada en Location Product. La receta existe pero IBP no la usa para planificar.', 'Habilitar la combinación PRDID+LOCID en Location Product en IBP.'],
          ['Sin recursos PSR asignados', 'red', ['finished', 'semi'], 'La receta no tiene ningún recurso productivo asignado. IBP no puede evaluar restricciones de capacidad para esta receta.', 'Asignar al menos un recurso (RESID) a este SOURCEID vía Production Source Resource en IBP.'],
          ['Sin registro SOURCETYPE=P', 'yellow', ['finished', 'semi'], 'La receta no tiene un registro con SOURCETYPE=P — solo tiene co-productos (C). No tiene un output principal definido.', 'Revisar la configuración del SOURCEID y agregar el registro con SOURCETYPE=P para el producto principal.'],
          ['Múltiples SOURCEIDs para mismo PRDID+LOCID — verificar cuotas', 'yellow', ['all'], 'Hay más de una receta para el mismo producto en la misma planta. IBP necesita PRATIO definido para distribuir correctamente la demanda entre las fuentes.', 'Revisar que los SOURCEIDs indicados tengan PRATIO definido y que la suma de cuotas sea coherente con la estrategia de producción.'],
          ['BOM con componentes PSI | Lead time definido | Habilitado en LP | SOURCETYPE=P presente | Recursos PSR asignados', 'ok', ['all'], 'La receta está completamente configurada.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── PROD SOURCE ITEM ── */
  {
    id: 'pa-psi', icon: '🧩', title: 'Hoja: Prod Source Item',
    content: function () {
      return p('Una fila por cada componente (ingrediente) en el BOM de una receta de producción. Valida que cada ingrediente tenga coeficiente definido y arco de abastecimiento configurado.') +
        sub('Columnas clave', colTable([
          ['SOURCEID', 'Receta a la que pertenece este componente.'],
          ['PRDID output', 'Producto que fabrica esa receta.'],
          ['PRDDESCR output', 'Descripción del producto output.'],
          ['MATTYPEID output', 'Tipo de material del producto output.'],
          ['LOCID planta', 'Planta donde se ejecuta la receta.'],
          ['LOCDESCR planta', 'Descripción de la planta.'],
          ['PRDID componente', 'Material que se consume como ingrediente en esta receta.'],
          ['PRDDESCR comp', 'Descripción del componente.'],
          ['MATTYPEID comp', 'Tipo de material del componente. Determina si se trata como semiterminado o insumo externo.'],
          ['COMPONENTCOEFFICIENT', 'Unidades del componente consumidas por unidad de producto terminado. Si es 0, IBP no planifica la compra de este insumo.'],
          ['Tipo componente', 'Semielaborado = se fabrica en la misma planta (tiene PSH propio ahí) | Semielaborado (ext.) = se fabrica en otra planta (PSH en planta distinta) | Semielaborado (sin receta) = categorizado como semi pero sin PSH activo en ninguna planta | Insumo = debe llegar desde fuera vía Location Source | No determinado = no se pudo clasificar con la información disponible.'],
          ['PRDID comp+LOCID en Location Product', 'Sí/No — ¿El componente está habilitado en Location Product para esta planta? Sin esto IBP no puede planificar su consumo aquí.'],
          ['En Location Source (insumo)', 'Sí/No — ¿Hay arco de Location Source que traiga este insumo a esta planta? Muestra N/A para semielaborados (se producen localmente).'],
          ['LOCFR origen', 'Código(s) de las ubicaciones de origen en Location Source para este componente en esta planta.'],
          ['LOCDESCR origen', 'Descripción(es) de las ubicaciones origen.'],
          ['# Orígenes comp.', 'Número de ubicaciones distintas que abastecen este componente a esta planta.'],
          ['Orígenes comp. (códigos)', 'Códigos de todas las ubicaciones origen para este componente+planta.'],
          ['Material de reemplazo (ISALTITEM)', 'X = este componente puede sustituir a otro material alternativo. Vacío = componente principal sin sustitución configurada.'],
          ['Reemplaza a', 'Código del componente principal al que este material puede reemplazar (solo cuando ISALTITEM=X).']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Coeficiente = 0 o no definido', 'red', ['all'], 'El coeficiente de consumo del componente es cero o está vacío. IBP no planifica la compra de este insumo aunque esté en el BOM.', 'Revisar y corregir el COMPONENTCOEFFICIENT en el Production Source Item en IBP.'],
          ['Semiterminado sin arco de transferencia hacia esta planta', 'red', ['semi'], 'El componente es un semiterminado categorizado como tal (MATTYPEID semi) con producción en otra planta, pero no existe ningún arco en Location Source que lo traslade a esta planta consumidora.', 'Crear arco en Location Source con la planta productora del semiterminado como LOCFR y esta planta como LOCID para el componente indicado.'],
          ['Insumo sin arco de abastecimiento en Location Source', 'red', ['all'], 'El componente es un insumo externo (no semielaborado) pero no hay ningún arco en Location Source que lo traiga a esta planta.', 'Crear arco en Location Source con el proveedor como LOCFR y esta planta como LOCID para el componente indicado.'],
          ['Componente no habilitado en Location Product para esta planta', 'red', ['all'], 'El componente no está registrado en Location Product para la planta donde se consume. IBP no puede planificar su consumo aquí.', 'Habilitar la combinación componente+planta en Location Product en IBP.'],
          ['SOURCEID no encontrado en PSH', 'yellow', ['all'], 'El SOURCEID de este componente no existe en el Production Source Header descargado. Puede ser un dato huérfano o un filtro de datos que excluye el PSH padre.', 'Verificar que el PSH del SOURCEID indicado exista y esté activo en IBP con el mismo Planning Area y Version.'],
          ['Semiterminado sin receta de produccion (PSH) en ninguna planta', 'yellow', ['semi'], 'El componente está categorizado como semiterminado (MATTYPEID semi) pero no se encontró ningún Production Source Header activo para este material en ninguna planta del Planning Area y Version analizados.', 'Verificar que exista un PSH activo para este semiterminado en IBP con el Planning Area y Version correctos. Si el PSH está en otro Planning Area, revisar la configuración de la jerarquía de producción.'],
          ['Material de reemplazo sin registro en Item Sub', 'yellow', ['all'], 'El componente está marcado como ISALTITEM=X (sustituto) pero no tiene registro en Production Source Item Sub que lo vincule al material que reemplaza.', 'Completar la configuración del sustituto en Production Source Item Sub en IBP.'],
          ['Componente de tipo excluido ([MATTYPE]) — validado en contexto', 'info', ['all'], 'El componente pertenece a un tipo de material excluido del análisis principal. Se valida su coeficiente y cobertura de abastecimiento porque es ingrediente de un producto incluido.', 'Si el insumo tiene brechas de cobertura, revisar en IBP aunque su tipo esté excluido del análisis general.'],
          ['Semielaborado: trazabilidad en PSH', 'ok', ['semi'], 'El componente es un semiterminado que se fabrica en esta misma planta — se rastrea vía su propio PSH.', 'Sin acción requerida. No requiere arco de Location Source porque se produce localmente.'],
          ['Semiterminado producido en otra planta: transferencia configurada', 'ok', ['semi'], 'El componente es un semiterminado categorizado como tal (MATTYPEID semi) con producción en otra planta y con arco de Location Source configurado que lo traslada a esta planta consumidora.', 'Sin acción requerida. La transferencia está correctamente configurada.'],
          ['SOURCEID valido en PSH | Coeficiente definido | Con arco de abastecimiento en Location Source | Habilitado en Location Product', 'ok', ['all'], 'El componente está correctamente configurado.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── PROD SOURCE RESOURCE ── */
  {
    id: 'pa-psr', icon: '🔧', title: 'Hoja: Prod Source Resource',
    content: function () {
      return p('Una fila por cada asignación Recurso + Receta (RESID + SOURCEID) en Production Source Resource. Valida que el recurso asignado a una receta también tenga configuración de planta en Resource Location.') +
        sub('Columnas clave', colTable([
          ['SOURCEID', 'Receta de producción a la que está asignado el recurso.'],
          ['PRDID output', 'Producto que fabrica esa receta.'],
          ['PRDDESCR output', 'Descripción del producto output.'],
          ['MATTYPEID output', 'Tipo de material del producto output.'],
          ['LOCID planta', 'Planta donde opera la receta.'],
          ['LOCDESCR planta', 'Descripción de la planta.'],
          ['RESID', 'Recurso asignado a esta receta.'],
          ['RESDESCR', 'Descripción del recurso.'],
          ['RESID+LOCID en Resource Location', 'Sí/No — ¿Esta combinación recurso+planta existe en Resource Location? Si No, hay inconsistencia: el recurso opera en una receta de esa planta pero no figura en el maestro de esa planta.'],
          ['# Plantas con este recurso asignado', 'Número de plantas donde el recurso tiene Resource Location configurado.'],
          ['Plantas recurso (códigos)', 'Códigos de las plantas donde este recurso tiene Resource Location configurado.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Recurso en producción sin asignación en Resource Location para planta X', 'yellow', ['all'], 'El recurso está asignado a una receta de la planta X pero no tiene Resource Location configurado para esa planta. IBP registra el uso del recurso en la receta pero no lo reconoce formalmente en ese sitio.', 'Agregar la combinación RESID+LOCID en Resource Location en IBP para formalizar la asignación del recurso a esa planta.'],
          ['SOURCEID no encontrado en PSH', 'yellow', ['all'], 'El SOURCEID del PSR no existe en el Production Source Header — dato huérfano.', 'Verificar que el PSH del SOURCEID exista y esté activo en IBP.'],
          ['Recurso X asignado en Resource Location para planta Y | Asociado a SOURCEID Z', 'ok', ['all'], 'La asignación recurso+planta es consistente entre PSR y Resource Location.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── TIPOS EXCLUIDOS ── */
  {
    id: 'pa-excluidos', icon: '🚫', title: 'Hoja: Tipos Excluidos',
    content: function () {
      return p('Solo aparece si el usuario excluyó algún tipo de material antes de ejecutar el análisis. Una fila por cada MATTYPEID excluido. Aunque un tipo esté excluido del análisis principal, sus productos siguen siendo validados <em>en contexto</em> si aparecen como componentes en el BOM de productos incluidos.') +
        sub('Columnas clave', colTable([
          ['MATTYPEID', 'Código del tipo de material excluido.'],
          ['# Productos', 'Cuántos productos del maestro tienen este tipo.'],
          ['Aparece como componente PSI en # SOURCEIDs', 'Cuántas recetas distintas usan productos de este tipo como ingrediente. Aunque el tipo esté excluido, se valida su configuración de abastecimiento cuando es componente.'],
          ['SOURCEIDs donde es componente (códigos)', 'Códigos de las recetas que usan productos de este tipo como componente PSI.'],
          ['Componentes con cobertura LocSrc', 'Cuántas combinaciones componente+planta (de este tipo excluido) SÍ tienen arco de Location Source configurado.'],
          ['Componentes sin cobertura LocSrc', 'Cuántas combinaciones componente+planta (de este tipo excluido) NO tienen arco de Location Source. Si > 0, hay insumos sin ruta de llegada a la planta que los consume.'],
          ['Observacion', 'Texto descriptivo del estado: indica si el tipo aparece como componente y si hay brechas de abastecimiento.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Excluido del análisis principal. Validado como componente en N fuente(s) de producción.', 'info', ['all'], 'El tipo de material está excluido del análisis principal pero sus productos aparecen como componentes PSI en N recetas distintas de productos incluidos. Se validan en contexto.', 'Sin acción requerida si la exclusión es intencional. Revisar las columnas de cobertura LocSrc para confirmar que los componentes tienen arcos de abastecimiento configurados.'],
          ['Excluido del análisis principal. No aparece como componente en ninguna fuente de producción.', 'info', ['all'], 'El tipo está excluido y ninguno de sus productos aparece como componente PSI de productos incluidos. No participa activamente en el análisis.', 'Sin acción requerida. La fila se incluye como registro de la exclusión y su impacto nulo en otros BOMs.'],
          ['⚠ N combinación(es) componente-planta sin arco de abastecimiento.', 'yellow', ['all'], 'Sufijo que se concatena a la observación cuando existen productos del tipo excluido que actúan como componentes y no tienen arco de Location Source hacia la planta donde se consumen.', 'Configurar el arco de Location Source para las combinaciones componente+planta sin cobertura, o revisar si la exclusión del tipo es realmente apropiada.']
        ])) +
        callout('info', 'Un tipo excluido que actúa como componente PSI de productos incluidos se valida igualmente. La exclusión solo omite el análisis principal de los productos de ese tipo, no su validación como ingrediente en otros BOMs.');
    }
  },

  /* ── ESTADÍSTICAS ── */
  {
    id: 'pa-stats', icon: '📈', title: 'Hoja: Estadísticas',
    content: function () {
      return p('Hoja de estadística descriptiva del dato maestro y de las recetas. No repite la hoja Resumen: aquí no hay veredictos de consistencia sino composición, distribución y cobertura. Se organiza en secciones apiladas, cada una con su propia mini-tabla.') +
        sub('Bloques que incluye', colTable([
          ['Composición por tipo de material', 'Por cada MATTYPEID, cuántos productos son solo output (PSH), solo componente (PSI), ambos o sin uso en la estructura, con porcentaje del maestro.'],
          ['Producción por planta', 'Plantas que fabrican, productos y recetas totales, promedios por planta y distribución de recetas por planta.'],
          ['Tamaño de BOM', 'Distribución de recetas por número de componentes (0, 1-5, 6-10, 11-20, 21+), más promedio y máximo.'],
          ['Lead time de producción (PLEADTIME)', 'Distribución de SOURCEIDs por rango de PLEADTIME y promedio de los valores definidos.'],
          ['Multi-fuente y sustitutos', 'Combinaciones producto-planta con más de una receta y componentes marcados como sustituto (ISALTITEM=X).'],
          ['Composición por LOCTYPE', 'Distribución de ubicaciones por tipo según el campo LOCTYPE.'],
          ['Recursos', 'Recursos en el maestro, usados en PSR, ociosos y promedio de recursos por receta.'],
          ['Cruces por campos adicionales', 'Por cada campo extra que agregues a Product, Location o Resource, una tabla cruzada contra el tipo (MATTYPEID o LOCTYPE) o de frecuencia.']
        ])) +
        callout('info', 'Las tablas de Cruces por campos adicionales se generan automáticamente para cada campo que selecciones en el paso Campos adicionales. Por ejemplo, agregar PLMSTATUS al Product produce el cruce Tipo de material por PLMSTATUS sin configuración extra.');
    }
  },

  /* ── TIPOS DE MATERIAL ── */
  {
    id: 'pa-mattypes', icon: '🏷️', title: 'Tipos de Material',
    content: function () {
      return p('Antes de ejecutar el análisis, el usuario asigna cada MATTYPEID a una o más categorías. Esta categorización determina <strong>qué validaciones aplican</strong> y <strong>qué severidad</strong> tienen los hallazgos. Un mismo dato faltante puede ser ⛔ Alerta para un Terminado y no generar ningún hallazgo para una Materia Prima.') +
        callout('warn', 'Si no se asigna ninguna categoría, el análisis aplica reglas en "modo permisivo" (todo se marca máximo ⚠ Advertencia) y puede ocultar problemas críticos reales. <strong>Se recomienda siempre categorizar antes de interpretar los resultados.</strong>') +
        sub('Categorías disponibles',
          '<div class="glos-mattype-grid">' +
            '<div class="glos-mattype-card">' +
              '<div class="glos-mattype-header" style="background:var(--accent)">' + catBadge(['finished']) + ' Producto Terminado</div>' +
              '<div class="glos-mattype-body">' +
                '<p>Producto fabricado internamente. Requiere configuración completa para planificación de producción y distribución.</p>' +
                '<ul>' +
                  '<li>Requiere BOM completo (PSH + PSI + PSR)</li>' +
                  '<li>PLEADTIME ausente o cero → ⛔ Alerta</li>' +
                  '<li>OUTPUTCOEFFICIENT ausente o cero → ⛔ Alerta</li>' +
                  '<li>Sin Location Product → ⛔ Alerta</li>' +
                  '<li>Planta productora no es origen en Location Source → ⛔ Alerta</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
            '<div class="glos-mattype-card">' +
              '<div class="glos-mattype-header" style="background:var(--cyan)">' + catBadge(['semi']) + ' Semiterminado</div>' +
              '<div class="glos-mattype-body">' +
                '<p>Componente fabricado internamente que alimenta otro proceso. No llega directamente al cliente.</p>' +
                '<ul>' +
                  '<li>Requiere BOM (PSH + PSI + PSR)</li>' +
                  '<li>PLEADTIME ausente o cero → ⚠ Advertencia (no ⛔)</li>' +
                  '<li>Consume en planta productora → ✅ OK (sin transferencia requerida)</li>' +
                  '<li>Transfiere sin consumo en destino → ⛔ Alerta</li>' +
                  '<li>No aplica detección de Ghost Nodes ni Dead-ends (no necesita llegar a cliente)</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
            '<div class="glos-mattype-card">' +
              '<div class="glos-mattype-header" style="background:var(--green)">' + catBadge(['rawmat']) + ' Mat. Prima / Insumo</div>' +
              '<div class="glos-mattype-body">' +
                '<p>Ítem adquirido externamente. No se fabrica ni transforma internamente.</p>' +
                '<ul>' +
                  '<li>No requiere PSH, PSI ni PSR</li>' +
                  '<li>Debe tener arco de proveedor en Location Source → si falta = ⛔ Alerta</li>' +
                  '<li>No se evalúa PLEADTIME ni ruta a cliente</li>' +
                  '<li>Tener PSH es inusual → ⚠ Advertencia de categorización</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
            '<div class="glos-mattype-card">' +
              '<div class="glos-mattype-header" style="background:var(--purple)">' + catBadge(['trading']) + ' Mercadería</div>' +
              '<div class="glos-mattype-body">' +
                '<p>Producto comprado y revendido sin transformación interna.</p>' +
                '<ul>' +
                  '<li>No requiere PSH, PSI ni PSR</li>' +
                  '<li>Debe tener Location Source y Customer Source → sin ninguno = ⚠ Advertencia</li>' +
                  '<li>PLEADTIME no se evalúa</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
          '</div>'
        ) +
        callout('info', '<strong>Multi-categoría:</strong> Un MATTYPEID puede pertenecer a más de una categoría. En ese caso, se aplica la regla más permisiva: si Terminado pide ⛔ y Semiterminado pide ⚠, el resultado es ⚠.');
    }
  }
];

/* ═══════════════════════════════════════════════════════════════
   SUPPLY NETWORK ANALYZER — SECCIONES
   ═══════════════════════════════════════════════════════════════ */

const SN_SECTIONS = [

  /* ── INTRO ── */
  {
    id: 'sn-intro', icon: '📋', title: 'Introducción',
    content: function () {
      return p('El <strong>Network Analyzer</strong> examina la red logística completa de SAP IBP: plantas, centros de distribución, clientes, arcos de transferencia (Location Source) y arcos de entrega (Customer Source). Para cada producto, construye el grafo de la red y detecta anomalías topológicas.') +
        p('El Excel de salida tiene 6 hojas: Resumen, Product, Location, Customer, Location Source y Customer Source. Cada hoja analiza la entidad desde la perspectiva de conectividad, lead times y habilitación en Location Product.') +
        legendEstados() +
        callout('info', '<strong>Importante:</strong> Al igual que en Production Analyzer, los hallazgos dependen de la categorización de tipos de material. Un producto Terminado que no llega a ningún cliente genera ⛔ Alerta; el mismo problema en un Semiterminado puede no generar alerta porque no se espera que llegue directamente al cliente. Ver sección <em>Tipos de Material</em>.') +
        callout('info', '<strong>Auto-split:</strong> Si una hoja supera 900.000 filas, el analizador crea hojas adicionales con el mismo nombre y sufijo numérico: Product (2), Product (3), etc. Las columnas son idénticas en todas las hojas del mismo grupo.');
    }
  },

  /* ── RESUMEN ── */
  {
    id: 'sn-resumen', icon: '📊', title: 'Hoja: Resumen',
    content: function () {
      return p('Primera hoja del libro. Una fila por cada hoja analizada. Permite ver de un vistazo la salud general de la red logística.') +
        colTable([
          ['#', 'Número de hoja en el libro Excel.'],
          ['Hoja', 'Nombre de la hoja analizada (Product, Location, Customer, Location Source, Customer Source).'],
          ['Total registros', 'Cantidad de filas procesadas en esa hoja.'],
          ['Alertas 🔴', 'Registros con problema crítico de conectividad o configuración.'],
          ['Advertencias 🟡', 'Registros con dato incompleto o sospechoso que conviene revisar.'],
          ['OK ✅', 'Registros sin hallazgos — todas las validaciones aplicables pasaron.'],
          ['% Consistencia', 'Porcentaje de registros OK sobre el total. Fórmula: OK / Total × 100.']
        ]) +
        callout('tip', '<strong>Lectura recomendada:</strong> Comienza por la hoja Product, que concentra los hallazgos más importantes de conectividad. Luego revisa Location para identificar nodos críticos y finalmente Location Source / Customer Source para arcos con problemas de lead time o configuración.');
    }
  },

  /* ── PRODUCT ── */
  {
    id: 'sn-product', icon: '🧪', title: 'Hoja: Product',
    content: function () {
      return p('Una fila por cada producto presente en la red (Location Source, Customer Source, PSH o Location Product). Esta hoja es el corazón del análisis: construye el grafo completo de la red para cada producto y detecta anomalías de conectividad.') +
        sub('Columnas de identificación', colTable([
          ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave encontrado.'],
          ['Observacion', 'Detalle de todos los hallazgos o, si está OK, descripción de qué validaciones pasaron.'],
          ['PRDID', 'Código único del producto en SAP IBP.'],
          ['PRDDESCR', 'Descripción del producto del maestro.'],
          ['MATTYPEID', 'Tipo de material SAP. Determina qué reglas de análisis se aplican.']
        ])) +
        sub('Columnas de presencia en red (flags Sí/No)', colTable([
          ['En PSH?', '¿El producto tiene al menos una fuente de producción (PSH)?'],
          ['En PSI?', '¿El producto aparece como componente en alguna receta?'],
          ['En Location Source?', '¿Tiene arcos de transferencia entre ubicaciones?'],
          ['En Customer Source?', '¿Tiene arcos de entrega a algún cliente?'],
          ['En Location Product?', '¿Está habilitado en Location Product en al menos una ubicación?'],
          ['En Customer Product?', '¿Está habilitado en Customer Product para algún cliente?'],
          ['Solo en maestro?', 'Sí = el producto solo existe en el maestro de materiales sin ninguna actividad en la red. Indica producto huérfano.']
        ])) +
        sub('Columnas de análisis de red', colTable([
          ['Estado de la Red', 'Clasificación sintética de la situación logística del producto. Ver tabla de estados más abajo.'],
          ['# Plantas', 'Número de plantas que producen este producto (tienen PSH).'],
          ['# DCs', 'Número de centros de distribución o nodos intermedios que manejan este producto en Location Source sin ser plantas productoras.'],
          ['# Clientes', 'Número de clientes que reciben este producto vía Customer Source.'],
          ['# Rutas completas', 'Cantidad de rutas planta-a-cliente encontradas. 0 = el producto no llega a ningún cliente.'],
          ['Ruta mas larga', 'Número de saltos de la ruta más larga encontrada (planta → DC → ... → cliente).'],
          ['# Ghost Nodes', 'Ubicaciones intermedias que reciben el producto pero cuyas salidas no llegan a ningún cliente.'],
          ['# Dead Ends', 'Ubicaciones que reciben el producto pero no tienen ninguna salida configurada.'],
          ['Health Score', 'Puntaje 0-100 que mide la salud de la configuración de red del producto. Ver sección Health Score más abajo.'],
          ['Categoria de salud', 'Healthy = Health Score ≥ 80 | Acceptable = ≥ 60 | Weak = ≥ 40 | Critical = < 40.'],
          ['Detalle Calculo Health Score', 'Desglose paso a paso: bonificaciones (+) por rutas completas, multi-sourcing, múltiples clientes y lead times; penalizaciones (-) por Ghost Nodes, Dead-ends, rutas únicas y fuente única de producción.'],
          ['# Origenes (LOCFR)', 'Número de ubicaciones de origen distintas que envían este producto en Location Source.'],
          ['Origenes (codigos)', 'Códigos de las ubicaciones origen.'],
          ['# Destinos (LOCID)', 'Número de ubicaciones de destino distintas que reciben este producto vía Location Source.'],
          ['Destinos (codigos)', 'Códigos de las ubicaciones destino.'],
          ['# Clientes en CustSrc', 'Número de clientes configurados en Customer Source para este producto.'],
          ['Clientes (codigos)', 'Códigos de los clientes configurados en Customer Source.'],
          ['Multi-sourced?', 'Sí/No — alguna ubicación destino recibe este producto desde más de un origen simultáneamente.'],
          ['TLT promedio (dias)', 'Promedio de TLEADTIME de todos los arcos de Location Source. "—" si no hay arcos.'],
          ['CLT promedio (dias)', 'Promedio de CLEADTIME de todos los arcos de Customer Source. "—" si no hay arcos.'],
          ['# Plantas aisladas', 'Plantas que producen el producto pero no tienen ninguna ruta hasta algún cliente.']
        ])) +
        callout('info', '<strong>Valor N/A:</strong> Cuando una métrica no aplica o no tiene datos (ej: TLT promedio para un producto sin Location Source), la celda muestra "—" con fondo gris claro en itálica. No indica un error sino ausencia de dato para ese campo.') +
        sub('Health Score — fórmula por categoría',
          p('El puntaje se calcula de forma diferente según la categoría del producto, porque las expectativas de red son distintas para cada tipo:') +
          '<div class="glos-table-wrap"><table class="glos-col-table"><thead><tr><th>Categoría</th><th>Bonificaciones</th><th>Penalizaciones</th></tr></thead><tbody>' +
            '<tr><td>' + catBadge(['finished']) + ' Terminado / Sin cat.</td><td>+50 si hay rutas completas; +15 si múltiples clientes; +15 si múltiples rutas; +20 si múltiples plantas.</td><td>-20 por ghost nodes; -15 por dead-ends; -20 por clientes con ruta única; -15 por fuente única de producción.</td></tr>' +
            '<tr><td>' + catBadge(['semi']) + ' Semiterminado</td><td>+30 si tiene PSH; +40 si tiene consumo PSI; +20 si múltiples plantas; +10 si tiene Location Source.</td><td>Sin penalizaciones.</td></tr>' +
            '<tr><td>' + catBadge(['rawmat']) + ' Mat. Prima</td><td>+60 si tiene Location Source; +20 si tiene al menos un destino intermedio (DC) en Location Source; +20 si tiene Customer Source.</td><td>Sin penalizaciones.</td></tr>' +
            '<tr><td>' + catBadge(['trading']) + ' Mercadería</td><td>+40 si tiene Location Source; +40 si tiene Customer Source; +20 si múltiples clientes.</td><td>Sin penalizaciones.</td></tr>' +
          '</tbody></table></div>'
        ) +
        sub('Estados de la Red', netStatusTable([
          ['Red Completa', 'ok', ['finished', 'uncategorized'], 'El producto tiene al menos una ruta completa desde una planta productora hasta un cliente. Configuración correcta.'],
          ['Sin Entrega a Cliente', 'red', ['finished', 'uncategorized'], 'El producto tiene producción (PSH) y arcos de distribución (Location Source) pero ninguno llega hasta un Customer Source — no se entrega a ningún cliente.'],
          ['Sin Distribución', 'red', ['finished', 'uncategorized'], 'El producto tiene producción (PSH) pero no hay arcos de distribución (Location Source) desde la planta. Sale de la planta sin ruta configurada.'],
          ['Distribución sin ruta completa', 'red', ['finished', 'uncategorized'], 'El producto tiene Customer Source configurado pero no existe ninguna ruta completa que conecte la producción con esa entrega al cliente.'],
          ['Solo Entrega', 'red', ['trading', 'uncategorized'], 'El producto tiene Customer Source (entrega a cliente) pero no tiene Location Source (distribución). Sin origen declarado en la red.'],
          ['Solo Distribución', 'yellow', ['trading'], 'El producto tiene Location Source pero no tiene Customer Source — nunca llega a ningún cliente desde la red declarada.'],
          ['Solo Distribución', 'red', ['uncategorized'], 'El producto sin categoría tiene Location Source pero no tiene Customer Source ni PSH. Sin categoría definida, la ausencia de entrega a cliente se considera un error.'],
          ['Solo Distribución + Entrega', 'ok', ['trading'], 'Mercadería con arcos de distribución (LS) y entrega (CS) correctamente configurados.'],
          ['Solo Distribución + Entrega', 'red', ['uncategorized'], 'El producto sin categoría tiene arcos de distribución y entrega pero no tiene PSH. Sin categoría definida, la ausencia de producción se considera un error.'],
          ['Semiterminado Local', 'ok', ['semi'], 'El semiterminado se produce y consume en la misma planta. No requiere transferencia.'],
          ['Semiterminado con Transferencia', 'ok', ['semi'], 'El semiterminado se produce en una planta y se consume como PSI en la planta destino de la transferencia.'],
          ['Semiterminado Local con Transferencia', 'ok', ['semi'], 'El semiterminado se consume en la planta productora Y también se transfiere a otra planta donde también se consume.'],
          ['Semiterminado sin Transferencia', 'red', ['semi'], 'El semiterminado tiene PSH en una planta distinta a donde es consumido, pero no tiene arco de Location Source hacia la planta consumidora.'],
          ['Sin Producción', 'red', ['semi', 'finished'], 'El producto no tiene Production Source Header — no tiene fuente de producción configurada. Para semiterminado: no se está fabricando internamente. Para terminado: está categorizado como producto final pero tiene arcos de red sin receta de producción.'],
          ['Sin Consumo PSI', 'red', ['semi'], 'El semiterminado tiene producción pero no aparece como componente en ningún BOM.'],
          ['Abastecimiento Completo', 'ok', ['rawmat'], 'El insumo tiene arcos de Location Source que llegan hasta al menos una planta productora.'],
          ['Abastecimiento Parcial', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero ningún arco llega hasta una planta productora — posible configuración incompleta.'],
          ['Abastecimiento sin Consumo PSI', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero no aparece en ningún BOM como componente — arco de abastecimiento sin uso productivo declarado.'],
          ['Sin Abastecimiento', 'red', ['rawmat'], 'El insumo no tiene ningún arco en Location Source — no tiene origen declarado en la red.'],
          ['Sin arcos de red', 'red', ['finished', 'uncategorized'], 'El producto no tiene ningún arco en Location Source ni Customer Source — completamente desconectado de la red.'],
          ['Sin arcos de red', 'yellow', ['trading'], 'La mercadería no tiene ningún arco en Location Source ni Customer Source — completamente desconectada de la red.'],
          ['Huérfano', 'red', ['all'], 'El producto solo existe en el maestro de materiales sin ninguna actividad en la red (no está en PSH, PSI, Location Source, Customer Source ni Location Product).']
        ])) +
        callout('warn', '<strong>Estados de la Red en la columna Observacion:</strong> Cuando el Estado de la Red no es el estado OK de la categoría del producto, su texto exacto aparece también como primera observación en la columna Observacion. Los estados OK por categoría son: <em>Terminado / Sin cat.</em> = "Red Completa"; <em>Mercadería</em> = "Solo Distribución + Entrega"; <em>Mat. Prima</em> = "Abastecimiento Completo"; <em>Semiterminado</em> = cualquiera de los tres estados "Semiterminado...". Todos los demás estados indican un problema y aparecen en Observacion con el mismo texto.') +
        sub('Observaciones posibles', obsTable([
          ['Sin Entrega a Cliente', 'red', ['finished', 'uncategorized'], 'El producto tiene PSH y Location Source pero ningún arco llega hasta un cliente. El Estado de la Red es "Sin Entrega a Cliente" y ese texto aparece en Observacion.', 'Verificar que exista al menos un arco de Customer Source para este producto, o que la red de Location Source conecte la producción con alguna ubicación que tenga Customer Source.'],
          ['Sin Distribución', 'red', ['finished', 'uncategorized'], 'El producto tiene PSH pero no tiene arcos de Location Source saliendo de la planta. El Estado de la Red es "Sin Distribución" y ese texto aparece en Observacion.', 'Crear al menos un arco en Location Source con la planta productora como LOCFR.'],
          ['Distribución sin ruta completa', 'red', ['finished', 'uncategorized'], 'El producto tiene Customer Source pero no existe ninguna ruta completa de producción que llegue hasta él. Aparece textualmente en Observacion.', 'Revisar los arcos de Location Source e identificar el nodo desconectado que impide que la producción llegue hasta el arco de entrega al cliente.'],
          ['Solo Entrega', 'red', ['trading', 'uncategorized'], 'El producto tiene Customer Source pero no tiene Location Source. Aparece textualmente en Observacion.', 'Configurar los arcos de Location Source que lleven el producto desde su origen hasta la ubicación de entrega al cliente.'],
          ['Solo Distribución', 'yellow', ['trading'], 'El producto tiene Location Source pero no tiene Customer Source. Aparece textualmente en Observacion.', 'Configurar los arcos de Customer Source para que el producto llegue a algún cliente.'],
          ['Solo Distribución', 'red', ['uncategorized'], 'El producto sin categoría tiene Location Source pero no tiene Customer Source ni PSH. Aparece textualmente en Observacion.', 'Asignar una categoría al tipo de material en la configuración, o configurar los arcos de Customer Source y Production Source Header que correspondan.'],
          ['Solo Distribución + Entrega', 'red', ['uncategorized'], 'El producto sin categoría tiene arcos de distribución (LS) y entrega (CS) pero no tiene PSH. Aparece textualmente en Observacion.', 'Asignar la categoría correcta al tipo de material. Si es Mercadería, reclasificarlo como trading en la configuración de tipos de material.'],
          ['Sin arcos de red', 'red', ['finished', 'uncategorized'], 'El producto no tiene ningún arco en Location Source ni Customer Source. Aparece textualmente en Observacion.', 'Revisar si el producto está activo en IBP. Configurar al menos un arco en Location Source o Customer Source según corresponda a su rol en la cadena.'],
          ['Sin arcos de red', 'yellow', ['trading'], 'La mercadería no tiene ningún arco en Location Source ni Customer Source. Aparece textualmente en Observacion.', 'Revisar si el producto está activo en IBP. Configurar al menos un arco en Location Source o Customer Source según el rol de distribución esperado.'],
          ['Semiterminado sin Transferencia', 'red', ['semi'], 'El semiterminado se produce en una planta distinta a donde es consumido, pero no tiene arco de Location Source hacia la planta consumidora. Aparece textualmente en Observacion.', 'Configurar el arco de Location Source desde la planta productora del semiterminado hacia la planta donde es consumido como componente.'],
          ['Sin Producción', 'red', ['semi', 'finished'], 'El producto no tiene PSH. Para semiterminado: no está fabricándose internamente. Para terminado: tiene arcos de red pero no tiene receta de producción configurada. Aparece textualmente en Observacion.', 'Crear la fuente de producción (PSH con SOURCETYPE=P) en IBP, o verificar si el producto debe reclasificarse como Mercadería en la configuración de tipos de material.'],
          ['Sin Consumo PSI', 'red', ['semi'], 'El semiterminado tiene PSH pero no aparece como componente en ningún BOM. Aparece textualmente en Observacion.', 'Agregar este semiterminado como componente (PSI) en el BOM del producto terminado que lo consume.'],
          ['Sin Abastecimiento', 'red', ['rawmat'], 'El insumo no tiene ningún arco en Location Source. Aparece textualmente en Observacion.', 'Configurar el arco de Location Source con el proveedor o planta origen como LOCFR hacia las plantas consumidoras.'],
          ['Abastecimiento Parcial', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero ningún arco llega hasta una planta productora. Aparece textualmente en Observacion.', 'Revisar si falta el arco final en Location Source que conecte el origen con la planta donde se consume el insumo.'],
          ['Abastecimiento sin Consumo PSI', 'yellow', ['rawmat'], 'El insumo tiene Location Source pero no aparece en ningún BOM. Aparece textualmente en Observacion.', 'Verificar si el insumo está vigente y si debe ser agregado como componente PSI en alguna receta de producción.'],
          ['Huérfano', 'red', ['all'], 'El producto solo existe en el maestro de materiales — no tiene ninguna actividad en la red. Aparece textualmente en Observacion.', 'Verificar si el producto es obsoleto o si falta configurar su participación en la red (PSH, Location Source, Customer Source o Location Product).'],
          ['Ghost node: X', 'red', ['finished', 'trading', 'uncategorized'], 'La ubicación X recibe el producto pero todas sus salidas terminan en un callejón sin salida — no llega a ningún cliente.', 'Revisar la configuración de arcos salientes de la ubicación X en Location Source. Puede faltar un arco hacia el siguiente nodo o hacia un Customer Source.'],
          ['Dead-end: X', 'red', ['finished', 'trading', 'uncategorized'], 'La ubicación X recibe el producto por Location Source pero no tiene ninguna salida configurada — el producto llega y no puede continuar.', 'Agregar el arco de salida faltante en Location Source o en Customer Source desde la ubicación X, o verificar si ese nodo es el destino final (y entonces falta un Customer Source).'],
          ['Planta aislada: X', 'red', ['finished', 'trading', 'uncategorized'], 'La planta X produce este producto pero no tiene ninguna ruta que llegue a algún cliente — producción sin mercado alcanzable.', 'Revisar arcos de distribución desde la planta X en Location Source. Puede faltar el arco inicial desde la planta hacia el primer nodo de distribución.'],
          ['Ciclo: X → Y → Z → X', 'red', ['all'], 'Se detectó un ciclo en la red: el producto puede circular indefinidamente entre estas ubicaciones sin llegar a ningún cliente.', 'Revisar los arcos de Location Source entre las ubicaciones del ciclo e identificar cuál está configurado en sentido incorrecto.'],
          ['PLEADTIME faltante: X', 'red', ['finished', 'semi', 'uncategorized'], 'La planta X produce este producto pero su PLEADTIME es 0 o está vacío. IBP planifica producción instantánea.', 'Ingresar el PLEADTIME real en días en el Production Source Header para la planta X y este producto.'],
          ['TLEADTIME faltante: X→Y', 'yellow', ['all'], 'El arco de transferencia X→Y tiene TLEADTIME = 0 o vacío. IBP planifica transferencias instantáneas en ese tramo.', 'Ingresar el TLEADTIME real en días en el arco de Location Source X→Y para este producto.'],
          ['CLEADTIME faltante: X→Y', 'yellow', ['finished', 'trading', 'uncategorized'], 'El arco de entrega X→Y (hacia cliente) tiene CLEADTIME = 0 o vacío. IBP planifica entregas instantáneas en ese tramo.', 'Ingresar el CLEADTIME real en días en el arco de Customer Source X→Y para este producto.'],
          ['Sin Location Product', 'yellow', ['all'], 'El producto está en PSH o en Location Source pero no está habilitado en Location Product en alguna ubicación de la red.', 'Habilitar el producto en Location Product para las ubicaciones donde participa activamente en la red.'],
          ['Sin Customer Product', 'yellow', ['all'], 'El producto tiene Customer Source (entrega a cliente) pero no está habilitado en Customer Product para ese cliente.', 'Habilitar la combinación producto+cliente en Customer Product en IBP.'],
          ['Red desconectada: arcos LS y CS no comparten ubicaciones', 'red', ['trading', 'uncategorized'], 'Los arcos de distribución (Location Source) y los arcos de entrega (Customer Source) no tienen ninguna ubicación en común — la red está partida en dos fragmentos desconectados.', 'Revisar que al menos una ubicación aparezca tanto en Location Source (como destino) como en Customer Source (como origen de entrega).'],
          ['Destino(s) de transferencia sin consumo PSI: X, Y', 'red', ['semi'], 'El semiterminado se transfiere a las ubicaciones X, Y pero en ninguna de ellas se consume como ingrediente en alguna receta.', 'Agregar el semiterminado como componente PSI en el BOM de la planta destino, o eliminar el arco de transferencia si es un error.'],
          ['Paths truncados (>50.000, red muy compleja)', 'yellow', ['all'], 'La red tiene más de 50.000 rutas posibles — se procesaron parcialmente para evitar bloqueo del sistema.', 'Esta advertencia es informativa. El análisis es representativo pero puede no detectar todas las anomalías. Considerar simplificar la red o analizar por subconjunto de productos.'],
          ['Semiterminado consumido en planta productora con transferencia configurada', 'ok', ['semi'], 'El semiterminado se consume en la planta donde se fabrica y además se transfiere a otra planta donde también se consume como PSI.', 'Sin acción requerida.'],
          ['Semiterminado consumido en destino de transferencia', 'ok', ['semi'], 'El semiterminado se transfiere a otra planta donde es consumido como PSI — flujo correcto.', 'Sin acción requerida.'],
          ['Semiterminado consumido en planta productora', 'ok', ['semi'], 'El semiterminado se consume localmente en la planta donde se fabrica.', 'Sin acción requerida.'],
          ['Habilitado en Location Product', 'ok', ['all'], 'El producto está habilitado en Location Product en todas las ubicaciones activas de su red.', 'Sin acción requerida.'],
          ['Lead times definidos', 'ok', ['semi', 'finished', 'uncategorized'], 'Todos los arcos de transferencia y entrega del producto tienen lead time mayor que cero.', 'Sin acción requerida.'],
          ['Mercadería con arcos de distribución y entrega', 'ok', ['trading'], 'La mercadería tiene Location Source y Customer Source correctamente configurados.', 'Sin acción requerida.'],
          ['Red completa sin anomalias', 'ok', ['finished', 'uncategorized'], 'El producto tiene rutas completas de planta a cliente y no se detectaron Ghost Nodes, Dead-ends ni ciclos.', 'Sin acción requerida.'],
          ['N ruta(s) a cliente', 'ok', ['finished', 'trading', 'uncategorized'], 'El producto tiene N rutas completas desde plantas productoras hasta clientes. A mayor número de rutas, mayor resiliencia.', 'Sin acción requerida.'],
          ['Habilitado en Customer Product', 'ok', ['finished', 'trading', 'uncategorized'], 'El producto está habilitado en Customer Product en todos los clientes con entrega configurada.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── LOCATION ── */
  {
    id: 'sn-location', icon: '🏭', title: 'Hoja: Location',
    content: function () {
      return p('Una fila por cada ubicación detectada en la red. Acumula los hallazgos topológicos de todos los productos que pasan por esa ubicación.') +
        sub('Roles inferidos de ubicación', colTable([
          ['Planta con Entrega', 'Tiene PSH (fabrica) Y entrega directamente a clientes vía Customer Source.'],
          ['Planta', 'Tiene PSH (fabrica) pero no entrega directamente a clientes.'],
          ['DC con Entrega Directa', 'Aparece en Location Source como origen o destino (redistribuye) Y entrega directamente a clientes vía Customer Source.'],
          ['DC', 'Aparece en Location Source sin entrega directa a clientes.'],
          ['Punto de Entrega', 'Solo aparece en Customer Source como origen de entrega a clientes — sin producción ni transferencias entre ubicaciones.'],
          ['Sin rol activo', 'No aparece en ninguna entidad de red activa — ubicación inactiva o solo en el maestro.']
        ])) +
        sub('Columnas clave', colTable([
          ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave.'],
          ['Observacion', 'Detalle de todos los hallazgos.'],
          ['LOCID', 'Código de la ubicación.'],
          ['LOCDESCR', 'Descripción de la ubicación del maestro.'],
          ['LOCTYPE', 'Tipo de ubicación del maestro (informativo).'],
          ['Rol inferido', 'Rol inferido del comportamiento de la ubicación en la red. Ver tabla de roles más arriba.'],
          ['En PSH?', 'Sí/No — la ubicación tiene al menos una fuente de producción (fabrica algo).'],
          ['En Location Source?', 'Sí/No — aparece como origen o destino en algún arco de transferencia.'],
          ['En Customer Source?', 'Sí/No — aparece como ubicación de entrega a algún cliente.'],
          ['En Location Product?', 'Sí/No — habilitada en Location Product. Sin esto IBP no planifica en esta ubicación.'],
          ['Solo en maestro?', 'Sí = la ubicación existe en el maestro pero no aparece en ninguna entidad de red activa.'],
          ['# Productos manejados', 'Total de productos distintos que pasan por esta ubicación como origen, destino o planta productora.'],
          ['# Como origen (LOCFR)', 'Cuántos arcos de Location Source tienen esta ubicación como origen.'],
          ['# Como destino (LOCID)', 'Cuántos arcos de Location Source tienen esta ubicación como destino.'],
          ['# Clientes servidos', 'Número de clientes distintos que reciben productos desde esta ubicación vía Customer Source.'],
          ['Es nodo critico?', 'Sí/No — su eliminación cortaría rutas de al menos un producto a al menos un cliente.'],
          ['# Productos impactados', 'Si es nodo crítico: cuántos productos distintos dependen de este nodo para llegar a algún cliente.'],
          ['# Clientes impactados', 'Si es nodo crítico: cuántos clientes distintos perderían abastecimiento si este nodo fallara.'],
          ['Nivel de riesgo', 'Critical = 4 o más productos impactados | High = 2-3 productos | Medium = 1 producto. Solo aplica si es nodo crítico.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Ghost node (alimentado sin salida util)', 'red', ['finished', 'trading'], 'Esta ubicación recibe el producto desde algún origen pero todas sus salidas conducen a callejones sin salida — el producto nunca llega a un cliente a través de este nodo.', 'Revisar los arcos salientes de esta ubicación en Location Source y Customer Source. Puede faltar el arco final hacia un cliente o hacia el siguiente nodo de la cadena.'],
          ['Dead-end (recibe pero no reenvía)', 'red', ['finished', 'trading'], 'Esta ubicación recibe producto por Location Source pero no tiene ningún arco de salida configurado — el producto llega y no puede continuar.', 'Agregar el arco de salida faltante en Location Source o Customer Source, o verificar si esta ubicación es el destino final y falta el arco a un cliente.'],
          ['Planta aislada (sin ruta a ningun cliente)', 'red', ['finished'], 'Esta planta produce algún producto pero ninguna de sus rutas logísticas llega hasta algún cliente.', 'Revisar la configuración de Location Source desde esta planta e identificar el arco faltante que conecte la producción con la red de distribución.'],
          ['Participa en ciclo: X→Y→Z→X', 'red', ['all'], 'Esta ubicación forma parte de un ciclo en la red logística. El producto puede circular indefinidamente sin llegar a un cliente.', 'Identificar cuál de los arcos del ciclo está configurado en sentido incorrecto y corregirlo en Location Source.'],
          ['Sin Location Product', 'red', ['all'], 'Esta ubicación participa activamente en la red (PSH o Location Source) pero no está habilitada en Location Product. IBP no puede planificar en ella.', 'Habilitar la ubicación en Location Product para los productos que la utilizan.'],
          ['Nodo critico: N prod, N clientes', 'yellow', ['all'], 'Esta ubicación es un punto único de falla: si desaparece, N productos dejarían de llegar a N clientes. No es un error de configuración sino un riesgo de resiliencia.', 'Evaluar si se justifica agregar una ruta alternativa que no dependa de este nodo para los productos críticos.'],
          ['Solo en maestro de ubicaciones, sin actividad en la red', 'yellow', ['all'], 'La ubicación existe en el maestro pero no aparece en ninguna entidad de red.', 'Verificar si la ubicación es obsoleta o si falta configurar su participación en la red de abastecimiento.'],
          ['Sin anomalias topologicas', 'ok', ['all'], 'La ubicación no presenta Ghost Nodes, Dead-ends, ciclos ni problemas de Location Product en ninguno de sus productos.', 'Sin acción requerida.'],
          ['Habilitado en Location Product', 'ok', ['all'], 'La ubicación está habilitada en Location Product para todos los productos activos que la utilizan.', 'Sin acción requerida.'],
          ['N cliente(s) servido(s)', 'ok', ['all'], 'La ubicación despacha a N clientes distintos vía Customer Source.', 'Sin acción requerida.'],
          ['Activo como origen para N producto(s)', 'ok', ['all'], 'La ubicación es origen activo en Location Source para N productos distintos.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── CUSTOMER ── */
  {
    id: 'sn-customer', icon: '👤', title: 'Hoja: Customer',
    content: function () {
      return p('Una fila por cada cliente detectado en la red (Customer Source o Customer Product). Analiza si cada cliente puede recibir productos a través de rutas completas desde la producción.') +
        sub('Columnas clave', colTable([
          ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave.'],
          ['Observacion', 'Detalle de todos los hallazgos.'],
          ['CUSTID', 'Código único del cliente en SAP IBP.'],
          ['CUSTDESCR', 'Descripción del cliente del maestro.'],
          ['En Customer Source?', 'Sí/No — el cliente tiene al menos un arco de entrega configurado.'],
          ['En Customer Product?', 'Sí/No — habilitado en Customer Product. Sin esto IBP ignora al cliente en planificación.'],
          ['Solo en maestro?', 'Sí = el cliente existe en el maestro pero no tiene arcos de entrega en Customer Source.'],
          ['# Productos recibidos', 'Número de productos distintos que este cliente puede recibir según Customer Source.'],
          ['# Ubicaciones proveedoras', 'Número de ubicaciones desde las que se despacha al cliente.'],
          ['# Paths que llegan', 'Total de rutas completas de planta a este cliente (suma de todos sus productos).'],
          ['Resiliencia predominante', 'Single Path = algún producto llega solo por una ruta completa | Single Node Dependency = hay un nodo único cuyo fallo corta el abastecimiento | Resilient = todos los productos tienen rutas alternativas | — = sin rutas configuradas.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Sin productos alcanzables desde produccion', 'red', ['all'], 'El cliente tiene Customer Source configurado pero ninguna ruta completa conecta la producción con sus arcos de entrega.', 'Revisar la red de distribución hacia este cliente e identificar los arcos faltantes en Location Source o Customer Source.'],
          ['Sin Customer Product', 'yellow', ['all'], 'El cliente tiene arcos de entrega (Customer Source) pero no está habilitado en Customer Product. IBP lo ignora en la planificación.', 'Habilitar las combinaciones cliente+producto correspondientes en Customer Product en IBP.'],
          ['N producto(s) con unica ruta', 'yellow', ['all'], 'N productos llegan a este cliente por una sola ruta completa. Si esa ruta falla, el abastecimiento se corta.', 'Evaluar si se justifica agregar una ruta alternativa para los productos indicados, para aumentar la resiliencia del abastecimiento.'],
          ['N producto(s) con nodo critico unico', 'info', ['all'], 'N productos llegan a este cliente a través de un nodo crítico único: si ese nodo desaparece, el abastecimiento se corta. El Estado puede ser ✅ si no hay además rutas de punto único — es una observación de riesgo de resiliencia, no un error de configuración.', 'Identificar el nodo crítico indicado y evaluar agregar una ruta alternativa que evite ese único punto de falla.'],
          ['Solo en maestro, sin uso en red', 'red', ['all'], 'El cliente existe en el maestro pero no tiene arcos de entrega en Customer Source ni está habilitado en Customer Product. Se marca ⛔ porque un cliente sin ninguna actividad en la red es una anomalía de datos.', 'Verificar si el cliente es obsoleto o si falta configurar sus arcos de entrega en Customer Source.'],
          ['Abastecido con rutas resilientes', 'ok', ['all'], 'Todos los productos de este cliente tienen múltiples rutas alternativas y no dependen de un nodo único.', 'Sin acción requerida.'],
          ['Habilitado en Customer Product', 'ok', ['all'], 'El cliente está habilitado en Customer Product para todos los productos que lo abastecen.', 'Sin acción requerida.'],
          ['N producto(s) alcanzables', 'ok', ['all'], 'El cliente tiene N productos con al menos una ruta completa de producción configurada.', 'Sin acción requerida.'],
          ['N ruta(s) configuradas', 'ok', ['all'], 'El cliente tiene N rutas de entrega activas en Customer Source con al menos una fuente de producción alcanzable.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── LOCATION SOURCE ── */
  {
    id: 'sn-ls', icon: '↗️', title: 'Hoja: Location Source',
    content: function () {
      return p('Una fila por cada arco de transferencia en Location Source (combinación PRDID + LOCFR + LOCID). Analiza si cada arco tiene lead time definido, si los nodos extremos están habilitados en Location Product, y si el arco pertenece a alguna ruta completa.') +
        sub('Columnas clave', colTable([
          ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave del arco.'],
          ['Observacion', 'Detalle de todos los hallazgos del arco.'],
          ['PRDID', 'Producto transferido en este arco.'],
          ['PRDDESCR', 'Descripción del producto.'],
          ['MATTYPEID', 'Tipo de material del producto.'],
          ['LOCFR', 'Código de la ubicación de origen del arco.'],
          ['LOCFR Descripcion', 'Descripción de la ubicación origen.'],
          ['LOCID', 'Código de la ubicación de destino del arco.'],
          ['LOCID Descripcion', 'Descripción de la ubicación destino.'],
          ['TLEADTIME', 'Lead time de transferencia en días. 0 o vacío genera ⚠ Advertencia.'],
          ['LOCFR+PRDID en Location Product?', 'Sí/No — la ubicación origen está habilitada para este producto en Location Product.'],
          ['LOCID+PRDID en Location Product?', 'Sí/No — la ubicación destino está habilitada para este producto en Location Product.'],
          ['PRDID en PSH?', 'Sí/No — el producto tiene al menos una fuente de producción. Útil para distinguir si el producto se fabrica o solo se redistribuye.'],
          ['Arco en ruta completa?', 'Sí/No — este arco forma parte de al menos una ruta que llega a un cliente. Arcos con No son candidatos a revisión: están configurados pero no contribuyen a ninguna ruta de planta a cliente. Pueden ser obsoletos o pueden indicar una brecha en la red.'],
          ['Arco inverso?', 'Sí/No — existe un arco configurado en dirección opuesta (LOCID→LOCFR) para el mismo producto. Puede indicar un ciclo en la red.'],
          ['Lead Time Status', 'OK = TLEADTIME > 0 | Zero = TLEADTIME = 0 | Missing = sin valor definido.'],
          ['SPOF arco?', 'Sí/No — Single Point of Failure: el destino LOCID tiene un único origen para este producto (este arco). Si falla, el destino queda sin abastecimiento del producto.']
        ])) +
        sub('Observaciones posibles', obsTable([
          ['Sin Location Product en origen (X)', 'red', ['all'], 'La ubicación origen X no tiene habilitado este producto en Location Product. IBP no reconoce el producto en ese punto de la red.', 'Habilitar la combinación LOCFR+PRDID en Location Product en IBP.'],
          ['Sin Location Product en destino (X)', 'red', ['all'], 'La ubicación destino X no tiene habilitado este producto en Location Product. IBP no puede planificar el producto en esa ubicación.', 'Habilitar la combinación LOCID+PRDID en Location Product en IBP.'],
          ['Arco duplicado en el dataset', 'red', ['all'], 'Existe más de un arco con la misma combinación PRDID+LOCFR+LOCID en el dataset descargado. IBP puede producir comportamientos inesperados con arcos duplicados.', 'Revisar y eliminar el arco duplicado en Location Source en IBP. Verificar que no sean versiones o planning areas distintos mezclados en el mismo download.'],
          ['TLEADTIME missing', 'yellow', ['all'], 'El campo TLEADTIME no tiene valor definido. IBP usa 0 por defecto, planificando transferencias instantáneas.', 'Ingresar el TLEADTIME real en días en el arco de Location Source correspondiente en IBP.'],
          ['TLEADTIME zero', 'yellow', ['all'], 'El TLEADTIME está explícitamente definido como 0. IBP planifica transferencias instantáneas en este tramo.', 'Verificar si 0 días es intencional (cross-docking mismo día) o si falta ingresar el lead time real.'],
          ['Existe arco inverso (LOCID→LOCFR)', 'yellow', ['all'], 'Hay un arco configurado en la dirección opuesta para el mismo producto. Puede ser intencional (flujo bidireccional) o puede indicar un ciclo en la red.', 'Verificar si el flujo bidireccional es intencional. Si no, eliminar el arco inverso incorrecto en Location Source.'],
          ['Arco valido | Location Product en origen y destino | TLEADTIME definido', 'ok', ['all'], 'El arco tiene lead time definido y ambas ubicaciones extremas están habilitadas en Location Product.', 'Sin acción requerida.'],
          ['... | En ruta completa', 'ok', ['all'], 'Además de estar correctamente configurado, este arco forma parte de al menos una ruta completa de planta a cliente.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── CUSTOMER SOURCE ── */
  {
    id: 'sn-cs', icon: '📦', title: 'Hoja: Customer Source',
    content: function () {
      return p('Una fila por cada arco de entrega a cliente en Customer Source (combinación PRDID + LOCID + CUSTID). Analiza si cada entrega tiene lead time definido, si los extremos están habilitados, y si existe una ruta completa que la abastezca.') +
        sub('Columnas clave', colTable([
          ['Estado', '⛔ / ⚠ / ✅ según el hallazgo más grave del arco.'],
          ['Observacion', 'Detalle de todos los hallazgos del arco.'],
          ['PRDID', 'Producto entregado al cliente.'],
          ['PRDDESCR', 'Descripción del producto.'],
          ['MATTYPEID', 'Tipo de material del producto.'],
          ['LOCID', 'Código de la ubicación de despacho desde donde sale el producto al cliente.'],
          ['LOCID Descripcion', 'Descripción de la ubicación de despacho.'],
          ['CUSTID', 'Código del cliente receptor.'],
          ['CUSTID Descripcion', 'Descripción del cliente.'],
          ['CLEADTIME', 'Lead time de entrega al cliente en días. 0 o vacío genera ⚠ Advertencia.'],
          ['LOCID+PRDID en Location Product?', 'Sí/No — la ubicación de despacho está habilitada para este producto en Location Product.'],
          ['CUSTID+PRDID en Customer Product?', 'Sí/No — el cliente está habilitado para este producto en Customer Product.'],
          ['PRDID en PSH?', 'Sí/No — el producto tiene al menos una fuente de producción. Útil para distinguir productos fabricados de mercadería.'],
          ['Entrega alcanzable desde produccion?', 'Sí/No — existe una ruta completa de producción que llega hasta este arco de entrega. No = hay una brecha en la red de distribución.'],
          ['Lead Time Status', 'OK = CLEADTIME > 0 | Zero = CLEADTIME = 0 | Missing = sin valor definido.']
        ])) +
        callout('tip', '<strong>Lectura clave:</strong> Los arcos con <em>Entrega alcanzable = No</em> indican que el cliente tiene arcos de entrega configurados pero la producción nunca llega hasta ese punto — hay una brecha en la red de distribución.') +
        sub('Observaciones posibles', obsTable([
          ['Sin Location Product en ubicacion (X)', 'red', ['all'], 'La ubicación de despacho X no tiene habilitado este producto en Location Product. IBP no puede planificar la entrega desde ese punto.', 'Habilitar la combinación LOCID+PRDID en Location Product en IBP.'],
          ['Sin Customer Product para cliente (X)', 'red', ['all'], 'El cliente X no está habilitado en Customer Product para este producto. IBP ignora el arco de entrega en la planificación.', 'Habilitar la combinación CUSTID+PRDID en Customer Product en IBP.'],
          ['Entrega no alcanzable desde produccion', 'yellow', ['all'], 'La entrega al cliente está configurada pero no existe ninguna ruta completa de producción que llegue hasta este arco. El cliente tiene arco de entrega pero sin fuente de abastecimiento conectada.', 'Revisar la red de distribución e identificar el arco faltante en Location Source que conecte la producción con esta ubicación de despacho.'],
          ['CLEADTIME missing', 'yellow', ['all'], 'El campo CLEADTIME no tiene valor definido. IBP usa 0 por defecto, planificando entregas instantáneas al cliente.', 'Ingresar el CLEADTIME real en días en el arco de Customer Source correspondiente en IBP.'],
          ['CLEADTIME zero', 'yellow', ['all'], 'El CLEADTIME está explícitamente definido como 0. IBP planifica entrega al cliente sin tiempo de tránsito.', 'Verificar si 0 días es intencional (entrega inmediata) o si falta ingresar el lead time real de entrega.'],
          ['Entrega alcanzable | Location Product y Customer Product configurados | CLEADTIME definido', 'ok', ['all'], 'El arco de entrega es alcanzable desde la producción, tiene lead time definido y ambos extremos están habilitados correctamente.', 'Sin acción requerida.']
        ]));
    }
  },

  /* ── ESTADÍSTICAS SN ── */
  {
    id: 'sn-stats', icon: '📈', title: 'Hoja: Estadísticas',
    content: function () {
      return p('Hoja de estadística descriptiva del dato maestro y de la red logística. No repite la hoja Resumen: aquí no hay veredictos de consistencia ni health score sino composición, distribución y cobertura. Se organiza en secciones apiladas, cada una con su propia mini-tabla.') +
        sub('Bloques que incluye', colTable([
          ['Cobertura en la red', 'Qué porcentaje del maestro de productos aparece en PSH, PSI, Location Source, Customer Source, Location Product y Customer Product, y cuántos no tienen actividad de red.'],
          ['Composición por LOCTYPE', 'Distribución de ubicaciones por tipo según el campo LOCTYPE.'],
          ['Presencia de ubicaciones en la red', 'Cuántas ubicaciones participan en producción, transferencias o entrega a cliente, y cuántas no tienen actividad.'],
          ['Conectividad', 'Ubicaciones origen y destino en Location Source, promedio de productos por origen y su distribución.'],
          ['Arcos de transferencia (Location Source)', 'Número de arcos, orígenes y destinos distintos, TLEADTIME promedio y destinos con múltiples orígenes (multi-sourcing).'],
          ['Distribución de TLEADTIME y CLEADTIME', 'Histograma de arcos por rango de lead time de transferencia y de entrega.'],
          ['Clientes (Customer Source)', 'Clientes en el maestro, con arco de entrega, número de arcos, CLEADTIME promedio y distribución de clientes por nº de productos.'],
          ['Cruces por campos adicionales', 'Por cada campo extra que agregues a Product, Location o Customer, una tabla cruzada contra el tipo (MATTYPEID o LOCTYPE) o de frecuencia.']
        ])) +
        callout('info', 'Las tablas de Cruces por campos adicionales se generan automáticamente para cada campo que selecciones en el paso Campos adicionales. Por ejemplo, agregar PLMSTATUS al Product produce el cruce Tipo de material por PLMSTATUS sin configuración extra.');
    }
  },

  /* ── TIPOS DE MATERIAL SN ── */
  {
    id: 'sn-mattypes', icon: '🏷️', title: 'Tipos de Material',
    content: function () {
      return p('La categorización de MATTYPEID afecta directamente qué hallazgos se generan y cuál es su severidad en la hoja Product del Network Analyzer. La misma ausencia de ruta a cliente puede ser ⛔ Alerta para un Terminado y no generar ningún hallazgo para un Semiterminado.') +
        sub('Impacto por categoría en Network Analyzer',
          '<div class="glos-table-wrap"><table class="glos-col-table"><thead><tr><th>Regla de análisis</th>' +
            '<th style="color:var(--accent)">Terminado</th>' +
            '<th style="color:var(--cyan)">Semiterminado</th>' +
            '<th style="color:var(--green)">Mat. Prima</th>' +
            '<th style="color:var(--purple)">Mercadería</th>' +
            '<th style="color:#9090c0">Sin cat.</th>' +
          '</tr></thead><tbody>' +
            '<tr><td>Necesita ruta completa a cliente</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td><td>⛔ Alerta</td></tr>' +
            '<tr><td>Ghost Nodes / Dead-ends</td><td>⛔ Detecta</td><td>No detecta</td><td>No detecta</td><td>⛔ Detecta</td><td>⛔ Detecta</td></tr>' +
            '<tr><td>Plantas aisladas</td><td>⛔ Detecta</td><td>No detecta</td><td>No detecta</td><td>⛔ Detecta</td><td>⛔ Detecta</td></tr>' +
            '<tr><td>PLEADTIME faltante</td><td>⛔ Alerta</td><td>⚠ Advertencia</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td></tr>' +
            '<tr><td>TLEADTIME faltante</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td></tr>' +
            '<tr><td>CLEADTIME faltante</td><td>⚠ Advertencia</td><td>No aplica</td><td>No aplica</td><td>⚠ Advertencia</td><td>⚠ Advertencia</td></tr>' +
            '<tr><td>Necesita PSH propio</td><td>⛔ Alerta</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td></tr>' +
            '<tr><td>Necesita consumo PSI en destino (semi)</td><td>No aplica</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td><td>No aplica</td></tr>' +
            '<tr><td>Necesita arco de abastecimiento</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td><td>No aplica</td><td>No aplica</td></tr>' +
            '<tr><td>Arcos LS + CS conectados</td><td>No aplica</td><td>No aplica</td><td>No aplica</td><td>⛔ Alerta</td><td>⚠ Advertencia</td></tr>' +
          '</tbody></table></div>'
        ) +
        callout('warn', '<strong>Tipo excluido:</strong> Los productos excluidos no generan filas en la hoja Product del Network Analyzer. Sin embargo, si son componentes PSI de productos incluidos, sus arcos de abastecimiento sí se validan en la hoja Product del producto consumidor.') +
        callout('info', '<strong>Sin categoría (uncategorized):</strong> Se ejecutan todas las validaciones disponibles — es el modo más completo, equivalente al de Terminado. El Estado de la Red se determina por lo que está presente en la data: si tiene PSH, se evalúa como Terminado; si tiene PSI sin PSH, como insumo. Cualquier anomalía detectada genera ⛔ Alerta igual que un Terminado. Se recomienda categorizar los materiales para obtener hallazgos precisos según el rol real del producto.');
    }
  }
];

export { PA_SECTIONS, SN_SECTIONS, section }
