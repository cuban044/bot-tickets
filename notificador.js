const express = require('express');
const bodyParser = require('body-parser');
const gruposPaises = require('./grupos-paises.json');
const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');
const { entregarProducto } = require('./licencias-manager');

// ===== CONFIGURACIÓN WHAPI CLOUD =====
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || 'hxHj5kNuZHLE6mnKYDoHDpSitqsWnF3N';
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_CHANNEL = process.env.WHAPI_CHANNEL || 'CAPTAM-UQNA6';
const WHAPI_ENABLED = !!WHAPI_TOKEN;

console.log(`🔧 WhAPI Cloud: ${WHAPI_ENABLED ? 'ACTIVADO' : 'DESACTIVADO'}`);
if (WHAPI_ENABLED) {
  console.log(`📡 WhAPI URL: ${WHAPI_BASE_URL}`);
}

// Importar WhatsApp cliente local como fallback (opcional)
let client = null;
let MessageMedia = null;
if (!WHAPI_ENABLED) {
  try {
    client = require('./index');
    const WhatsAppWebJS = require('whatsapp-web.js');
    MessageMedia = WhatsAppWebJS.MessageMedia;
    console.log('✅ WhatsApp Web.js cargado como fallback');
  } catch (error) {
    console.log('⚠️ WhatsApp Web.js no disponible - Solo modo WhAPI Cloud');
  }
}

// ===== FUNCIONES WHAPI CLOUD =====

// Función para formatear número para WhAPI Cloud
function formatearNumeroWhAPI(numero) {
  const numeroOriginal = numero.toString();
  
  // Si ya es un ID de grupo, devolverlo sin modificar
  if (numeroOriginal.endsWith('@g.us')) {
    return numeroOriginal;
  }
  
  // Si ya está formateado como contacto, devolverlo sin modificar
  if (numeroOriginal.endsWith('@c.us')) {
    return numeroOriginal;
  }
  
  // Limpiar el número (solo para números de teléfono)
  let numeroLimpio = numeroOriginal.replace(/[^\d]/g, '');
  
  // Si empieza con 52 (México) y tiene 12 dígitos, agregar 1
  if (numeroLimpio.startsWith('52') && numeroLimpio.length === 12) {
    numeroLimpio = '521' + numeroLimpio.slice(2);
  }
  
  // Agregar @c.us para números de teléfono
  numeroLimpio += '@c.us';
  
  return numeroLimpio;
}

// Función para enviar mensaje de texto con WhAPI Cloud
async function enviarMensajeWhAPI(numeroDestino, mensaje, maxIntentos = 3) {
  if (!WHAPI_ENABLED) {
    throw new Error('WhAPI Cloud no está configurado');
  }

  const numeroFormateado = formatearNumeroWhAPI(numeroDestino);
  
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      console.log(`📤 WhAPI - Enviando mensaje (intento ${intento}/${maxIntentos}) a ${numeroFormateado}`);
      
      const response = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: numeroFormateado,
          body: mensaje
        }),
        timeout: 30000
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ WhAPI - Mensaje enviado exitosamente:`, result.id);
      return true;

    } catch (error) {
      console.log(`❌ WhAPI - Error en intento ${intento}/${maxIntentos}: ${error.message}`);
      
      if (intento < maxIntentos) {
        const tiempoEspera = intento * 2000;
        console.log(`🔄 Reintentando en ${tiempoEspera/1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, tiempoEspera));
      } else {
        throw error;
      }
    }
  }
}

// Función para enviar imagen con WhAPI Cloud
async function enviarImagenWhAPI(numeroDestino, urlImagen, mensaje = '') {
  if (!WHAPI_ENABLED) {
    throw new Error('WhAPI Cloud no está configurado');
  }

  const numeroFormateado = formatearNumeroWhAPI(numeroDestino);
  
  try {
    console.log(`📤 WhAPI - Enviando imagen a ${numeroFormateado}`);
    
    const response = await fetch(`${WHAPI_BASE_URL}/messages/image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: numeroFormateado,
        media: urlImagen,
        caption: mensaje
      }),
      timeout: 45000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ WhAPI - Imagen enviada exitosamente:`, result.id);
    return true;

  } catch (error) {
    console.log(`❌ WhAPI - Error enviando imagen: ${error.message}`);
    // Fallback: enviar solo el mensaje de texto
    console.log(`📤 Fallback: enviando solo texto...`);
    return await enviarMensajeWhAPI(numeroDestino, mensaje);
  }
}

// ===== FIN FUNCIONES WHAPI CLOUD =====

// Función para verificar el estado del cliente de WhatsApp
async function verificarEstadoCliente() {
  try {
    if (!client) {
      return { conectado: false, estado: 'NOT_AVAILABLE' };
    }
    
    if (!client.pupPage) {
      return { conectado: false, estado: 'NO_PAGE' };
    }
    
    const estado = await client.getState();
    return { conectado: estado === 'CONNECTED', estado: estado };
  } catch (error) {
    return { conectado: false, estado: 'ERROR', error: error.message };
  }
}

// Función para intentar recuperar la conexión
async function intentarRecuperarConexion() {
  console.log('🔄 Intentando recuperar conexión de WhatsApp...');
  
  if (!client) {
    console.log('⚠️ Cliente de WhatsApp no disponible');
    return false;
  }
  
  try {
    if (client.pupPage) {
      await client.pupPage.reload();
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const estadoPost = await verificarEstadoCliente();
      if (estadoPost.conectado) {
        console.log('✅ Conexión recuperada exitosamente');
        return true;
      }
    }
    
    console.log('⚠️ No se pudo recuperar la conexión');
    return false;
  } catch (error) {
    console.error('❌ Error intentando recuperar conexión:', error.message);
    return false;
  }
}

// Función mejorada para enviar mensajes con manejo robusto de errores
async function enviarMensajeSeguro(numeroDestino, mensaje, maxIntentos = 3) {
  // Prioridad 1: Usar WhAPI Cloud si está configurado
  if (WHAPI_ENABLED) {
    try {
      return await enviarMensajeWhAPI(numeroDestino, mensaje, maxIntentos);
    } catch (error) {
      console.log(`❌ Error con WhAPI Cloud: ${error.message}`);
      // Si WhAPI falla, intentar con cliente local como fallback
      if (!client) {
        throw error;
      }
    }
  }
  
  // Prioridad 2: Usar cliente local como fallback
  if (!client) {
    console.log(`⚠️ WhatsApp no disponible - Sin WhAPI ni cliente local`);
    throw new Error('No hay método de envío disponible');
  }

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      console.log(`📤 Enviando mensaje (intento ${intento}/${maxIntentos}) a ${numeroDestino}`);
      
      // Verificar estado antes de enviar
      const estadoCliente = await verificarEstadoCliente();
      if (!estadoCliente.conectado) {
        console.log(`⚠️ Cliente no conectado (${estadoCliente.estado}), intentando recuperar...`);
        
        const recuperado = await intentarRecuperarConexion();
        if (!recuperado && intento < maxIntentos) {
          console.log(`🔄 Esperando 10 segundos antes del siguiente intento...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        } else if (!recuperado) {
          throw new Error('No se pudo recuperar la conexión de WhatsApp');
        }
      }
      
      // Enviar mensaje (solo si cliente local disponible)
      if (client) {
        await client.sendMessage(numeroDestino, mensaje);
        console.log(`✅ Mensaje enviado exitosamente (intento ${intento})`);
        return true;
      } else {
        throw new Error('Cliente local no disponible');
      }
      
    } catch (error) {
      console.log(`❌ Error en intento ${intento}/${maxIntentos}: ${error.message}`);
      
      // Si es error de contexto destruido, intentar reinicializar
      if (error.message.includes('Execution context was destroyed')) {
        console.log('🔄 Error de contexto destruido detectado, forzando restart...');
        setTimeout(() => {
          process.exit(1);
        }, 2000);
        return false;
      }
      
      if (intento < maxIntentos) {
        const tiempoEspera = intento * 5000; // Incrementar tiempo de espera
        console.log(`🔄 Reintentando en ${tiempoEspera/1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, tiempoEspera));
      } else {
        console.log(`❌ No se pudo enviar mensaje después de ${maxIntentos} intentos`);
        throw error;
      }
    }
  }
}

// Manejo global de errores no capturados específicos de puppeteer
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('Execution context was destroyed')) {
    console.error('❌ ERROR CRÍTICO: Contexto de ejecución destruido en notificador');
    console.log('🔄 Reiniciando sistema automáticamente...');
    setTimeout(() => {
      process.exit(1);
    }, 3000);
  }
});

const app = express();
app.use(bodyParser.json());

// Endpoint simple para verificar que Railway funciona
app.get('/ping', (req, res) => {
  console.log('🏓 Ping recibido');
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    whapi_enabled: WHAPI_ENABLED,
    client_available: !!client
  });
});

// Variable para almacenar los grupos detectados
let gruposDetectados = {};

// Variable para almacenar tickets pendientes
let ticketsPendientes = new Map();

// Variable para almacenar reportes recientes (anti-duplicados)
let reportesRecientes = new Map();

// Tiempo en minutos para considerar un reporte como duplicado
const TIEMPO_ANTI_DUPLICADO = 30;

// Variable para almacenar el grupo de diamantes
let grupoDiamantesGlobal = '120363421613700755@g.us'; // ID por defecto del grupo ENTREGA DIAMANTES

// Variable para almacenar solicitudes de licencia pendientes

// ===== FUNCIONES PARA MANEJO DE IMÁGENES =====

// Función para descargar imagen desde URL
async function descargarImagen(url, nombreArchivo) {
  try {
    console.log(`📥 Descargando imagen desde: ${url}`);
    
    const response = await fetch(url, { 
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    console.log(`📄 Tipo de contenido: ${contentType}`);
    
    // Verificar que sea una imagen
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`El archivo no es una imagen válida. Tipo: ${contentType}`);
    }
    
    const buffer = await response.buffer();
    const rutaCompleta = path.join(__dirname, 'temp', nombreArchivo);
    
    // Crear directorio temp si no existe
    const dirTemp = path.dirname(rutaCompleta);
    if (!fs.existsSync(dirTemp)) {
      fs.mkdirSync(dirTemp, { recursive: true });
      console.log(`📁 Directorio creado: ${dirTemp}`);
    }
    
    fs.writeFileSync(rutaCompleta, buffer);
    console.log(`✅ Imagen descargada: ${rutaCompleta} (${buffer.length} bytes)`);
    
    return {
      success: true,
      rutaArchivo: rutaCompleta,
      tamano: buffer.length,
      tipoContenido: contentType
    };
    
  } catch (error) {
    console.log(`❌ Error descargando imagen: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Función para limpiar archivo temporal
function limpiarArchivoTemporal(rutaArchivo) {
  try {
    if (fs.existsSync(rutaArchivo)) {
      fs.unlinkSync(rutaArchivo);
      console.log(`🗑️ Archivo temporal eliminado: ${rutaArchivo}`);
    }
  } catch (error) {
    console.log(`⚠️ Error eliminando archivo temporal: ${error.message}`);
  }
}

// Función para enviar mensaje con imagen adjunta
async function enviarMensajeConImagen(numeroDestino, mensaje, urlImagen, nombreImagen = 'comprobante.jpg') {
  // Prioridad 1: Usar WhAPI Cloud si está configurado
  if (WHAPI_ENABLED) {
    try {
      return await enviarImagenWhAPI(numeroDestino, urlImagen, mensaje);
    } catch (error) {
      console.log(`❌ Error enviando imagen con WhAPI: ${error.message}`);
      // Fallback: usar cliente local o enviar solo texto
    }
  }
  
  // Prioridad 2: Usar cliente local si está disponible
  if (!client || !MessageMedia) {
    console.log(`⚠️ Cliente local no disponible - Enviando solo texto`);
    return await enviarMensajeSeguro(numeroDestino, mensaje);
  }

  try {
    console.log(`📤 Enviando mensaje con imagen a: ${numeroDestino}`);
    
    // Descargar la imagen
    const resultadoDescarga = await descargarImagen(urlImagen, nombreImagen);
    
    if (!resultadoDescarga.success) {
      console.log(`⚠️ No se pudo descargar la imagen, enviando solo texto`);
      return await enviarMensajeSeguro(numeroDestino, mensaje);
    }
    
    // Crear MessageMedia desde el archivo descargado
    const media = MessageMedia.fromFilePath(resultadoDescarga.rutaArchivo);
    
    // Enviar mensaje con imagen (solo si cliente local disponible)
    if (client) {
      await client.sendMessage(numeroDestino, media, { caption: mensaje });
      console.log(`✅ Mensaje con imagen enviado exitosamente`);
    } else {
      throw new Error('Cliente local no disponible para envío de imagen');
    }
    
    // Limpiar archivo temporal después de enviarlo
    setTimeout(() => {
      limpiarArchivoTemporal(resultadoDescarga.rutaArchivo);
    }, 5000); // Esperar 5 segundos antes de eliminar
    
    return true;
    
  } catch (error) {
    console.log(`❌ Error enviando mensaje con imagen: ${error.message}`);
    console.log(`📤 Intentando enviar solo texto como fallback...`);
    
    // Fallback: enviar solo el mensaje de texto
    return await enviarMensajeSeguro(numeroDestino, mensaje);
  }
}

// ===== SISTEMA DE VENDEDORES ROTATIVOS =====
const VENDEDORES = [
  { nombre: 'Jose', telefono: '+58 416-7076994' },
  { nombre: 'Franz', telefono: '+591 76744561' },
  { nombre: 'Pablo', telefono: '+591 62656932' },
  { nombre: 'Luis', telefono: '+58 412-3939025' },
  { nombre: 'Ezequiel', telefono: '+57 301 7083834' }
];

const VENDEDORES_STATE_FILE = './vendedores-state.json';

// Función para cargar el estado de vendedores
function cargarEstadoVendedores() {
  try {
    if (fs.existsSync(VENDEDORES_STATE_FILE)) {
      const data = fs.readFileSync(VENDEDORES_STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('⚠️ Error cargando estado de vendedores, usando defaults:', error.message);
  }
  
  // Estado inicial
  return { 
    contadorVendedor: 0,
    ultimaVenta: null,
    totalVentas: 0
  };
}

// Función para guardar el estado de vendedores
function guardarEstadoVendedores(estado) {
  try {
    fs.writeFileSync(VENDEDORES_STATE_FILE, JSON.stringify(estado, null, 2));
  } catch (error) {
    console.error('❌ Error guardando estado de vendedores:', error.message);
  }
}

// Función para obtener el siguiente vendedor
function obtenerSiguienteVendedor() {
  const estado = cargarEstadoVendedores();
  
  // Seleccionar vendedor actual
  const vendedorAsignado = VENDEDORES[estado.contadorVendedor];
  
  // Incrementar contador para la próxima venta
  estado.contadorVendedor = (estado.contadorVendedor + 1) % VENDEDORES.length;
  estado.ultimaVenta = new Date().toISOString();
  estado.totalVentas += 1;
  
  // Guardar estado actualizado
  guardarEstadoVendedores(estado);
  
  console.log(`👤 Vendedor asignado: ${vendedorAsignado.nombre} (${vendedorAsignado.telefono})`);
  console.log(`📊 Total ventas asignadas: ${estado.totalVentas}`);
  
  return vendedorAsignado;
}

// ===== SISTEMA ANTI-DUPLICADOS =====

// Función para generar huella digital de un reporte
function generarHuellaReporte(numero, producto, comprobante) {
  // Limpiar número (solo dígitos)
  const numeroLimpio = numero ? numero.replace(/[^\d]/g, '') : '';
  
  // Crear huella digital única basada en información clave
  const huella = `${numeroLimpio}_${producto || ''}_${comprobante || ''}`.toLowerCase();
  
  console.log(`🔍 Huella generada: ${huella}`);
  return huella;
}

// Función para limpiar reportes antiguos (mayor a TIEMPO_ANTI_DUPLICADO minutos)
function limpiarReportesAntiguos() {
  const ahora = Date.now();
  const tiempoLimite = TIEMPO_ANTI_DUPLICADO * 60 * 1000; // Convertir a milisegundos
  
  let eliminados = 0;
  
  for (const [huella, datos] of reportesRecientes) {
    if (ahora - datos.timestamp > tiempoLimite) {
      reportesRecientes.delete(huella);
      eliminados++;
    }
  }
  
  if (eliminados > 0) {
    console.log(`🧹 Limpieza automática: ${eliminados} reportes antiguos eliminados`);
  }
}

// Función para verificar si un reporte es duplicado
function esDuplicado(numero, producto, comprobante) {
  // Limpiar reportes antiguos primero
  limpiarReportesAntiguos();
  
  const huella = generarHuellaReporte(numero, producto, comprobante);
  
  if (reportesRecientes.has(huella)) {
    const reporteAnterior = reportesRecientes.get(huella);
    const tiempoTranscurrido = Math.round((Date.now() - reporteAnterior.timestamp) / (60 * 1000));
    
    console.log(`🚫 DUPLICADO DETECTADO:`);
    console.log(`   📱 Número: ${numero}`);
    console.log(`   📦 Producto: ${producto}`);
    console.log(`   🧾 Comprobante: ${comprobante}`);
    console.log(`   ⏰ Último reporte: ${tiempoTranscurrido} minutos atrás`);
    console.log(`   🎫 Ticket anterior: #${reporteAnterior.ticketId}`);
    
    return {
      esDuplicado: true,
      tiempoTranscurrido: tiempoTranscurrido,
      ticketAnterior: reporteAnterior.ticketId
    };
  }
  
  return { esDuplicado: false };
}

// Función para registrar nuevo reporte
function registrarReporte(numero, producto, comprobante, ticketId) {
  const huella = generarHuellaReporte(numero, producto, comprobante);
  
  reportesRecientes.set(huella, {
    numero: numero,
    producto: producto,
    comprobante: comprobante,
    ticketId: ticketId,
    timestamp: Date.now()
  });
  
  console.log(`📝 Reporte registrado en anti-duplicados: Ticket #${ticketId}`);
}

// Función para notificar al vendedor asignado
async function notificarVendedor(vendedor, cliente, producto, licencia, monto) {
  try {
    // Limpiar número de teléfono del vendedor
    let numeroVendedor = vendedor.telefono.replace(/[+\s-]/g, '');
    
    // Agregar código de país si es necesario para WhatsApp
    if (numeroVendedor.startsWith('58') && numeroVendedor.length === 11) {
      // Venezuela: 58 4xx xxx xxxx → mantener como está
    } else if (numeroVendedor.startsWith('591') && numeroVendedor.length === 11) {
      // Bolivia: 591 7x xxx xxx → mantener como está  
    } else if (numeroVendedor.startsWith('57') && numeroVendedor.length === 12) {
      // Colombia: 57 3xx xxx xxxx → mantener como está
    }
    
    const mensajeVendedor = `🎯 *NUEVA VENTA ASIGNADA* 🎯

👤 *Vendedor:* ${vendedor.nombre}
📱 *Cliente:* ${cliente}
📦 *Producto:* ${producto}
🔑 *Licencia:* \`${licencia}\`
${monto ? `💰 *Monto:* $${monto}` : ''}

✅ *Venta procesada y entregada automáticamente*
📋 Cliente ya recibió su producto y tutorial
🚀 ¡Felicidades por la venta!

🌐 *Sistema Cuban Hacks*`;

    console.log(`📤 Notificando a vendedor ${vendedor.nombre}: ${numeroVendedor}@c.us`);
    
    // Enviar mensaje al vendedor con reintentos
    const enviarAVendedor = async (maxIntentos = 2) => {
      for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
          await enviarMensajeSeguro(`${numeroVendedor}@c.us`, mensajeVendedor, 2);
          console.log(`✅ Vendedor ${vendedor.nombre} notificado exitosamente (intento ${intento})`);
          return true;
        } catch (error) {
          console.log(`❌ Error notificando vendedor ${vendedor.nombre} (intento ${intento}/${maxIntentos}): ${error.message}`);
          if (intento < maxIntentos) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      console.log(`❌ No se pudo notificar a vendedor ${vendedor.nombre} después de ${maxIntentos} intentos`);
      return false;
    };
    
    await enviarAVendedor();
    
  } catch (error) {
    console.error(`❌ Error en notificación a vendedor ${vendedor.nombre}:`, error.message);
  }
}

// ===== FIN SISTEMA DE VENDEDORES ROTATIVOS =====

// Función para detectar y configurar grupos automáticamente
async function detectarGrupos() {
  try {
    console.log('🔍 Verificando estado de WhatsApp antes de detectar grupos...');
    
    // Verificar si el cliente existe (no disponible en Railway)
    if (!client) {
      console.log('⚠️ Cliente de WhatsApp no disponible (normal en Railway)');
      return [];
    }
    
    // Verificar si el cliente está inicializado
    if (!client.pupPage) {
      console.log('⚠️ Cliente de WhatsApp no está inicializado');
      return [];
    }
    
    // Verificar estado de conexión
    const estadoCliente = await verificarEstadoCliente();
    if (!estadoCliente.conectado) {
      console.log(`⚠️ WhatsApp no está conectado (${estadoCliente.estado})`);
      console.log('🔄 Intentando recuperar conexión...');
      
      const recuperado = await intentarRecuperarConexion();
      if (!recuperado) {
        console.log('❌ No se pudo recuperar la conexión de WhatsApp');
        return [];
      }
    }
    
    console.log('🔍 Detectando grupos de WhatsApp...');
    
    if (!client) {
      console.log('⚠️ Cliente no disponible para obtener chats');
      return [];
    }
    
    const chats = await client.getChats();
    
    if (!chats || !Array.isArray(chats)) {
      console.log('⚠️ No se pudieron obtener los chats de WhatsApp');
      return [];
    }
    
    const grupos = chats.filter(chat => chat && chat.isGroup);
    
    console.log(`\n📋 ${grupos.length} grupos detectados:`);
    grupos.forEach((group, index) => {
      if (group && group.name && group.id && group.id._serialized) {
      console.log(`${index + 1}. ${group.name} — ID: ${group.id._serialized}`);
      gruposDetectados[group.name] = group.id._serialized;
      } else {
        console.log(`${index + 1}. [Grupo sin nombre o ID inválido]`);
      }
    });
    
    // Actualizar configuración con grupos detectados
    if (grupos.length > 0) {
    actualizarConfiguracionGrupos(grupos);
      console.log('✅ Configuración de grupos actualizada exitosamente');
    } else {
      console.log('⚠️ No se encontraron grupos para configurar');
    }
    
    return grupos;
  } catch (error) {
    console.error('❌ Error detectando grupos:', error.message);
    
    // Si es error de contexto destruido, sugerir reinicio
    if (error.message.includes('Execution context was destroyed')) {
      console.log('🔄 Se detectó desconexión de WhatsApp. Considera reiniciar el sistema.');
    }
    
    return [];
  }
}

// Función para actualizar la configuración de grupos
function actualizarConfiguracionGrupos(grupos) {
  const configActualizada = { ...gruposPaises };
  
  // Mapear grupos por nombre (SOLO grupos de tickets)
  const mapeoGrupos = {
    'México': ['mexico tickets', 'mexico tickets ✅️'],
    'Colombia': ['colombia tickets', 'colombia tickets✅'],
    'Perú': ['perú tickets', 'peru tickets', 'perú tickets ✅️', 'peru tickets ✅️'],
    'Chile': ['chile tickets', 'chile tickets ✅️'],
    'República Dominicana': ['república d. tickets', 'republica d. tickets', 'república d. tickets ✅️', 'republica d. tickets ✅️'],
    'Estados Unidos': ['zelle tickets', 'zelle tickets ✅️', 'zelle tickets ✅️ (leodan)'],
    'Bolivia': ['bolivia tickets', 'bolivia tickets ( yape ) ✅', 'bolivia tickets ✅'],
    'Argentina': ['argentina tickets', 'argentina tickets ✅️'],
    'Venezuela': ['venezuela tickets', 'venezuela tickets ✅'],
    'Ecuador': ['ecuador tickets', 'ecuador tickets✅'],
    'Nicaragua': ['nicaragua tickets', 'nicaragua tickets ✅️'],
    'El Salvador': ['el salvador tickets', 'el salvador tickets ✅️'],
    'Honduras': ['honduras tickets', 'honduras tickets ✅️'],
    'Guatemala': ['guatemala tickets', 'guatemala tickets ✅️'],
    'Costa Rica': ['costa rica tickets', 'costa rica tickets✅️'],
    'Panamá': ['panamá tickets', 'panama tickets', 'panamá tickets ✅', 'panama tickets ✅']
  };
  
  // Variable global para el grupo de diamantes
  let grupoDiamantesId = null;
  
  grupos.forEach(grupo => {
    if (!grupo.name) {
      console.log(`⚠️ Grupo sin nombre encontrado, saltando...`);
      return;
    }
    const nombreGrupo = grupo.name.toLowerCase();
    
    // Buscar coincidencias exactas en el mapeo
    for (const [pais, keywords] of Object.entries(mapeoGrupos)) {
      if (keywords.some(keyword => nombreGrupo === keyword)) {
        // Encontrar el prefijo correspondiente al país
        const prefijo = Object.keys(configActualizada.grupos).find(pref => 
          configActualizada.grupos[pref].nombre === pais
        );
        
        if (prefijo && grupo.id && grupo.id._serialized) {
          configActualizada.grupos[prefijo].grupo_id = grupo.id._serialized;
          console.log(`✅ Grupo "${grupo.name}" asignado a ${pais} (prefijo ${prefijo})`);
        }
      }
    }
    
    // Detectar grupo de diamantes (solo ENTREGA DIAMANTES)
    if (nombreGrupo === 'entrega diamantes' || nombreGrupo === 'entregadiamantes') {
      if (grupo.id && grupo.id._serialized) {
        grupoDiamantesId = grupo.id._serialized;
        grupoDiamantesGlobal = grupo.id._serialized; // Actualizar variable global
        console.log(`💎 Grupo ENTREGA DIAMANTES detectado: "${grupo.name}" (ID: ${grupoDiamantesId})`);
      }
    }
  });
  
  // Guardar configuración actualizada
  try {
    fs.writeFileSync('grupos-paises.json', JSON.stringify(configActualizada, null, 2));
    console.log('💾 Configuración de grupos actualizada');
  } catch (error) {
    console.error('❌ Error guardando configuración:', error);
  }
}

// Función para obtener el prefijo del país basado en el número
function obtenerPrefijoPais(numero) {
  const numeroLimpio = numero.replace(/\D/g, '');
  
  // Verificar prefijos de 4 dígitos primero
  if (numeroLimpio.startsWith('1809')) return '1809'; // República Dominicana
  if (numeroLimpio.startsWith('1829')) return '1829'; // República Dominicana
  if (numeroLimpio.startsWith('1849')) return '1849'; // República Dominicana
  
  // Verificar prefijos de 3 dígitos
  if (numeroLimpio.startsWith('593')) return '593'; // Ecuador
  if (numeroLimpio.startsWith('591')) return '591'; // Bolivia
  if (numeroLimpio.startsWith('595')) return '595'; // Paraguay
  if (numeroLimpio.startsWith('598')) return '598'; // Uruguay
  if (numeroLimpio.startsWith('502')) return '502'; // Guatemala
  if (numeroLimpio.startsWith('503')) return '503'; // El Salvador
  if (numeroLimpio.startsWith('504')) return '504'; // Honduras
  if (numeroLimpio.startsWith('505')) return '505'; // Nicaragua
  if (numeroLimpio.startsWith('506')) return '506'; // Costa Rica
  if (numeroLimpio.startsWith('507')) return '507'; // Panamá
  
  // Verificar prefijos de 2 dígitos
  if (numeroLimpio.startsWith('52')) return '52'; // México
  if (numeroLimpio.startsWith('57')) return '57'; // Colombia
  if (numeroLimpio.startsWith('54')) return '54'; // Argentina
  if (numeroLimpio.startsWith('58')) return '58'; // Venezuela
  if (numeroLimpio.startsWith('51')) return '51'; // Perú
  if (numeroLimpio.startsWith('56')) return '56'; // Chile
  
  // Verificar prefijos de 1 dígito
  if (numeroLimpio.startsWith('1')) return '1'; // Estados Unidos
  
  return 'default'; // Para otros países
}

// Función para obtener información del grupo por país
function obtenerGrupoPais(prefijo) {
  return gruposPaises.grupos[prefijo] || gruposPaises.grupos.default;
}

// Función para generar ID único del ticket
function generarTicketId() {
  return Math.floor(Math.random() * 900) + 100; // Número de 3 dígitos
}

// FUNCIÓN OBSOLETA ELIMINADA - USAR obtenerTutorialAlias() DEL SISTEMA AVANZADO DE TUTORIALES

// Función para convertir nombre del producto a su variable
function convertirProductoAVariable(nombreProducto, duracionTicket = null) {
  const productoLower = nombreProducto.toLowerCase();
  
  // Extraer duración del producto (formato "XD" como "7D", "15D", "30D")
  const extraerDuracion = (nombre) => {
    // Limpiar espacios extra y tabs
    const nombreLimpio = nombre.replace(/\s+/g, ' ').trim();
    
    // Buscar patrones como "7D", "15D", "30D", etc.
    const match = nombreLimpio.match(/(\d+)D/);
    if (match) return match[1];
    
    // Buscar "Permanente" o "Certificado"
    if (nombreLimpio.includes('permanente') || nombreLimpio.includes('certificado')) return 'perma';
    
    return null;
  };
  
  // Usar duración del ticket si está disponible, sino extraer del nombre
  const duracion = duracionTicket || extraerDuracion(productoLower);
  console.log(`🔄 Convirtiendo producto: "${nombreProducto}" - Duración del ticket: ${duracionTicket} - Duración detectada: ${duracion}`);
  
  // Mapeo de nombres exactos a variables
  if (productoLower.includes('cuban vip mod')) {
    if (duracion === '7') return 'cubanvip7';
    if (duracion === '15') return 'cubanvip15';
    if (duracion === '30') return 'cubanvip30';
    // Si no hay duración específica, usar 7D (la más baja)
    if (!duracion) return 'cubanvip7';
  }
  
  if (productoLower.includes('drip client dll aimbot')) {
    if (duracion === '1') return 'dripdll1';
    if (duracion === '15') return 'dripdll15';
    if (duracion === '30') return 'dripdll30';
    if (!duracion) return 'dripdll1';
  }
  
  if (productoLower.includes('cuban cod mobile')) {
    if (duracion === '1') return 'dripmobile1D';
    if (duracion === '15') return 'dripmobile15D';
    if (duracion === '30') return 'dripmobile30D';
    if (!duracion) return 'dripmobile1D';
  }
  
  if (productoLower.includes('cuban autokill')) {
    if (duracion === '10') return 'autokill';
    if (duracion === '20') return 'autokill20D';
    if (duracion === 'perma') return 'autokillperma';
  }
  
  if (productoLower.includes('cuban disimulado')) {
    if (duracion === '10') return 'disimulado';
    if (duracion === '20') return 'disimulado20D';
    if (duracion === 'perma') return 'disimuladoperma';
  }
  
  if (productoLower.includes('flourite free fire')) {
    if (duracion === '1') return 'flourite1D';
    if (duracion === '7') return 'flourite7D';
    if (duracion === '30') return 'flourite30D';
  }
  
  if (productoLower.includes('drip client aimkill')) {
    if (duracion === '1') return 'dripaimkill1';
    if (duracion === '5') return 'dripaimkill5';
    if (duracion === '7') return 'dripaimkill7';
  }
  
  if (productoLower.includes('cuban 8 ball pool')) {
    if (duracion === '1') return 'cuban8bp1';
    if (duracion === '7') return 'cuban8bp7';
    if (duracion === '30') return 'cuban8bp30';
  }
  
  if (productoLower.includes('easy victory')) {
    if (duracion === '7') return 'easyvictory7';
    if (duracion === '30') return 'easyvictory30';
  }
  
  if (productoLower.includes('cuban delta force')) {
    if (duracion === '30') return 'cubandelta30D';
  }
  
  if (productoLower.includes('cuban mobile legend')) {
    if (duracion === '30') return 'cubanmobile30D';
  }
  
  if (productoLower.includes('cuban black')) {
    if (duracion === '10') return 'cubanblack10D';
    if (duracion === '20') return 'cubanblack20D';
    if (duracion === 'perma') return 'cubanblackperma';
  }
  
  if (productoLower.includes('cuban no root') || productoLower === 'noroot') {
    console.log('✅ Encontrado Cuban No Root');
    if (duracion === '10' || duracion === '10D') return 'noroot';
    if (duracion === '20' || duracion === '20D') return 'noroot20D';
    if (duracion === 'perma') return 'norootperma';
    if (!duracion) return 'noroot';
  }
  
  if (productoLower === 'dripmobile') {
    if (duracion === '1') return 'dripmobile1D';
    if (duracion === '15') return 'dripmobile15D';
    if (duracion === '30') return 'dripmobile30D';
    // Si no hay duración específica, usar 1D (la más baja)
    if (!duracion) return 'dripmobile1D';
  }
  
  if (productoLower === 'brsilent' || productoLower.includes('br mods silent')) {
    if (duracion === '1') return 'brmods1D';
    if (duracion === '10') return 'brmods10D';
    if (duracion === '30') return 'brmods30D';
    if (!duracion) return 'brmods1D';
  }
  
  if (productoLower === 'brbypass' || productoLower.includes('br mods bypass emulador')) {
    if (duracion === '1') return 'brbypass1D';
    if (duracion === '10') return 'brbypass10D';
    if (duracion === '30') return 'brbypass30D';
    if (!duracion) return 'brbypass1D';
  }
  
  if (productoLower === 'cubanpanel' || productoLower.includes('cuban panel')) {
    if (duracion === '1') return 'cubanpanel1D';
    if (duracion === '7') return 'cubanpanel7D';
    if (duracion === '30') return 'cubanpanel30D';
    if (!duracion) return 'cubanpanel1D';
  }
  
  if (productoLower === 'cubanios') {
    if (duracion === '30') return 'cubanios30D';
    if (duracion === 'perma' || duracion === 'certificado') return 'cubanioscertificado';
    // Si no hay duración específica, usar 30D
    if (!duracion) return 'cubanios30D';
  }
  
  if (productoLower === 'diamantes') {
    return 'diamantes'; // Producto especial, no necesita duración
  }
  
  if (productoLower.includes('drip silent')) {
    if (duracion === '1') return 'dripsilent1';
    if (duracion === '10') return 'dripsilent10';
    if (duracion === '30') return 'dripsilent30';
    if (!duracion) return 'dripsilent1';
  }
  
  // Casos especiales para productos sin duración
  if (productoLower === 'dripmobile') {
    return 'dripmobile1D'; // Usar 1D (la más baja)
  }
  
  if (productoLower === 'cuban vip mod') {
    return 'cubanvip7'; // Usar 7D (la más baja)
  }
  
  console.log(`⚠️ No se pudo convertir producto: "${nombreProducto}" - Usando nombre original`);
  return nombreProducto; // Usar nombre original si no se puede convertir
}

// ===== SISTEMA AVANZADO DE TUTORIALES =====
// Basado en la lógica de get_product_data.php

// Función para verificar qué va a entregar un producto (sin entregar)
function verificarEntregaProducto(nombreProducto) {
  console.log(`\n🔍 ========== VERIFICACIÓN DE ENTREGA ==========`);
  console.log(`📦 Producto: ${nombreProducto}`);
  
  // Obtener tutorial alias
  const tutorialAlias = obtenerTutorialAlias(nombreProducto);
  console.log(`🎯 Tutorial Alias: ${tutorialAlias}`);
  
  // Generar URL de tutorial
  const tutorialUrl = generarUrlTutorial(tutorialAlias);
  console.log(`🔗 Tutorial URL: ${tutorialUrl}`);
  
  // Verificar si está mapeado
  const estaMapeado = tutorialAlias !== 'general';
  console.log(`📋 Estado: ${estaMapeado ? '✅ MAPEADO' : '❌ NO MAPEADO (usando general)'}`);
  
  console.log(`\n📱 ========== MENSAJE QUE SE ENVIARÍA ==========`);
  
  // Simular mensaje que se enviaría (sin vendedor)
  const mensajeSimulado = crearMensajeTutorialMejorado(nombreProducto, 'LICENCIA_SIMULADA', null);
  console.log(mensajeSimulado);
  
  console.log(`\n✅ ========== VERIFICACIÓN COMPLETADA ==========\n`);
  
  return {
    producto: nombreProducto,
    tutorialAlias: tutorialAlias,
    tutorialUrl: tutorialUrl,
    estaMapeado: estaMapeado,
    mensaje: mensajeSimulado
  };
}

// Función para auditoría completa de todos los productos activos
function auditoriaTodosLosProductos() {
  console.log(`\n🧪 ========== AUDITORÍA COMPLETA DE PRODUCTOS ==========`);
  console.log(`📊 Verificando TODOS los productos y duraciones activos...\n`);

  // Lista completa de productos REALES activos con todas las duraciones (basada en Manyfinal - Manyultimo.tsv)
  const todosLosProductos = [
    // Cuban VIP Mod - Todas las duraciones
    'Cuban VIP Mod 7 Dias',
    'Cuban VIP Mod 15 Dias',
    'Cuban VIP Mod 30 Dias',
    
    // Drip Client DLL Aimbot - Todas las duraciones
    'Drip Client DLL Aimbot 1 Dia',
    'Drip Client DLL Aimbot 15 Dias',
    'Drip Client DLL Aimbot 30 Dias',
    
    // Cuban CoD Mobile - Todas las duraciones
    'Cuban CoD Mobile 7 Dias',
    'Cuban CoD Mobile 30 Dias',
    
    // Cuban Autokill - Todas las duraciones
    'Cuban Autokill 10 Dias',
    'Cuban Autokill 22 Dias',
    'Cuban Autokill Permanente',
    
    // Cuban Disimulado - Todas las duraciones
    'Cuban Disimulado 10 Dias',
    'Cuban Disimulado 20 Dias',
    'Cuban Disimulado Permanente',
    
    // Flourite Free Fire - Todas las duraciones
    'Flourite Free Fire 1 Dia',
    'Flourite Free Fire 7 Dias',
    'Flourite Free Fire 30 Dias',
    
    // Cuban 8 Ball Pool - Todas las duraciones
    'Cuban 8 Ball Pool 1 Dia',
    'Cuban 8 Ball Pool 7 Dias',
    'Cuban 8 Ball Pool 30 Dias',
    
    // Easy Victory Premium - Todas las duraciones
    'Easy Victory Premium 7 Dias',
    'Easy Victory Premium 30 Dias',
    
    // Cuban Delta Force
    'Cuban Delta Force 30 Dias',
    
    // Cuban Mobile Legend
    'Cuban Mobile Legend 30 Dias',
    
    // cuban black - Todas las duraciones
    'cuban black 10 Dias',
    'cuban black 20 Dias',
    'cuban black Permanente',
    
    // Productos especiales
    'socio',
    'Producto Socio',
    
    // Drip Silent - Todas las duraciones  
    'Drip Silent 1 Dia',
    'Drip Silent 10 Dias',
    'Drip Silent 30 Dias',
    
    // Drip AimKill - Todas las duraciones
    'Drip Aimkill 1 Dia',
    'Drip Aimkill 5 Dias', 
    'Drip Aimkill 7 Dias',
    
    // BR Mods - Todas las duraciones
    'BR MODS SILENT - 1 DIA',
    'BR MODS SILENT - 30 DIAS',
    
    // BR Bypass - Todas las duraciones
    'BR MODS BYPASS- AIMBOT 1 DIA',
    'BR MOD BYPASS-SILENT - 10 DIAS',
    'BR MODS BYPASS- AIMBOT 30 DIAS'
  ];

  const resultados = [];
  let mapeados = 0;
  let noMapeados = 0;
  
  for (const producto of todosLosProductos) {
    const tutorialAlias = obtenerTutorialAlias(producto);
    const tutorialUrl = generarUrlTutorial(tutorialAlias);
    const estaMapeado = tutorialAlias !== 'general';
    
    if (estaMapeado) {
      mapeados++;
      console.log(`✅ ${producto} → ${tutorialAlias}`);
    } else {
      noMapeados++;
      console.log(`❌ ${producto} → general (NO MAPEADO)`);
    }
    
    resultados.push({
      producto: producto,
      tutorialAlias: tutorialAlias,
      tutorialUrl: tutorialUrl,
      estaMapeado: estaMapeado
    });
  }

  // Resumen final
  console.log(`\n📋 ========== RESUMEN DE AUDITORÍA ==========`);
  console.log(`📊 Total de productos: ${todosLosProductos.length}`);
  console.log(`✅ Productos mapeados: ${mapeados}`);
  console.log(`❌ Productos NO mapeados: ${noMapeados}`);
  console.log(`📈 Porcentaje de mapeo: ${Math.round((mapeados/todosLosProductos.length)*100)}%`);
  
  if (noMapeados > 0) {
    console.log(`\n⚠️ PRODUCTOS QUE NECESITAN MAPEO:`);
    resultados.filter(r => !r.estaMapeado).forEach(r => {
      console.log(`   - ${r.producto}`);
    });
  }
  
  console.log(`\n🎯 ========== AUDITORÍA COMPLETADA ==========\n`);
  
  return {
    total: todosLosProductos.length,
    mapeados: mapeados,
    noMapeados: noMapeados,
    porcentaje: Math.round((mapeados/todosLosProductos.length)*100),
    resultados: resultados,
    productosProblema: resultados.filter(r => !r.estaMapeado)
  };
}

// Función para mapear nombre de producto de la BD a tutorial_alias
function obtenerTutorialAlias(nombreProductoDB) {
  const tutorialMapping = {
    // Cuban VIP Mod - NOMBRES EXACTOS DE MANYCHAT
    'Cuban VIP Mod 7 Dias': 'cuban_vip',
    'Cuban VIP Mod 15 Dias': 'cuban_vip', 
    'Cuban VIP Mod 30 Dias': 'cuban_vip',
    
    // Drip Client DLL Aimbot - NOMBRES EXACTOS DE MANYCHAT
    'Drip Client DLL Aimbot 1 Dia': 'drip_dll',
    'Drip Client DLL Aimbot 15 Dias': 'drip_dll',
    'Drip Client DLL Aimbot 30 Dias': 'drip_dll',
    
    // Cuban CoD Mobile - NOMBRES EXACTOS DE MANYCHAT
    'Cuban CoD Mobile 7 Dias': 'cuban_cod_mobile',
    'Cuban CoD Mobile 30 Dias': 'cuban_cod_mobile',
    
    // Cuban Autokill - NOMBRES EXACTOS DE MANYCHAT
    'Cuban Autokill 10 Dias': 'cuban_autokill',
    'Cuban Autokill 22 Dias': 'cuban_autokill',
    'Cuban Autokill Permanente': 'cuban_autokill',
    
    // Cuban Disimulado - NOMBRES EXACTOS DE MANYCHAT
    'Cuban Disimulado 10 Dias': 'cuban_disimulado',
    'Cuban Disimulado 20 Dias': 'cuban_disimulado',
    'Cuban Disimulado Permanente': 'cuban_disimulado',
    
    // Cuban Panel PC
    'CUBAN PANEL PC 1 DIA': 'cuban_panel_pc',
    'CUBAN PANEL PC 7 DIAS': 'cuban_panel_pc',
    'CUBAN PANEL PC 30 DIAS': 'cuban_panel_pc',
    'CUBAN PANEL PC PERMA': 'cuban_panel_pc',
    
    // Cuban Panel iOS
    'Cuban Panel iOS 7 Dias': 'cubanios_tutorial',
    'Cuban Panel Ios 15 Dias': 'cubanios_tutorial',
    'Cuban Panel IOs 30 Dias': 'cubanios_tutorial',
    'Cuban Panel Ios certificado': 'cubanios_tutorial',
    
    // Flourite Free Fire - NOMBRES EXACTOS DE MANYCHAT
    'Flourite Free Fire 1 Dia': 'flourite_ff',
    'Flourite Free Fire 7 Dias': 'flourite_ff',
    'Flourite Free Fire 30 Dias': 'flourite_ff',
    
    // Cuban 8 Ball Pool - NOMBRES EXACTOS DE MANYCHAT
    'Cuban 8 Ball Pool 1 Dia': 'cuban_8bp',
    'Cuban 8 Ball Pool 7 Dias': 'cuban_8bp',
    'Cuban 8 Ball Pool 30 Dias': 'cuban_8bp',
    
    // Easy Victory Premium - NOMBRES EXACTOS DE MANYCHAT
    'Easy Victory Premium 7 Dias': 'easy_victory',
    'Easy Victory Premium 30 Dias': 'easy_victory',
    
    // Cuban Delta Force - NOMBRES EXACTOS DE MANYCHAT
    'Cuban Delta Force 30 Dias': 'cuban_delta_force',
    
    // Cuban Mobile Legend - NOMBRES EXACTOS DE MANYCHAT
    'Cuban Mobile Legend 30 Dias': 'cuban_mobile_legend',
    
    // cuban black - NOMBRES EXACTOS DE MANYCHAT (con minúscula)
    'cuban black 10 Dias': 'cuban_black',
    'cuban black 20 Dias': 'cuban_black',
    'cuban black Permanente': 'cuban_black',
    
    // Drip Silent - NOMBRES EXACTOS DE MANYCHAT
    'Drip Silent 1 Dia': 'drip_silent',
    'Drip Silent 10 Dias': 'drip_silent',
    'Drip Silent 30 Dias': 'drip_silent',
    
    // Drip AimKill - NOMBRES EXACTOS DE MANYCHAT
    'Drip Aimkill 1 Dia': 'drip_aimkill',
    'Drip Aimkill 5 Dias': 'drip_aimkill',
    'Drip Aimkill 7 Dias': 'drip_aimkill',
    
    // BR Mods - NOMBRES EXACTOS DE MANYCHAT
    'BR MODS SILENT - 1 DIA': 'br_mods',
    'BR MODS SILENT - 30 DIAS': 'br_mods',
    
    // BR Bypass - NOMBRES EXACTOS DE MANYCHAT  
    'BR MODS BYPASS- AIMBOT 1 DIA': 'br_bypass',
    'BR MOD BYPASS-SILENT - 10 DIAS': 'br_bypass',
    'BR MODS BYPASS- AIMBOT 30 DIAS': 'br_bypass',
    
    // Otros productos con hack
    'Cuban DIsimulado 10 Dias': 'cuban_disimulado',
    'Cuban DIsimulado 20 Dias': 'cuban_disimulado',
    'Cuban DIsimulado Permanente': 'cuban_disimulado',
    'Cuban Auto Kill 10 DIas': 'cuban_autokill',
    'Cuban Auto Kill 12 DIas': 'cuban_autokill',
    'Cuban Auto Kill 22 DIas': 'cuban_autokill',
    'Cuban Auto Kill Permanente': 'cuban_autokill',
    'Cuban Black Mod 10 Dias': 'cuban_black',
    'Cuban Black Mod 12 Dias': 'cuban_black',
    'Cuban Black Mod 20 Dias': 'cuban_black',
    'Cuban Black Mod Permanente': 'cuban_black',
    'Cuban Delta Force 30 Dias': 'cuban_delta_force',
    'Cuban Mobile Legend 30 Dias': 'cuban_mobile_legend',
    'Easy Victory Premium 7 Dias': 'easy_victory',
    'Easy Victory Premium 30 Dias': 'easy_victory',
    'CoD Mobile IOS - 7 Dias': 'cod_ios',
    'Cod Mobile IOS- 30 DIas': 'cod_ios',
    'Flourite Mobile Legends - 30 Dias': 'flourite_ml',
    'Hack Diversion IOS - 1 Mes': 'cuban_diversion',
    'Flourite iOS': 'flourite_ios',
    'Easy Victory 8 ball pool': 'easy_victory',
    
    // Servicios/Cuentas - tutorial general de entrega
    'Netflix Premium 1 Mes': 'streaming_general',
    'Spotify Premium 1 Mes': 'streaming_general',
    'Paramount Plus  1 Mes': 'streaming_general',
    'Only Fans Hackeado  1 Mes': 'onlyfans_tutorial',
    'Only Fans Hackeado Permanente': 'onlyfans_tutorial',
    'Panel De Seguidores': 'panel_tutorial',
    'Certificado Gbox 1 Año': 'gbox_tutorial',
    
    // Servicios redes sociales - tutorial de uso
    'Seguidores Tik TOk': 'redes_sociales',
    'Vistas Tik TOk': 'redes_sociales',
    'Likes Tik Tok': 'redes_sociales',
    'Seguidores Instagram': 'redes_sociales',
    'Likes Instagram': 'redes_sociales',
    'Vistas Instagram': 'redes_sociales',
    'Miembros Para Canal Telegram': 'redes_sociales',
    'Espectadores Para Live - Duran 4 Horas': 'redes_sociales',
    'Miembros Para Canal Whatssap': 'redes_sociales'
  };
  
  return tutorialMapping[nombreProductoDB] || 'general';
}

// Función para generar URL de tutorial con slug correcto
function generarUrlTutorial(tutorialAlias) {
  const tutorialSlugs = {
    'cuban_no_root': 'cuban-mod-no-root-version-aimkill-speed',
    'cuban_panel_ios': 'cuban-panel-ios',
    'cuban_diversion': 'cuban-diversion',
    'flourite_ios': 'flourite-ios',
    'cod_ios': 'cuban-cod-mobile-30',
    'cuban_cod_mobile': 'cuban-cod-mobile-30',
    'flourite_ml': 'flourite-ml',
    'drip_mobile': 'drip-mobile-30',
    'cuban_panel_pc': 'cuban-panel-pc',
    'br_mods': 'br-mods',
    'cuban_autokill': 'cuban-autokill',
    'cuban_black': 'cuban-black',
    'gbox_tutorial': 'gbox-tutorial',
    'cuban_disimulado': 'cuban-disimulado',
    'cuban_vip': 'cuban-vip',
    'cuban_vip_basic': 'cuban-vip-basic',
    'cuban_8bp': 'cuban-8bp',
    'easy_victory': 'easy-victory',
    'drip_aimkill': 'drip-aimkill',
    'drip_silent': 'drip-silent',
    'cuban_delta_force': 'cuban-delta-force',
    'cuban_mobile_legend': 'cuban-mobile-legend',
    'cubanios_tutorial': 'cubanios-tutorial',
    'br_bypass': 'br-bypass',
    'drip_dll': 'drip-dll',
    'flourite_ff': 'flourite-ff',
    'streaming_general': 'streaming-general',
    'onlyfans_tutorial': 'onlyfans-tutorial',
    'panel_tutorial': 'panel-seguidores',
    'redes_sociales': 'redes-sociales',
    'general': 'general'
  };
  
  const slug = tutorialSlugs[tutorialAlias] || tutorialSlugs['general'];
  return `https://cubanhacks.com/tutoriales.php?category=${slug}`;
}

// Función para crear mensaje de tutorial mejorado
function crearMensajeTutorialMejorado(nombreProductoDB, licencia, vendedorAsignado = null) {
  const tutorialAlias = obtenerTutorialAlias(nombreProductoDB);
  const tutorialUrl = generarUrlTutorial(tutorialAlias);
  
  let mensaje = `🎉 *PAGO APROBADO* 🎉

✅ Tu pago ha sido verificado y aprobado
📦 Producto: ${nombreProductoDB}
🔑 Licencia: \`${licencia}\`

📚 *TUTORIAL DE INSTALACIÓN:*`;

  // Productos con tutoriales más detallados
  const productosConTutorialCompleto = [
    'drip_mobile',
    'cuban_no_root', 
    'cuban_autokill',
    'drip_silent',
    'drip_aimkill',
    'drip_dll',
    'br_mods',
    'br_bypass',
    'cuban_panel_pc',
    'cuban_8bp',
    'cuban_vip',
    'cuban_black',
    'cuban_disimulado'
  ];
  
  const esProductoCompleto = productosConTutorialCompleto.includes(tutorialAlias);
  
  if (esProductoCompleto) {
    mensaje += `
🎯 Tutorial completo disponible en:
🔗 ${tutorialUrl}`;
  } else {
    mensaje += `
🎯 *Pasos básicos:*
1. Descarga el archivo enviado
2. Sigue las instrucciones de instalación
3. Ingresa tu licencia cuando te la pida

🔗 Tutorial completo: ${tutorialUrl}`;
  }

  // Agregar información del vendedor solo si está disponible
  if (vendedorAsignado) {
    mensaje += `

👤 *TU VENDEDOR ASIGNADO:*
📱 ${vendedorAsignado.nombre}: ${vendedorAsignado.telefono}
💬 Contacta a tu vendedor para cualquier duda`;
  }

  mensaje += `

💬 *Grupo de Clientes:* 
https://chat.whatsapp.com/Fa9LYiClTav3qRYopWmIs8

🌐 *Entregado desde Cuban Hacks Database*
¡Gracias por tu compra! 🚀`;

  return mensaje;
}

// Endpoint para entrega directa con datos reales (POST)
app.post('/entrega-directa', async (req, res) => {
  try {
    console.log('📥 Entrega directa recibida');
    console.log('📋 Datos recibidos:', req.body);
    
    const { telefono, producto, licencia, tutorial, monto, metodo_pago } = req.body;
    
    if (!telefono || !producto || !licencia || !tutorial) {
      return res.status(400).json({
        success: false,
        message: 'Datos incompletos para entrega directa'
      });
    }
    
    console.log('✅ Procesando entrega directa');
    console.log(`📱 Cliente: ${telefono}`);
    console.log(`📦 Producto: ${producto}`);
    console.log(`🔑 Licencia: ${licencia}`);
    
    // ===== ASIGNAR VENDEDOR ANTES DEL MENSAJE =====
    console.log('👥 Obteniendo vendedor asignado...');
    const vendedorAsignado = obtenerSiguienteVendedor();
    
    // Convertir HTML a texto si es necesario
    let tutorialText = tutorial;
    if (tutorial.includes('<') && tutorial.includes('>')) {
      const { htmlToText } = require('html-to-text');
      tutorialText = htmlToText(tutorial, {
        wordwrap: 80,
        preserveNewlines: true,
        singleNewLineParagraphs: true
      });
      
      tutorialText = tutorialText
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // Crear mensaje mejorado con sistema avanzado de tutoriales
    const mensaje = crearMensajeTutorialMejorado(producto, licencia, vendedorAsignado);

    // Corregir formato del número
    let numeroCorregido = telefono.replace(/[+\s]/g, '');
    if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
      numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
      console.log(`🔧 Número corregido: ${telefono} → ${numeroCorregido}`);
    }
    
    console.log(`📱 Enviando mensaje completo a: ${numeroCorregido}@c.us`);
    
    // Función para enviar mensaje con reintentos
    const enviarMensajeConReintentos = async (maxIntentos = 3) => {
      for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
          console.log(`📤 Enviando mensaje (intento ${intento}/${maxIntentos})`);
          
          // Verificar estado de WhatsApp Web (solo si cliente disponible)
          let info = 'NOT_AVAILABLE';
          if (client) {
            info = await client.getState();
            console.log(`📱 Estado de WhatsApp: ${info}`);
          } else {
            console.log(`📱 Cliente no disponible en Railway`);
          }
          
          if (info !== 'CONNECTED') {
            console.log(`⚠️ WhatsApp no está conectado (${info}), esperando 5 segundos... (intento ${intento}/${maxIntentos})`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Intentar recargar si no está conectado
            if (intento === 1) {
              console.log(`🔄 Intentando reconectar WhatsApp Web...`);
              try {
                await client.pupPage.reload();
                await new Promise(resolve => setTimeout(resolve, 3000));
              } catch (reloadError) {
                console.log(`⚠️ Error al recargar: ${reloadError.message}`);
              }
            }
          }
          
          await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensaje);
          console.log(`✅ Mensaje enviado exitosamente (intento ${intento})`);
          return true;
        } catch (error) {
          console.log(`❌ Error en intento ${intento}/${maxIntentos}: ${error.message}`);
          if (intento < maxIntentos) {
            console.log(`🔄 Reintentando en 2 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.log(`❌ No se pudo enviar el mensaje después de ${maxIntentos} intentos`);
            throw error;
          }
        }
      }
    };
    
    await enviarMensajeConReintentos();
    console.log(`✅ Entrega directa completada exitosamente`);
    
    // ===== NOTIFICAR AL VENDEDOR =====
    try {
      console.log('👥 Notificando al vendedor asignado...');
      
      // Notificar al vendedor asignado sobre la venta
      await notificarVendedor(
        vendedorAsignado, 
        telefono, 
        producto, 
        licencia, 
        monto
      );
      
      console.log(`✅ Vendedor ${vendedorAsignado.nombre} notificado exitosamente`);
    } catch (error) {
      console.error('❌ Error notificando vendedor:', error.message);
      // No afecta la entrega al cliente, solo registrar el error
    }
    // ===== FIN NOTIFICACIÓN VENDEDOR =====
    
    return res.json({
      success: true,
      message: 'Producto entregado exitosamente',
      cliente: numeroCorregido,
      producto: producto
    });
    
  } catch (error) {
    console.error('❌ Error en entrega directa:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error interno en entrega directa'
    });
  }
});

// Endpoint para recibir datos de Zapier (GET)
app.get('/recibir-datos-zapier', async (req, res) => {
  try {
    console.log('📥 Petición GET recibida en /recibir-datos-zapier');
    console.log('🔍 Query parameters completos:', req.query);
    console.log('🔍 URL completa:', req.url);
    
    const { status, licencia, tutorial, telefono, producto } = req.query;
    
    console.log('📥 Datos extraídos:');
    console.log('Status:', status);
    console.log('Licencia:', licencia);
    console.log('Tutorial:', tutorial);
    console.log('Teléfono:', telefono);
    console.log('Producto:', producto);
    
    if (status === 'success' && licencia && tutorial && telefono) {
      console.log('✅ Datos válidos recibidos de Zapier');
      
      // Convertir HTML a texto si es necesario
      let tutorialText = tutorial;
      if (tutorial.includes('<') && tutorial.includes('>')) {
        const { htmlToText } = require('html-to-text');
        tutorialText = htmlToText(tutorial, {
          wordwrap: 80,
          preserveNewlines: true,
          singleNewLineParagraphs: true,
          formatters: {
            // Eliminar espacios múltiples
            text: (elem, walk, builder, options) => {
              const text = elem.data.replace(/\s+/g, ' ').trim();
              if (text) builder.addInline(text);
            }
          }
        });
        
        // Limpiar espacios múltiples y líneas vacías
        tutorialText = tutorialText
          .replace(/\n\s*\n\s*\n/g, '\n\n') // Máximo 2 líneas vacías consecutivas
          .replace(/\s+/g, ' ') // Eliminar espacios múltiples
          .trim();
      }
      
      // Crear mensaje mejorado con sistema avanzado de tutoriales (sin vendedor asignado para Zapier)
      const mensajeLicencia = crearMensajeTutorialMejorado(
        producto || 'Producto autorizado', 
        licencia, 
        null // Sin vendedor asignado para entregas de Zapier
      );

      try {
        // Corregir formato del número de teléfono para México
        let numeroCorregido = telefono;
        
        // Limpiar el número (quitar + y espacios)
        numeroCorregido = numeroCorregido.replace(/[+\s]/g, '');
        
        // Verificar si es un número mexicano que necesita corrección
        if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
          // Si es 52XXXXXXXXXX (12 dígitos), agregar el 1 después del 52
          numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
          console.log(`🔧 Número corregido: ${telefono} → ${numeroCorregido}`);
        } else if (numeroCorregido.startsWith('52') && numeroCorregido.length === 13) {
          // Si ya tiene 13 dígitos, está bien
          console.log(`✅ Número ya tiene formato correcto: ${numeroCorregido}`);
        } else {
          console.log(`⚠️ Formato de número no reconocido: ${numeroCorregido}`);
        }
        
        console.log(`📱 Intentando enviar mensajes a: ${numeroCorregido}@c.us`);
        console.log(`📝 Mensaje de licencia:`, mensajeLicencia.substring(0, 100) + '...');
        console.log(`📚 Tutorial (${tutorialText.length} caracteres):`, tutorialText.substring(0, 100) + '...');
        
        // Verificar que WhatsApp esté disponible (WhAPI o cliente local)
        if (!WHAPI_ENABLED && (!client || !client.pupPage)) {
          console.log('❌ WhatsApp no está conectado');
          return res.json({ 
            success: false, 
            message: 'WhatsApp no está conectado. Espera unos segundos y vuelve a intentar.',
            cliente: telefono
          });
        }
        
        // Función para enviar mensaje con reintentos
        const enviarMensajeConReintentos = async (mensaje, maxIntentos = 3) => {
          for (let intento = 1; intento <= maxIntentos; intento++) {
            try {
              // Verificar que el cliente esté listo (solo si estamos usando cliente local)
              if (client && !client.pupPage) {
                console.log(`⚠️ WhatsApp no está listo, esperando 5 segundos... (intento ${intento}/${maxIntentos})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
              }
              
              // Verificar que el cliente esté autenticado (solo si estamos usando cliente local)
              if (client && !client.authStrategy) {
                console.log(`⚠️ WhatsApp no está autenticado, esperando 3 segundos... (intento ${intento}/${maxIntentos})`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
              }
              
              // Esperar un poco antes de enviar
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensaje);
              console.log(`✅ Mensaje enviado exitosamente a ${numeroCorregido} (intento ${intento})`);
              return true;
            } catch (error) {
              console.log(`❌ Error en intento ${intento}/${maxIntentos}: ${error.message}`);
              if (intento < maxIntentos) {
                console.log(`🔄 Reintentando en 8 segundos...`);
                await new Promise(resolve => setTimeout(resolve, 8000));
              } else {
                console.log(`❌ No se pudo enviar el mensaje después de ${maxIntentos} intentos`);
                throw error;
              }
            }
          }
        };
        
        // Enviar mensaje completo (licencia + tutorial)
        console.log(`📱 Enviando mensaje completo a: ${numeroCorregido}@c.us`);
        await enviarMensajeConReintentos(mensajeLicencia);
        
        res.json({ 
          success: true, 
          message: 'Licencia y tutorial enviados al cliente',
          cliente: numeroCorregido
        });
      } catch (error) {
        console.error('❌ Error enviando mensaje a WhatsApp:', error);
        console.error('❌ Detalles del error:', error.message);
        console.error('❌ Stack trace:', error.stack);
        res.json({ 
          success: false, 
          message: 'Error enviando mensaje a WhatsApp',
          error: error.message
        });
      }
    } else {
      console.log('❌ Datos incompletos recibidos de Zapier');
      res.json({ success: false, message: 'Datos incompletos' });
    }
  } catch (error) {
    console.error('❌ Error recibiendo datos de Zapier:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint principal para reportar tickets de autorización
app.post('/reportar-ticket', async (req, res) => {
  // Logging completo de datos recibidos para diagnóstico
  console.log('📥 DATOS RECIBIDOS DESDE MANYCHAT:');
  console.log('=====================================');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('=====================================');
  
  const { Numero, Producto, Comprobante, "Duracion o Cantidad": duracion, Monto, WA_ID, ID, "usuario socio": usuarioSocio, "Foto de PAgo": fotoPago } = req.body;

  console.log('🔍 CAMPOS EXTRAÍDOS:');
  console.log(`   📱 Numero: ${Numero}`);
  console.log(`   📦 Producto: ${Producto}`);
  console.log(`   🧾 Comprobante: ${Comprobante}`);
  console.log(`   📸 Foto de PAgo: ${fotoPago}`);
  console.log(`   ⏱️ Duracion: ${duracion}`);
  console.log(`   💰 Monto: ${Monto}`);
  console.log(`   📲 WA_ID: ${WA_ID}`);
  console.log(`   🆔 ID: ${ID}`);
  console.log(`   👤 Usuario Socio: ${usuarioSocio}`);
  console.log('=====================================');

  if (!Numero || !Producto) {
    return res.status(400).send('Faltan datos obligatorios: Numero y Producto');
  }

  // Verificar duplicados ANTES de procesar el ticket
  const verificacionDuplicado = esDuplicado(Numero, Producto, Comprobante);
  if (verificacionDuplicado.esDuplicado) {
    console.log(`🚫 REPORTE DUPLICADO BLOQUEADO - Cliente: ${Numero}`);
    
    return res.status(409).json({
      success: false,
      message: `⚠️ Reporte duplicado detectado. Ya reportaste este mismo pago hace ${verificacionDuplicado.tiempoTranscurrido} minutos (Ticket #${verificacionDuplicado.ticketAnterior}). Si necesitas ayuda, contacta a soporte.`,
      error: 'duplicate_report',
      duplicado: true,
      ticket_anterior: verificacionDuplicado.ticketAnterior,
      tiempo_transcurrido: verificacionDuplicado.tiempoTranscurrido
    });
  }

  // Verificar que WhatsApp esté disponible (WhAPI o cliente local)
  if (!WHAPI_ENABLED && (!client || !client.pupPage)) {
    return res.status(503).json({
      success: false,
      message: 'WhatsApp no está conectado. Espera unos segundos y vuelve a intentar.',
      error: 'WhatsApp not available'
    });
  }

  // Obtener información del país y grupo
  const prefijoPais = obtenerPrefijoPais(Numero);
  const grupoInfo = obtenerGrupoPais(prefijoPais);
  const ticketId = generarTicketId();
  
  console.log(`🌍 Detección de país:`);
  console.log(`   📱 Número original: ${Numero}`);
  console.log(`   🔍 Prefijo detectado: ${prefijoPais}`);
  console.log(`   🎯 País asignado: ${grupoInfo.nombre}`);
  console.log(`   📛 Grupo ID: ${grupoInfo.grupo_id}`);

  // Construir mensaje mejorado y más organizado
  const horaActual = new Date().toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit',
    timeZone: 'America/Mexico_City'
  });
  
  let mensaje = `🎫 *TICKET #${ticketId}* | ${horaActual}
══════════════════════════════

📱 *Cliente:* ${Numero}
📦 *Producto:* ${Producto}`;

  // Extraer URL de imagen desde el campo Comprobante si está embebida
  let urlImagenExtraida = fotoPago;
  
  // Si no hay fotoPago como campo separado, buscar en el texto del Comprobante
  if (!urlImagenExtraida && Comprobante) {
    const matchUrl = Comprobante.match(/(?:Foto de PAgo|Comprobante|Image|URL):\s*(https?:\/\/[^\s\n]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?)/i);
    if (matchUrl) {
      urlImagenExtraida = matchUrl[1].trim();
      console.log(`🔍 URL extraída del comprobante: ${urlImagenExtraida}`);
    }
  }
  
  // Determinar si tenemos imagen de comprobante
  const urlImagen = urlImagenExtraida || Comprobante;
  const esUrlImagen = urlImagenExtraida && urlImagenExtraida.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
  
  // Limpiar el comprobante removiendo la URL si se extrajo
  let comprobanteTexto = Comprobante;
  if (urlImagenExtraida && Comprobante) {
    comprobanteTexto = Comprobante.replace(/(?:Foto de PAgo|Comprobante|Image|URL):\s*https?:\/\/[^\s\n]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?/i, '').trim();
    comprobanteTexto = comprobanteTexto.replace(/\n\s*\n/g, '\n').trim(); // Limpiar líneas vacías
  }
  
  // Solo incluir comprobante como texto si hay información útil
  if (comprobanteTexto && !esUrlImagen && comprobanteTexto !== Comprobante) {
    mensaje += `\n🧾 *Referencia:* ${comprobanteTexto}`;
  } else if (comprobanteTexto && !esUrlImagen) {
    mensaje += `\n🧾 *Comprobante:* ${comprobanteTexto}`;
  }

  // Agregar información específica para producto socio
  if (Producto && Producto.toLowerCase().includes('socio')) {
    if (usuarioSocio) {
      mensaje += `\n👤 *Usuario a recargar:* ${usuarioSocio}`;
      mensaje += `\n💰 *Monto a recargar:* $${duracion || 'No especificado'}`;
    } else {
      mensaje += `\n⚠️ *ATENCIÓN:* Falta usuario socio para recarga`;
    }
  }

  // Agregar duración si está disponible
  if (duracion) {
    mensaje += `\n⏱️ *Duración:* ${duracion}`;
  }

  mensaje += `

🌍 *País:* ${grupoInfo.nombre}
══════════════════════════════

⚡ *RESPONDER A ESTE MENSAJE:*
✅ *APROBAR TICKET #${ticketId}*
❌ *RECHAZAR TICKET #${ticketId}*

🔔 *Ticket #${ticketId}* • ${horaActual}`;

  try {
    console.log(`🎫 Enviando ticket #${ticketId} al grupo de ${grupoInfo.nombre}...`);
    console.log(`📍 Grupo ID: ${grupoInfo.grupo_id}`);
    
    if (esUrlImagen) {
      console.log(`📸 URL de imagen detectada: ${urlImagenExtraida}`);
      console.log(`   🔗 Fuente: ${fotoPago ? 'Campo Foto de PAgo' : 'Extraída del Comprobante'}`);
      mensaje += `\n\n📸 *Comprobante de pago adjunto*`;
      
      // Generar nombre único para la imagen
      const nombreImagen = `comprobante_${ticketId}_${Date.now()}.jpg`;
      
      // Enviar mensaje con imagen adjunta
      await enviarMensajeConImagen(grupoInfo.grupo_id, mensaje, urlImagenExtraida, nombreImagen);
      console.log(`✅ Ticket #${ticketId} enviado con imagen al grupo de ${grupoInfo.nombre}`);
    } else {
      // Enviar mensaje normal sin imagen
    await enviarMensajeSeguro(grupoInfo.grupo_id, mensaje);
    console.log(`✅ Ticket #${ticketId} enviado al grupo de ${grupoInfo.nombre}`);
      if (urlImagenExtraida) {
        console.log(`ℹ️ URL extraída pero no es imagen válida: ${urlImagenExtraida}`);
      } else if (Comprobante && Comprobante.includes('http')) {
        console.log(`ℹ️ Comprobante contiene URL pero no se pudo extraer: ${Comprobante.substring(0, 100)}...`);
      }
    }
    
    // Registrar reporte en sistema anti-duplicados
    registrarReporte(Numero, Producto, Comprobante, ticketId);
    
    // Guardar ticket pendiente
    ticketsPendientes.set(ticketId, {
      numero: Numero,
      producto: Producto,
      comprobante: Comprobante,
      fotoPago: fotoPago, // URL de la imagen de comprobante (campo directo)
      urlImagenExtraida: urlImagenExtraida, // URL extraída del texto del comprobante
      duracion: duracion,
      monto: Monto,
      pais: grupoInfo.nombre,
      grupo_id: grupoInfo.grupo_id,
      prefijo_detectado: prefijoPais,
      wa_id: WA_ID || Numero,
      id: ID, // Campo para ID del cliente (especialmente para diamantes)
      usuarioSocio: usuarioSocio, // Campo para username del usuario socio
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      message: `Ticket #${ticketId} enviado al grupo de ${grupoInfo.nombre}`,
      ticket_id: ticketId,
      pais: grupoInfo.nombre,
      grupo_id: grupoInfo.grupo_id,
      prefijo_detectado: prefijoPais
    });
  } catch (e) {
    console.error('❌ Error enviando ticket:', e);
    res.status(500).json({
      success: false,
      message: 'Error al enviar el ticket',
      error: e.message,
      grupo_intentado: grupoInfo.grupo_id
    });
  }
});

// Endpoint para detectar grupos manualmente
app.post('/detectar-grupos', async (req, res) => {
  try {
    const grupos = await detectarGrupos();
    res.json({
      success: true,
      message: 'Grupos detectados y configuración actualizada',
      grupos_detectados: grupos.length,
      grupos: grupos.map(g => ({ nombre: g.name, id: g.id._serialized }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error detectando grupos',
      error: error.message
    });
  }
});

// Endpoint para verificar estado de tickets
app.get('/estado-ticket/:ticketId', (req, res) => {
  const { ticketId } = req.params;
  const ticket = ticketsPendientes.get(parseInt(ticketId));
  
  if (ticket) {
    res.json({
      ticket_id: ticketId,
      estado: 'Pendiente de autorización',
      datos: ticket,
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(404).json({
      ticket_id: ticketId,
      estado: 'No encontrado',
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para listar tickets pendientes
app.get('/tickets-pendientes', (req, res) => {
  const tickets = Array.from(ticketsPendientes.entries()).map(([id, data]) => ({
    ticket_id: id,
    numero: data.numero,
    producto: data.producto,
    pais: data.pais,
    timestamp: data.timestamp
  }));
  
  res.json({
    total_pendientes: tickets.length,
    tickets: tickets
  });
});



// Endpoint para procesar ticket (marcar como aprobado/rechazado)
app.post('/procesar-ticket/:ticketId', async (req, res) => {
  const { ticketId } = req.params;
  const { accion, autor } = req.body;
  
  const ticket = ticketsPendientes.get(parseInt(ticketId));
  
  if (ticket) {
    // Marcar ticket como procesado
    ticket.procesado = true;
    ticket.accion = accion;
    ticket.autor = autor;
    ticket.fecha_procesamiento = new Date().toISOString();
    
    // Remover de pendientes
    ticketsPendientes.delete(parseInt(ticketId));
    
    console.log(`✅ Ticket #${ticketId} marcado como ${accion} por ${autor}`);
    
    // Entregar producto si está aprobado
    if (accion === 'APROBADO') {
      try {
        console.log(`🎁 Solicitando licencia y tutorial para producto: ${ticket.producto}`);
        
        // Convertir nombre del producto a su variable y obtener tutorial_alias
        // MAPEO DIRECTO - No conversión de variables necesaria
        const tutorialAlias = 'auto'; // Se determina automáticamente en la API
        
        // Verificar si es un producto sin entrega automática (NOMBRES DIRECTOS)
        const productosSinEntrega = ['Cuban Panel iOS', 'Flourite', 'Easy Victory', 'OnlyFans', 'Netflix', 'Spotify'];
        const esProductoSinEntrega = productosSinEntrega.some(p => 
          ticket.producto.toLowerCase().includes(p.toLowerCase())
        );
        
        // Verificar si es un producto de diamantes
        const esProductoDiamantes = ticket.producto.toLowerCase().includes('diamantes');
        
        // Verificar si es un producto socio (recarga de saldo)
        const esProductoSocio = ticket.producto.toLowerCase().includes('socio');
        
        if (esProductoSocio) {
          // 🎯 PRODUCTO SOCIO - Recarga automática de saldo
          console.log(`💰 Producto SOCIO detectado: ${ticket.producto}`);
          console.log(`👤 Usuario a recargar: ${ticket.usuarioSocio}`);
          console.log(`💵 Monto a recargar: ${ticket.duracion}`);
          
          if (!ticket.usuarioSocio) {
            console.log(`❌ Error: No se especificó el usuario socio para la recarga`);
            
            // Enviar mensaje de error al cliente
            let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, '');
            if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
              numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
            }
            
            const mensajeError = `❌ *ERROR EN RECARGA SOCIO*

Lo sentimos, hubo un problema con tu recarga de socio. Contacta al soporte para resolverlo.

🎫 *Ticket:* #${ticketId}`;
            
            await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeError);
            return;
          }
          
          try {
            // Validar datos antes de enviar
            const montoRecarga = parseFloat(ticket.duracion);
            if (isNaN(montoRecarga) || montoRecarga <= 0) {
              throw new Error(`Monto de recarga inválido: ${ticket.duracion}`);
            }
            
            if (montoRecarga > 10000) {
              throw new Error(`Monto de recarga demasiado alto: $${montoRecarga} (máximo: $10,000)`);
            }
            
            const requestData = {
              username: ticket.usuarioSocio,
              amount: montoRecarga,
              description: `Recarga socio automática - Ticket #${ticketId} - Bot WhatsApp`
            };
            
            console.log(`💰 Procesando recarga:`, requestData);
            
            // Headers con autenticación requerida
            const headers = {
              'Content-Type': 'application/json',
              'X-API-Key': 'cuban_whapi_bot_2024',
              'User-Agent': 'Cuban-WhatsApp-Bot/1.0'
            };
            
            // Llamar a la API de cubanhacks para agregar saldo
            const response = await fetch('https://cubanhacks.com/api/add_balance_by_username.php', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestData),
              timeout: 15000 // 15 segundos timeout
            });
            
            console.log(`📥 Status de respuesta de Balance API: ${response.status}`);
            
            // Verificar errores HTTP
            if (!response.ok) {
              const errorText = await response.text();
              console.error(`❌ Error HTTP ${response.status}:`, errorText);
              
              if (response.status === 401) {
                throw new Error('Error de autenticación - API key inválida');
              } else if (response.status === 403) {
                throw new Error('Permisos insuficientes para agregar saldo');
              } else {
                throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
              }
            }
            
            const result = await response.json();
            console.log(`📥 Respuesta de API cubanhacks:`, result);
            
            // Verificar respuesta de la API
            if (!result.success) {
              console.log(`❌ Error reportado por Balance API: ${result.message}`);
              throw new Error(result.message);
            }
            
            // Validar que la respuesta tenga los datos esperados
            if (!result.data || typeof result.data.new_balance === 'undefined') {
              console.log(`❌ Respuesta inválida de Balance API:`, result);
              throw new Error('Respuesta inválida de la API de balance');
            }
            
              // Enviar mensaje de confirmación al cliente
              let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, '');
              if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
                numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
              }
              
              const mensajeExito = `✅ *RECARGA SOCIO COMPLETADA*

Tu recarga ha sido procesada exitosamente:

👤 *Usuario:* ${ticket.usuarioSocio}
💰 *Monto recargado:* $${montoRecarga.toFixed(2)}
💳 *Nuevo saldo:* $${result.data.new_balance.toFixed(2)}
🎫 *Ticket:* #${ticketId}

¡Tu saldo ha sido actualizado! 🚀

🌐 *Sistema Cuban Hacks*`;
              
              await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeExito);
            console.log(`✅ Recarga socio completada: $${montoRecarga} agregados a ${ticket.usuarioSocio}. Nuevo saldo: $${result.data.new_balance.toFixed(2)}`);
          } catch (error) {
            console.error(`❌ Error en API de balance para ticket #${ticketId}:`, error.message);
            console.error(`❌ Usuario: ${ticket.usuarioSocio}, Monto: ${ticket.duracion}`);
            
            // Determinar tipo de error para mensaje más específico
            let mensajeError = `❌ *ERROR EN RECARGA SOCIO*

`;
            
            if (error.message.includes('autenticación') || error.message.includes('API key')) {
              mensajeError += `Error de configuración del sistema. Contacta al administrador.
🎫 *Ticket:* #${ticketId}`;
            } else if (error.message.includes('Usuario') && error.message.includes('no encontrado')) {
              mensajeError += `El usuario "${ticket.usuarioSocio}" no existe en el sistema.
Verifica que el username sea correcto.
🎫 *Ticket:* #${ticketId}`;
            } else if (error.message.includes('Monto')) {
              mensajeError += `${error.message}
🎫 *Ticket:* #${ticketId}`;
            } else {
              mensajeError += `Hubo un problema técnico con tu recarga.
Contacta al soporte con el número de ticket.
🎫 *Ticket:* #${ticketId}

📧 Soporte: https://t.me/cubanvipmod`;
            }
            
            // Enviar mensaje de error al cliente
            let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, '');
            if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
              numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
            }
            
            await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeError);
          }
          
        } else if (esProductoDiamantes) {
          // 🎯 PRODUCTO DIAMANTES - Enviar a grupo de verificación
          console.log(`💎 Producto DIAMANTES detectado: ${ticket.producto}`);
          
          const mensajeDiamantes = `💎 *ENTREGA DIAMANTES*
          
📱 *Teléfono:* ${ticket.wa_id}
🆔 *ID Diamantes:* ${ticket.id || 'No proporcionado'}
💰 *Cantidad:* ${ticket.duracion || 'No proporcionado'}
🎫 *Ticket:* #${ticketId}`;
          
          // Enviar al grupo de entrega de diamantes
          await enviarMensajeSeguro(grupoDiamantesGlobal, mensajeDiamantes);
          console.log(`✅ Mensaje de diamantes enviado al grupo ENTREGA DIAMANTES (ID: ${grupoDiamantesGlobal})`);
          
        } else if (esProductoSinEntrega) {
          // 🎯 PRODUCTO SIN ENTREGA AUTOMÁTICA - Solo mensaje de validación
          console.log(`📋 Producto sin entrega automática: ${ticket.producto}`);
          
          const mensajeValidacion = `✅ *PAGO VALIDADO*
          
Tu pago ha sido validado correctamente. Uno de nuestros vendedores se pondrá en contacto contigo para tu entrega.

📦 *Producto:* ${ticket.producto}
🎫 *Ticket:* #${ticketId}

¡Gracias por tu compra! 🚀`;
          
          // Corregir formato del número de teléfono para México
          let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, ''); // Quitar + y espacios
          if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
            numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
            console.log(`🔧 Número corregido: ${ticket.wa_id} → ${numeroCorregido}`);
          }
          
          await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeValidacion);
          console.log(`✅ Mensaje de validación enviado a ${numeroCorregido}`);
          
        } else {
          // 🎯 PRODUCTO CON ENTREGA AUTOMÁTICA - Proceso con Cuban Hacks Database
          console.log(`📤 Consultando Cuban Hacks Database para producto: ${ticket.producto} (DIRECTO)`);
          
          try {
            // Construir objeto de datos para Cuban Hacks API - NOMBRE EXACTO DE MANYCHAT
            const datosCubanHacks = {
              producto: ticket.producto, // Usar el nombre EXACTO que viene de ManyChat
              duracion: ticket.duracion || '1',
              tutorial_alias: obtenerTutorialAlias(ticket.producto) || 'general' // Usar mapeo real basado en nombres de ManyChat
            };
          
            console.log(`📤 Enviando datos a Cuban Hacks API:`, datosCubanHacks);
            
            // Usar API de producción con autenticación
            const apiUrl = 'https://cubanhacks.com/api/get_product_data.php';
            
            console.log(`🌐 Conectando a: ${apiUrl}`);
            
            // Headers con autenticación requerida
            const headers = {
              'Content-Type': 'application/json',
              'X-API-Key': 'cuban_whapi_bot_2024',
              'User-Agent': 'Cuban-WhatsApp-Bot/1.0'
            };
            
            const cubanHacksResponse = await fetch(apiUrl, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(datosCubanHacks),
              timeout: 20000 // 20 segundos timeout
            });
            
            console.log(`📥 Status de respuesta de Cuban Hacks API: ${cubanHacksResponse.status}`);
            
            // Manejo mejorado de errores HTTP
            if (!cubanHacksResponse.ok) {
              const errorText = await cubanHacksResponse.text();
              console.error(`❌ Error HTTP ${cubanHacksResponse.status}:`, errorText);
              
              if (cubanHacksResponse.status === 401) {
                throw new Error('Error de autenticación - API key inválida');
              } else if (cubanHacksResponse.status === 403) {
                throw new Error('Permisos insuficientes para acceder a la API');
              } else {
              throw new Error(`Error HTTP ${cubanHacksResponse.status}: ${cubanHacksResponse.statusText}`);
              }
            }
            
            const responseText = await cubanHacksResponse.text();
            console.log(`📥 Respuesta completa de Cuban Hacks API: ${responseText.substring(0, 300)}...`);
            
            // Verificar si la respuesta es HTML en lugar de JSON
            if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
              console.error('❌ Cuban Hacks API devolvió HTML en lugar de JSON');
              console.error('❌ Respuesta recibida:', responseText.substring(0, 500));
              throw new Error('Cuban Hacks API devolvió HTML inesperado - verificar URL y configuración');
            }
            
            let cubanHacksData;
            try {
              cubanHacksData = JSON.parse(responseText);
            } catch (parseError) {
              console.error('❌ Error parseando JSON de Cuban Hacks API:', parseError);
              console.error('❌ Respuesta recibida:', responseText.substring(0, 500));
              throw new Error('Respuesta JSON inválida de Cuban Hacks API');
            }
            
            console.log('📋 Respuesta de Cuban Hacks API:', cubanHacksData);
            
            // Verificar si la API devolvió un error
            if (cubanHacksData.status === 'error') {
              console.error('❌ Error reportado por Cuban Hacks API:', cubanHacksData.message);
              throw new Error(`API Error: ${cubanHacksData.message}`);
            }
            
            if (cubanHacksData.status === 'success' && cubanHacksData.licencia && cubanHacksData.tutorial) {
              console.log('✅ Cuban Hacks API devolvió licencia y tutorial exitosamente');
              console.log(`🔑 Licencia obtenida: ${cubanHacksData.licencia}`);
              console.log(`📚 Tutorial: ${cubanHacksData.tutorial ? 'Obtenido' : 'No disponible'}`);
              console.log(`📦 Producto DB: ${cubanHacksData.product_name || 'N/A'}`);
              console.log(`🌐 Fuente: ${cubanHacksData.source || 'cubanhacks_database'}`);
              
              // Renombrar variable para mantener compatibilidad con el código existente
              const zapierData = {
                status: cubanHacksData.status,
                licencia: cubanHacksData.licencia,
                tutorial: cubanHacksData.tutorial,
                product_name: cubanHacksData.product_name,
                source: 'cubanhacks_database'
              };
            
              if (zapierData.status === 'success' && zapierData.licencia && zapierData.tutorial) {
              console.log('✅ Zapier devolvió licencia y tutorial');
              
              // Convertir HTML a texto si es necesario
              let tutorialText = zapierData.tutorial;
              if (zapierData.tutorial.includes('<') && zapierData.tutorial.includes('>')) {
                const { htmlToText } = require('html-to-text');
                tutorialText = htmlToText(zapierData.tutorial, {
                  wordwrap: 80,
                  preserveNewlines: true,
                  singleNewLineParagraphs: true,
                  formatters: {
                    text: (elem, walk, builder, options) => {
                      const text = elem.data.replace(/\s+/g, ' ').trim();
                      if (text) builder.addInline(text);
                    }
                  }
                });
                
                tutorialText = tutorialText
                  .replace(/\n\s*\n\s*\n/g, '\n\n')
                  .replace(/\s+/g, ' ')
                  .trim();
              }
              
              // ===== ASIGNAR VENDEDOR ANTES DEL MENSAJE =====
              console.log('👥 Obteniendo vendedor asignado para el cliente...');
              const vendedorAsignado = obtenerSiguienteVendedor();
              
              // Generar mensaje mejorado con sistema avanzado de tutoriales
              const mensaje = crearMensajeTutorialMejorado(
                zapierData.product_name || ticket.producto,
                zapierData.licencia,
                vendedorAsignado
              );

              // Corregir formato del número de teléfono para México
              let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, ''); // Quitar + y espacios
              if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
                numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
                console.log(`🔧 Número corregido: ${ticket.wa_id} → ${numeroCorregido}`);
              }
              
                        console.log(`📱 Enviando mensaje a: ${numeroCorregido}@c.us`);
          
          // Función para enviar mensaje con reintentos (VERSIÓN MEJORADA)
          const enviarMensajeConReintentos = async (maxIntentos = 3) => {
            for (let intento = 1; intento <= maxIntentos; intento++) {
              try {
                console.log(`📤 Enviando mensaje (intento ${intento}/${maxIntentos})`);
                
                // Verificar estado de WhatsApp Web (solo si cliente disponible)
                let info = 'NOT_AVAILABLE';
                if (client) {
                  info = await client.getState();
                  console.log(`📱 Estado de WhatsApp: ${info}`);
                } else {
                  console.log(`📱 Cliente no disponible en Railway`);
                }
                
                if (info !== 'CONNECTED') {
                  console.log(`⚠️ WhatsApp no está conectado (${info}), esperando 5 segundos... (intento ${intento}/${maxIntentos})`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  
                  // Intentar recargar si no está conectado
                  if (intento === 1) {
                    console.log(`🔄 Intentando reconectar WhatsApp Web...`);
                    try {
                      await client.pupPage.reload();
                      await new Promise(resolve => setTimeout(resolve, 3000));
                    } catch (reloadError) {
                      console.log(`⚠️ Error al recargar: ${reloadError.message}`);
                    }
                  }
                }
                
                await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensaje);
                console.log(`✅ Producto entregado exitosamente a ${numeroCorregido} (intento ${intento})`);
                return true;
              } catch (error) {
                console.log(`❌ Error en intento ${intento}/${maxIntentos}: ${error.message}`);
                if (intento < maxIntentos) {
                  console.log(`🔄 Reintentando en 5 segundos...`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                  console.log(`❌ No se pudo enviar el mensaje después de ${maxIntentos} intentos`);
                  throw error;
                }
              }
            }
          };
          
          await enviarMensajeConReintentos();
          
          // ===== NOTIFICAR AL VENDEDOR =====
          try {
            console.log('👥 Notificando al vendedor asignado...');
            
            // Notificar al vendedor asignado sobre la venta
            await notificarVendedor(
              vendedorAsignado, 
              ticket.wa_id, 
              zapierData.product_name || ticket.producto, 
              zapierData.licencia,
              ticket.monto
            );
            
            console.log(`✅ Vendedor ${vendedorAsignado.nombre} notificado exitosamente`);
          } catch (error) {
            console.error('❌ Error notificando vendedor:', error.message);
            // No afecta la entrega al cliente, solo registrar el error
          }
          // ===== FIN NOTIFICACIÓN VENDEDOR =====
              
            } else {
              console.error('❌ Cuban Hacks API no devolvió licencia o tutorial válidos:', cubanHacksData);
              if (cubanHacksData.status === 'error') {
                console.error('❌ Error reportado por la API:', cubanHacksData.message);
              }
            }
            }
            
          } catch (error) {
            console.error('❌ Error consultando Cuban Hacks Database:', error.message);
            console.error('❌ Stack trace:', error.stack);
            
            // Log adicional para debugging
            console.error('🔍 Detalles del error:');
            console.error('   - Producto enviado:', ticket.producto);
            console.error('   - Duración enviada:', ticket.duracion);
            console.error('   - Tutorial alias:', tutorialAlias);
            console.error('   - Mapeo: DIRECTO (sin conversión a variables)');
            
            // Enviar mensaje de error al cliente si es un error crítico
            try {
              let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, '');
              if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
                numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
              }
              
              let mensajeError = `❌ *ERROR EN ENTREGA AUTOMÁTICA*

`;
              
              if (error.message.includes('autenticación') || error.message.includes('API key')) {
                mensajeError += `Error de configuración del sistema.
Un administrador ha sido notificado.
🎫 *Ticket:* #${ticketId}`;
              } else if (error.message.includes('no está configurado')) {
                mensajeError += `El producto "${ticket.producto}" no está disponible para entrega automática.
Un vendedor se pondrá en contacto contigo.
🎫 *Ticket:* #${ticketId}`;
              } else if (error.message.includes('No hay licencias disponibles')) {
                mensajeError += `Producto temporalmente sin stock.
Un vendedor te contactará con una alternativa.
🎫 *Ticket:* #${ticketId}`;
              } else {
                mensajeError += `Hubo un problema técnico con la entrega automática.
Un vendedor se pondrá en contacto contigo pronto.
🎫 *Ticket:* #${ticketId}

📧 Soporte: https://t.me/cubanvipmod`;
              }
              
              await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeError);
              console.log(`📧 Mensaje de error enviado al cliente para ticket #${ticketId}`);
              
            } catch (notifyError) {
              console.error('❌ Error enviando notificación de error al cliente:', notifyError.message);
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error en entrega para ticket #${ticketId}:`, error);
      }
    }
    
    // Manejar rechazo - Enviar advertencia al cliente
    if (accion === 'RECHAZADO') {
      try {
        console.log(`❌ Enviando mensaje de rechazo al cliente para ticket #${ticketId}`);
        
        // Obtener país del ticket
        const paisCliente = ticket.pais || 'tu país';
        
        // Crear mensaje de advertencia
        const mensajeRechazo = `❌ *PAGO RECHAZADO* ❌

🚫 Tu pago de ${paisCliente} es falso.

⚠️ *ADVERTENCIA:*
📋 Envía un pago REAL o serás bloqueado la siguiente vez.
🔒 Próximo pago falso = BLOQUEO PERMANENTE

💰 Realiza un pago válido para obtener tu producto.
📱 Contacta a tu vendedor si tienes dudas.

🧾 *TU COMPROBANTE FALSO:*
${ticket.comprobante || 'No se proporcionó comprobante'}

❌ *ESTE COMPROBANTE ES FALSO* ❌`;

        // Corregir formato del número de teléfono
        let numeroCorregido = ticket.wa_id.replace(/[+\s]/g, '');
        if (numeroCorregido.startsWith('52') && numeroCorregido.length === 12) {
          numeroCorregido = numeroCorregido.substring(0, 2) + '1' + numeroCorregido.substring(2);
        }
        
        // Enviar mensaje de rechazo al cliente
        console.log(`📱 Enviando advertencia de rechazo a: ${numeroCorregido}@c.us`);
        await enviarMensajeSeguro(`${numeroCorregido}@c.us`, mensajeRechazo);
        console.log(`✅ Mensaje de rechazo enviado al cliente #${ticketId}`);
        
      } catch (error) {
        console.error(`❌ Error enviando mensaje de rechazo para ticket #${ticketId}:`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Ticket #${ticketId} procesado como ${accion}`,
      ticket_id: ticketId,
      accion: accion,
      autor: autor,
      producto_entregado: accion === 'APROBADO'
    });
  } else {
    res.status(404).json({
      success: false,
      message: `Ticket #${ticketId} no encontrado`,
      ticket_id: ticketId
    });
  }
});

// Endpoint de salud del sistema
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Ticket Authorization System',
    timestamp: new Date().toISOString(),
    grupos_detectados: Object.keys(gruposDetectados).length,
    tickets_pendientes: ticketsPendientes.size
  });
});

// Endpoint de diagnóstico de APIs
app.get('/diagnostico-apis', async (req, res) => {
  try {
    const diagnostico = {
      timestamp: new Date().toISOString(),
      apis: {
        product_data: {
          url: 'https://cubanhacks.com/api/get_product_data.php',
          status: 'unknown',
          auth_configured: true,
          api_key: 'cuban_whapi_bot_2024'
        },
        balance: {
          url: 'https://cubanhacks.com/api/add_balance_by_username.php',
          status: 'unknown',
          auth_configured: true,
          api_key: 'cuban_whapi_bot_2024'
        }
      },
      whatsapp: {
        conectado: false,
        estado: 'unknown'
      }
    };

    // Verificar estado de WhatsApp
    try {
      const estadoWA = await verificarEstadoCliente();
      diagnostico.whatsapp = estadoWA;
    } catch (error) {
      diagnostico.whatsapp.error = error.message;
    }

    // Test básico de API de productos (solo verificar conectividad)
    try {
      const testResponse = await fetch('https://cubanhacks.com/api/get_product_data.php?diagnostico=productos', {
        method: 'GET',
        headers: {
          'X-API-Key': 'cuban_whapi_bot_2024',
          'User-Agent': 'Cuban-WhatsApp-Bot/1.0'
        },
        timeout: 5000
      });
      
      if (testResponse.ok) {
        diagnostico.apis.product_data.status = 'conectado';
        const testData = await testResponse.json();
        if (testData.status === 'success') {
          diagnostico.apis.product_data.productos_disponibles = testData.total_productos;
        }
      } else {
        diagnostico.apis.product_data.status = `error_${testResponse.status}`;
      }
    } catch (error) {
      diagnostico.apis.product_data.status = 'error';
      diagnostico.apis.product_data.error = error.message;
    }

    res.json(diagnostico);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error en diagnóstico',
      error: error.message
    });
  }
});

// Endpoint para verificar estado de WhatsApp y detectar grupos
app.get('/estado-whatsapp', async (req, res) => {
  try {
    const estado = {
      timestamp: new Date().toISOString(),
      whatsapp: {},
      grupos: {
        total_detectados: Object.keys(gruposDetectados).length,
        grupos_configurados: gruposDetectados
      }
    };

    // Verificar estado de WhatsApp
    try {
      const estadoWA = await verificarEstadoCliente();
      estado.whatsapp = estadoWA;
    } catch (error) {
      estado.whatsapp = {
        conectado: false,
        estado: 'ERROR',
        error: error.message
      };
    }

    res.json(estado);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Error verificando estado de WhatsApp',
      error: error.message
    });
  }
});

// Endpoint para forzar detección de grupos
app.post('/detectar-grupos-manual', async (req, res) => {
  try {
    console.log('🔄 Detección manual de grupos solicitada desde API...');
    const grupos = await detectarGrupos();
    
    res.json({
      success: true,
      message: 'Detección de grupos completada',
      grupos_detectados: grupos.length,
      grupos: grupos.map(g => ({ 
        nombre: g.name, 
        id: g.id._serialized 
      })),
      grupos_configurados: gruposDetectados,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error en detección manual de grupos:', error);
    res.status(500).json({
      success: false,
      message: 'Error en detección manual de grupos',
      error: error.message
    });
  }
});

// Endpoint para probar configuración de grupos por país
app.post('/test-grupos-paises', async (req, res) => {
  try {
    console.log('🧪 Iniciando test de configuración de grupos por países...');
    
    // Verificar que WhatsApp esté conectado
    const estadoWA = await verificarEstadoCliente();
    if (!estadoWA.conectado) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp no está conectado. No se puede realizar el test.',
        whatsapp_estado: estadoWA
      });
    }
    
    // Números de ejemplo para cada país
    const numerosTest = {
      '52': '+52 55 1234 5678',    // México
      '57': '+57 301 234 5678',    // Colombia  
      '51': '+51 987 654 321',     // Perú
      '56': '+56 9 8765 4321',     // Chile
      '1809': '+1 809 234 5678',   // República Dominicana
      '1': '+1 305 234 5678',      // Estados Unidos (Zelle)
      '591': '+591 7 234 5678',    // Bolivia
      '593': '+593 98 765 4321',   // Ecuador
      '54': '+54 11 2345 6789',    // Argentina
      '58': '+58 412 345 6789',    // Venezuela
      '502': '+502 1234 5678',     // Guatemala
      '503': '+503 7654 3210',     // El Salvador
      '504': '+504 9876 5432',     // Honduras
      '505': '+505 8765 4321',     // Nicaragua
      '506': '+506 1234 5678',     // Costa Rica
      '507': '+507 1234 5678'      // Panamá
    };
    
    const resultados = [];
    const errores = [];
    
    // Probar cada país configurado
    for (const [prefijo, configuracion] of Object.entries(gruposPaises.grupos)) {
      const numeroEjemplo = numerosTest[prefijo] || `+${prefijo} 123456789`;
      const grupoInfo = obtenerGrupoPais(prefijo);
      
      console.log(`🧪 Testing ${configuracion.nombre} (${prefijo}) → ${grupoInfo.grupo_id}`);
      
      const resultado = {
        prefijo: prefijo,
        pais: configuracion.nombre,
        numero_ejemplo: numeroEjemplo,
        grupo_id: grupoInfo.grupo_id,
        grupo_nombre: grupoInfo.nombre,
        status: 'unknown'
      };
      
      // Verificar si el grupo existe
      if (!grupoInfo.grupo_id || grupoInfo.grupo_id === 'default_group_id') {
        resultado.status = 'sin_configurar';
        resultado.error = 'Grupo no configurado o ID por defecto';
        errores.push(resultado);
      } else {
        try {
          // Crear mensaje de prueba
          const mensajePrueba = `🧪 *TEST DE CONFIGURACIÓN*

📍 País: ${configuracion.nombre}
📱 Prefijo: +${prefijo}
📞 Ejemplo: ${numeroEjemplo}
🎫 Test ID: #TEST${Date.now()}

✅ Este grupo está correctamente configurado para recibir tickets de ${configuracion.nombre}

⚠️ *ESTO ES SOLO UNA PRUEBA* ⚠️`;

          // Enviar mensaje de prueba
          await enviarMensajeSeguro(grupoInfo.grupo_id, mensajePrueba);
          
          resultado.status = 'enviado';
          resultado.mensaje = 'Mensaje de prueba enviado exitosamente';
          
          console.log(`✅ Test enviado a ${configuracion.nombre}: ${grupoInfo.grupo_id}`);
          
          // Pequeña pausa entre envíos
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error) {
          resultado.status = 'error';
          resultado.error = error.message;
          errores.push(resultado);
          
          console.log(`❌ Error enviando test a ${configuracion.nombre}: ${error.message}`);
        }
      }
      
      resultados.push(resultado);
    }
    
    // Estadísticas del test
    const stats = {
      total_paises: resultados.length,
      enviados_exitosamente: resultados.filter(r => r.status === 'enviado').length,
      sin_configurar: resultados.filter(r => r.status === 'sin_configurar').length,
      con_errores: resultados.filter(r => r.status === 'error').length
    };
    
    console.log('🧪 Test de grupos completado:');
    console.log(`   ✅ Enviados: ${stats.enviados_exitosamente}`);
    console.log(`   ⚠️ Sin configurar: ${stats.sin_configurar}`);
    console.log(`   ❌ Con errores: ${stats.con_errores}`);
    
    res.json({
      success: true,
      message: 'Test de configuración de grupos completado',
      estadisticas: stats,
      resultados: resultados,
      errores: errores.length > 0 ? errores : undefined,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en test de grupos:', error);
    res.status(500).json({
      success: false,
      message: 'Error ejecutando test de grupos',
      error: error.message
    });
  }
});

// Endpoint para verificar configuración de países (sin enviar mensajes)
app.get('/configuracion-paises', async (req, res) => {
  try {
    const configuracion = [];
    
    // Números de ejemplo para cada país
    const numerosTest = {
      '52': '+52 55 1234 5678',    // México
      '57': '+57 301 234 5678',    // Colombia  
      '51': '+51 987 654 321',     // Perú
      '56': '+56 9 8765 4321',     // Chile
      '1809': '+1 809 234 5678',   // República Dominicana
      '1': '+1 305 234 5678',      // Estados Unidos (Zelle)
      '591': '+591 7 234 5678',    // Bolivia
      '593': '+593 98 765 4321',   // Ecuador
      '54': '+54 11 2345 6789',    // Argentina
      '58': '+58 412 345 6789',    // Venezuela
      '502': '+502 1234 5678',     // Guatemala
      '503': '+503 7654 3210',     // El Salvador
      '504': '+504 9876 5432',     // Honduras
      '505': '+505 8765 4321',     // Nicaragua
      '506': '+506 1234 5678',     // Costa Rica
      '507': '+507 1234 5678'      // Panamá
    };
    
    // Revisar cada país configurado
    for (const [prefijo, info] of Object.entries(gruposPaises.grupos)) {
      const numeroEjemplo = numerosTest[prefijo] || `+${prefijo} 123456789`;
      const grupoInfo = obtenerGrupoPais(prefijo);
      
      // Detectar problema: verificar si el prefijo se detecta correctamente
      const prefijoDetectado = obtenerPrefijoPais(numeroEjemplo);
      
      const item = {
        prefijo_configurado: prefijo,
        pais: info.nombre,
        numero_ejemplo: numeroEjemplo,
        prefijo_detectado: prefijoDetectado,
        coincide_deteccion: prefijo === prefijoDetectado,
        grupo_configurado: {
          id: grupoInfo.grupo_id,
          nombre: grupoInfo.nombre
        },
        estado: 'ok'
      };
      
      // Verificar problemas
      if (prefijo !== prefijoDetectado) {
        item.estado = 'error_deteccion';
        item.problema = `El prefijo ${prefijo} no se detecta correctamente con el número de ejemplo`;
      } else if (!grupoInfo.grupo_id || grupoInfo.grupo_id === 'default_group_id') {
        item.estado = 'sin_grupo';
        item.problema = 'No tiene grupo configurado o usa grupo por defecto';
      } else if (!gruposDetectados[grupoInfo.nombre] && grupoInfo.grupo_id !== 'default_group_id') {
        item.estado = 'grupo_no_detectado';
        item.problema = 'El grupo configurado no fue detectado en WhatsApp';
      }
      
      configuracion.push(item);
    }
    
    // Estadísticas
    const stats = {
      total_paises: configuracion.length,
      correctos: configuracion.filter(c => c.estado === 'ok').length,
      error_deteccion: configuracion.filter(c => c.estado === 'error_deteccion').length,
      sin_grupo: configuracion.filter(c => c.estado === 'sin_grupo').length,
      grupo_no_detectado: configuracion.filter(c => c.estado === 'grupo_no_detectado').length
    };
    
    res.json({
      success: true,
      message: 'Configuración de países obtenida',
      estadisticas: stats,
      configuracion: configuracion,
      grupos_detectados_whatsapp: Object.keys(gruposDetectados).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo configuración de países:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo configuración de países',
      error: error.message
    });
  }
});

// Endpoint para simular detección de país desde un número
app.post('/simular-ticket-pais', async (req, res) => {
  try {
    const { numero } = req.body;
    
    if (!numero) {
      return res.status(400).json({
        success: false,
        message: 'Número de teléfono es requerido'
      });
    }
    
    console.log(`🧪 Simulando ticket para número: ${numero}`);
    
    // Simular detección de país
    const prefijoDetectado = obtenerPrefijoPais(numero);
    const grupoInfo = obtenerGrupoPais(prefijoDetectado);
    
    const simulacion = {
      numero_original: numero,
      numero_limpio: numero.replace(/\D/g, ''),
      prefijo_detectado: prefijoDetectado,
      pais_asignado: grupoInfo.nombre,
      grupo_destino: {
        id: grupoInfo.grupo_id,
        nombre: grupoInfo.nombre
      },
      timestamp: new Date().toISOString()
    };
    
    // Verificar si el grupo existe
    let problema = null;
    if (!grupoInfo.grupo_id || grupoInfo.grupo_id === 'default_group_id') {
      problema = 'El país detectado no tiene grupo configurado';
    } else if (!gruposDetectados[grupoInfo.nombre] && grupoInfo.grupo_id !== 'default_group_id') {
      problema = 'El grupo configurado no fue detectado en WhatsApp';
    }
    
    if (problema) {
      simulacion.problema = problema;
      simulacion.estado = 'error';
    } else {
      simulacion.estado = 'ok';
    }
    
    console.log(`📊 Resultado simulación: ${numero} → ${grupoInfo.nombre} (${grupoInfo.grupo_id})`);
    
    res.json({
      success: true,
      message: 'Simulación de ticket completada',
      simulacion: simulacion
    });
    
  } catch (error) {
    console.error('❌ Error simulando ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error simulando ticket',
      error: error.message
    });
  }
});

// Endpoint para enviar mensajes directos
app.post('/enviar-mensaje', async (req, res) => {
  try {
    const { numero, mensaje } = req.body;
    
    if (!numero || !mensaje) {
      return res.status(400).json({ 
        success: false, 
        message: 'Número y mensaje son requeridos' 
      });
    }

    console.log(`📱 Enviando mensaje directo a: ${numero}`);
    
    // Formatear número
    const numeroFormateado = numero.includes('@') ? numero : `${numero}@c.us`;
    
    await enviarMensajeSeguro(numeroFormateado, mensaje);
    
    console.log(`✅ Mensaje enviado exitosamente a ${numero}`);
    
    res.json({ 
      success: true, 
      message: 'Mensaje enviado exitosamente',
      numero: numero
    });

  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error enviando mensaje: ' + error.message 
    });
  }
});

// Endpoint para probar envío de mensajes con imagen
app.post('/test-imagen', async (req, res) => {
  try {
    const { numero, mensaje, url_imagen } = req.body;
    
    if (!numero || !mensaje || !url_imagen) {
      return res.status(400).json({
        success: false,
        message: 'Número, mensaje y URL de imagen son requeridos'
      });
    }
    
    console.log(`🧪 Test de imagen solicitado:`);
    console.log(`   📱 Número: ${numero}`);
    console.log(`   📝 Mensaje: ${mensaje}`);
    console.log(`   🔗 URL Imagen: ${url_imagen}`);
    
    // Formatear número
    const numeroFormateado = numero.includes('@') ? numero : `${numero}@c.us`;
    const nombreImagen = `test_${Date.now()}.jpg`;
    
    // Enviar mensaje con imagen
    const resultado = await enviarMensajeConImagen(numeroFormateado, mensaje, url_imagen, nombreImagen);
    
    res.json({
      success: resultado,
      message: resultado ? 'Mensaje con imagen enviado exitosamente' : 'Error enviando mensaje con imagen',
      numero_formateado: numeroFormateado,
      url_imagen: url_imagen
    });
    
  } catch (error) {
    console.error('❌ Error en test de imagen:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error en test de imagen',
      error: error.message
    });
  }
});

// Función para intentar detectar grupos con reintentos
async function inicializarDeteccionGrupos() {
  // Si no hay cliente (Railway), no intentar detectar grupos
  if (!client) {
    console.log('⚠️ WhatsApp no disponible en Railway - Saltando detección de grupos');
    return;
  }

  const maxIntentos = 5;
  const tiempoEspera = 15000; // 15 segundos entre intentos
  
  for (let intento = 1; intento <= maxIntentos; intento++) {
    console.log(`🔄 Intento ${intento}/${maxIntentos} de detección de grupos...`);
    
    try {
      const grupos = await detectarGrupos();
      if (grupos.length > 0) {
        console.log(`✅ Detección de grupos completada exitosamente (${grupos.length} grupos)`);
        return;
      } else {
        console.log(`⚠️ Intento ${intento}: No se detectaron grupos`);
      }
    } catch (error) {
      console.log(`❌ Intento ${intento} falló:`, error.message);
    }
    
    // Esperar antes del siguiente intento (excepto en el último)
    if (intento < maxIntentos) {
      console.log(`⏰ Esperando ${tiempoEspera/1000} segundos antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, tiempoEspera));
    }
  }
  
  console.log('⚠️ No se pudieron detectar grupos después de todos los intentos');
  console.log('📱 Verifica que WhatsApp Web esté conectado correctamente');
}

// ===== SISTEMA DE COMANDOS INTERNOS DE WHATSAPP =====

// Lista de administradores autorizados (agregar más números según necesites)
const ADMINS_AUTORIZADOS = [
  // Agregar aquí los números de WhatsApp de administradores
  // Ejemplo: '5491123456789@c.us'
];

// Función para verificar si un usuario es administrador
function esAdministrador(numeroUsuario) {
  // Por ahora, permitir a cualquier usuario en privado (cambiar según necesidades)
  // return ADMINS_AUTORIZADOS.includes(numeroUsuario);
  return true; // Cambiar por verificación real si se necesita
}

// Función para procesar comandos internos
async function procesarComandoInterno(mensaje, numeroRemitente) {
  const texto = mensaje.body.toLowerCase().trim();
  
  if (!texto.startsWith('/')) {
    return false; // No es un comando
  }
  
  console.log(`🤖 Comando recibido de ${numeroRemitente}: ${texto}`);
  
  try {
    if (texto === '/testpaises') {
      await comandoTestPaises(numeroRemitente);
    } else if (texto === '/configpaises') {
      await comandoConfigPaises(numeroRemitente);
    } else if (texto.startsWith('/simular ')) {
      const numero = texto.replace('/simular ', '').trim();
      await comandoSimularTicket(numeroRemitente, numero);
    } else if (texto === '/estado') {
      await comandoEstadoSistema(numeroRemitente);
    } else if (texto === '/grupos') {
      await comandoDetectarGrupos(numeroRemitente);
    } else if (texto.startsWith('/verificar')) {
      await comandoVerificar(numeroRemitente, texto);
    } else if (texto === '/auditoria' || texto === '/audit') {
      await comandoAuditoria(numeroRemitente);
    } else if (texto === '/ayuda' || texto === '/help') {
      await comandoAyuda(numeroRemitente);
    } else {
      await enviarMensajeSeguro(numeroRemitente, `❌ Comando desconocido: ${texto}\n\nUsa /ayuda para ver comandos disponibles.`);
    }
    
    return true; // Comando procesado
  } catch (error) {
    console.error(`❌ Error procesando comando ${texto}:`, error.message);
    await enviarMensajeSeguro(numeroRemitente, `❌ Error ejecutando comando: ${error.message}`);
    return true;
  }
}

// Comando: /testpaises
async function comandoTestPaises(numeroRemitente) {
  await enviarMensajeSeguro(numeroRemitente, `🧪 *INICIANDO TEST DE PAÍSES*\n\nVerificando configuración de grupos...\n⏳ Esto puede tomar unos segundos...`);
  
  try {
    // Verificar estado de WhatsApp
    const estadoWA = await verificarEstadoCliente();
    if (!estadoWA.conectado) {
      await enviarMensajeSeguro(numeroRemitente, `❌ *ERROR*\n\nWhatsApp no está conectado.\nEstado: ${estadoWA.estado}`);
      return;
    }
    
    const resultados = [];
    const errores = [];
    
    // Números de ejemplo para cada país
    const numerosTest = {
      '52': '+52 55 1234 5678',    // México
      '57': '+57 301 234 5678',    // Colombia  
      '51': '+51 987 654 321',     // Perú
      '56': '+56 9 8765 4321',     // Chile
      '1809': '+1 809 234 5678',   // República Dominicana
      '1': '+1 305 234 5678',      // Estados Unidos (Zelle)
      '591': '+591 7 234 5678',    // Bolivia
      '593': '+593 98 765 4321',   // Ecuador
      '54': '+54 11 2345 6789',    // Argentina
      '58': '+58 412 345 6789',    // Venezuela
      '502': '+502 1234 5678',     // Guatemala
      '503': '+503 7654 3210',     // El Salvador
      '504': '+504 9876 5432',     // Honduras
      '505': '+505 8765 4321',     // Nicaragua
      '506': '+506 1234 5678',     // Costa Rica
      '507': '+507 1234 5678'      // Panamá
    };
    
    // Probar cada país
    for (const [prefijo, configuracion] of Object.entries(gruposPaises.grupos)) {
      const numeroEjemplo = numerosTest[prefijo] || `+${prefijo} 123456789`;
      const grupoInfo = obtenerGrupoPais(prefijo);
      
      const resultado = {
        prefijo: prefijo,
        pais: configuracion.nombre,
        numero_ejemplo: numeroEjemplo,
        grupo_id: grupoInfo.grupo_id,
        status: 'unknown'
      };
      
      if (!grupoInfo.grupo_id || grupoInfo.grupo_id === 'default_group_id') {
        resultado.status = 'sin_configurar';
        resultado.error = 'Grupo no configurado';
        errores.push(resultado);
      } else {
        resultado.status = 'configurado';
      }
      
      resultados.push(resultado);
    }
    
    // Generar reporte
    const stats = {
      total: resultados.length,
      configurados: resultados.filter(r => r.status === 'configurado').length,
      sin_configurar: resultados.filter(r => r.status === 'sin_configurar').length
    };
    
    let reporte = `📊 *REPORTE DE CONFIGURACIÓN*\n\n`;
    reporte += `📈 *Estadísticas:*\n`;
    reporte += `• Total países: ${stats.total}\n`;
    reporte += `• ✅ Configurados: ${stats.configurados}\n`;
    reporte += `• ❌ Sin configurar: ${stats.sin_configurar}\n\n`;
    
    if (stats.configurados > 0) {
      reporte += `✅ *PAÍSES CONFIGURADOS:*\n`;
      resultados.filter(r => r.status === 'configurado').forEach(r => {
        reporte += `• ${r.pais} (+${r.prefijo})\n`;
      });
      reporte += `\n`;
    }
    
    if (errores.length > 0) {
      reporte += `❌ *PAÍSES CON PROBLEMAS:*\n`;
      errores.forEach(r => {
        reporte += `• ${r.pais} (+${r.prefijo}): ${r.error}\n`;
      });
      reporte += `\n`;
    }
    
    reporte += `🤖 Test completado: ${new Date().toLocaleString('es-ES')}`;
    
    await enviarMensajeSeguro(numeroRemitente, reporte);
    
  } catch (error) {
    await enviarMensajeSeguro(numeroRemitente, `❌ *ERROR EN TEST*\n\n${error.message}`);
  }
}

// Comando: /configpaises
async function comandoConfigPaises(numeroRemitente) {
  try {
    let mensaje = `🌍 *CONFIGURACIÓN DE PAÍSES*\n\n`;
    
    for (const [prefijo, info] of Object.entries(gruposPaises.grupos)) {
      const grupoInfo = obtenerGrupoPais(prefijo);
      const estado = (!grupoInfo.grupo_id || grupoInfo.grupo_id === 'default_group_id') ? '❌' : '✅';
      
      mensaje += `${estado} *${info.nombre}*\n`;
      mensaje += `   Prefijo: +${prefijo}\n`;
      mensaje += `   Grupo: ${grupoInfo.nombre}\n\n`;
    }
    
    mensaje += `📊 Grupos detectados en WhatsApp: ${Object.keys(gruposDetectados).length}`;
    
    await enviarMensajeSeguro(numeroRemitente, mensaje);
  } catch (error) {
    await enviarMensajeSeguro(numeroRemitente, `❌ Error: ${error.message}`);
  }
}

// Comando: /simular +numero
async function comandoSimularTicket(numeroRemitente, numero) {
  if (!numero) {
    await enviarMensajeSeguro(numeroRemitente, `❌ *USO INCORRECTO*\n\nUsa: /simular +502 1234 5678\n\nEjemplo para Guatemala:\n/simular +502 1234 5678`);
    return;
  }
  
  try {
    const prefijoDetectado = obtenerPrefijoPais(numero);
    const grupoInfo = obtenerGrupoPais(prefijoDetectado);
    
    let mensaje = `🧪 *SIMULACIÓN DE TICKET*\n\n`;
    mensaje += `📱 *Número:* ${numero}\n`;
    mensaje += `🔍 *Prefijo detectado:* +${prefijoDetectado}\n`;
    mensaje += `🌍 *País asignado:* ${grupoInfo.nombre}\n`;
    mensaje += `📡 *Grupo destino:* ${grupoInfo.grupo_id === 'default_group_id' ? '❌ Sin configurar' : '✅ ' + grupoInfo.nombre}\n\n`;
    
    if (grupoInfo.grupo_id === 'default_group_id') {
      mensaje += `⚠️ *PROBLEMA DETECTADO*\nEste país no tiene grupo configurado.`;
    } else {
      mensaje += `✅ *TODO CORRECTO*\nEl ticket se enviaría correctamente.`;
    }
    
    await enviarMensajeSeguro(numeroRemitente, mensaje);
  } catch (error) {
    await enviarMensajeSeguro(numeroRemitente, `❌ Error: ${error.message}`);
  }
}

// Comando: /estado
async function comandoEstadoSistema(numeroRemitente) {
  try {
    const estadoWA = await verificarEstadoCliente();
    
    let mensaje = `📊 *ESTADO DEL SISTEMA*\n\n`;
    mensaje += `📱 *WhatsApp:* ${estadoWA.conectado ? '✅ Conectado' : '❌ Desconectado'}\n`;
    mensaje += `🏷️ *Estado:* ${estadoWA.estado}\n`;
    mensaje += `👥 *Grupos detectados:* ${Object.keys(gruposDetectados).length}\n`;
    mensaje += `🎫 *Tickets pendientes:* ${ticketsPendientes.size}\n`;
    mensaje += `📝 *Reportes en memoria:* ${reportesRecientes.size}\n\n`;
    mensaje += `⏰ *Último check:* ${new Date().toLocaleString('es-ES')}`;
    
    await enviarMensajeSeguro(numeroRemitente, mensaje);
  } catch (error) {
    await enviarMensajeSeguro(numeroRemitente, `❌ Error: ${error.message}`);
  }
}

// Comando: /grupos
async function comandoDetectarGrupos(numeroRemitente) {
  await enviarMensajeSeguro(numeroRemitente, `🔍 *DETECTANDO GRUPOS*\n\nEsto puede tomar unos segundos...`);
  
  try {
    const grupos = await detectarGrupos();
    
    let mensaje = `📋 *GRUPOS DETECTADOS*\n\n`;
    mensaje += `📊 *Total encontrados:* ${grupos.length}\n\n`;
    
    if (grupos.length > 0) {
      mensaje += `📝 *Lista de grupos:*\n`;
      grupos.slice(0, 10).forEach((grupo, index) => {
        mensaje += `${index + 1}. ${grupo.name}\n`;
      });
      
      if (grupos.length > 10) {
        mensaje += `... y ${grupos.length - 10} más\n`;
      }
    } else {
      mensaje += `⚠️ No se detectaron grupos.\nVerifica la conexión de WhatsApp.`;
    }
    
    await enviarMensajeSeguro(numeroRemitente, mensaje);
  } catch (error) {
    await enviarMensajeSeguro(numeroRemitente, `❌ Error detectando grupos: ${error.message}`);
  }
}



// Comando: /verificar
async function comandoVerificar(numeroRemitente, texto) {
  const producto = texto.replace('/verificar', '').trim();
  
  if (!producto) {
    const ayuda = `🔍 *VERIFICAR PRODUCTO*

*Uso:* /verificar [nombre del producto]

*Ejemplos:*
• /verificar Cuban Vip 30 Dias
• /verificar Drip Mobile 15 Dias  
• /verificar socio

🎯 *Función:* Verifica qué tutorial y mensaje se enviaría (sin entregar realmente)`;
    
    await enviarMensajeSeguro(numeroRemitente, ayuda);
    return;
  }

  try {
    console.log(`🤖 Comando /verificar recibido para: ${producto}`);
    const resultado = verificarEntregaProducto(producto);
    
    const respuesta = `🔍 *VERIFICACIÓN DE PRODUCTO*

📦 *Producto:* ${resultado.producto}
🎯 *Tutorial:* ${resultado.tutorialAlias}
📋 *Estado:* ${resultado.estaMapeado ? '✅ MAPEADO' : '❌ NO MAPEADO'}
🔗 *URL:* ${resultado.tutorialUrl}

📱 *Vista previa del mensaje:*
${resultado.mensaje.substring(0, 300)}...

✅ Verificación completada`;

    await enviarMensajeSeguro(numeroRemitente, respuesta);
  } catch (error) {
    console.error(`❌ Error en comando verificar:`, error.message);
    await enviarMensajeSeguro(numeroRemitente, `❌ Error verificando producto: ${error.message}`);
  }
}

// Comando: /auditoria - Auditoría completa de todos los productos
async function comandoAuditoria(numeroRemitente) {
  try {
    await enviarMensajeSeguro(numeroRemitente, `🧪 *INICIANDO AUDITORÍA COMPLETA*

📊 Verificando TODOS los productos activos...
⏳ Esto puede tomar unos segundos...

🎯 Te diré exactamente qué va a entregar cada producto sin entregarlos realmente.`);

    console.log(`🤖 Comando /auditoria recibido de: ${numeroRemitente}`);
    const resultado = auditoriaTodosLosProductos();
    
    let respuesta = `🧪 *AUDITORÍA COMPLETA TERMINADA*

📊 *RESUMEN:*
• Total productos: ${resultado.total}
• ✅ Mapeados: ${resultado.mapeados}
• ❌ NO mapeados: ${resultado.noMapeados}
• 📈 Porcentaje: ${resultado.porcentaje}%

`;

    if (resultado.productosProblema.length > 0) {
      respuesta += `⚠️ *PRODUCTOS SIN MAPEAR:*\n`;
      resultado.productosProblema.slice(0, 10).forEach(p => {
        respuesta += `• ${p.producto}\n`;
      });
      
      if (resultado.productosProblema.length > 10) {
        respuesta += `... y ${resultado.productosProblema.length - 10} más\n`;
      }
    } else {
      respuesta += `🎉 *¡PERFECTO!* Todos los productos están mapeados correctamente.\n`;
    }

    respuesta += `\n✅ *Auditoría completada*\n📋 Revisa los logs para detalles completos.`;

    await enviarMensajeSeguro(numeroRemitente, respuesta);
  } catch (error) {
    console.error(`❌ Error en comando auditoría:`, error.message);
    await enviarMensajeSeguro(numeroRemitente, `❌ Error en auditoría: ${error.message}`);
  }
}

// Comando: /ayuda
async function comandoAyuda(numeroRemitente) {
  const ayuda = `🤖 *COMANDOS DISPONIBLES*

📊 *DIAGNÓSTICO:*
• /testpaises - Test completo de países
• /configpaises - Ver configuración actual
• /estado - Estado del sistema
• /grupos - Detectar grupos de WhatsApp

🧪 *TESTING PRODUCTOS:*
• /verificar [producto] - Verificar un producto específico
  Ejemplo: /verificar Cuban Vip 30 Dias
• /auditoria - Auditoría completa de TODOS los productos
  (Revisa qué va a entregar cada producto activo)

🧪 *TESTING PAÍSES:*
• /simular +numero - Simular ticket
  Ejemplo: /simular +502 1234 5678

❓ *AYUDA:*
• /ayuda - Mostrar esta ayuda

💡 *Uso:* Envía cualquier comando como mensaje privado al bot.`;

  await enviarMensajeSeguro(numeroRemitente, ayuda);
}

// Listener de mensajes de WhatsApp
if (client) {
  client.on('message', async (mensaje) => {
    try {
      // Solo procesar mensajes directos (no de grupos)
      if (mensaje.from.includes('@g.us')) {
        return; // Ignorar mensajes de grupos
      }
      
      // Solo procesar comandos (que empiecen con /)
      if (!mensaje.body || !mensaje.body.startsWith('/')) {
        return;
      }
      
      // Verificar permisos (opcional)
      if (!esAdministrador(mensaje.from)) {
        await enviarMensajeSeguro(mensaje.from, `❌ No tienes permisos para usar comandos.`);
        return;
      }
      
      // Procesar comando
      await procesarComandoInterno(mensaje, mensaje.from);
      
    } catch (error) {
      console.error('❌ Error procesando mensaje:', error.message);
    }
  });
  
  console.log('🤖 Sistema de comandos internos activado');
  console.log('📝 Comandos disponibles: /testpaises, /configpaises, /simular, /estado, /grupos, /ayuda');
}

// Detectar grupos al iniciar el servidor con reintentos
setTimeout(async () => {
  await inicializarDeteccionGrupos();
}, 10000); // Esperar 10 segundos iniciales para que WhatsApp se conecte

// Limpieza automática de reportes duplicados cada 10 minutos
setInterval(() => {
  console.log('🧹 Ejecutando limpieza automática de reportes duplicados...');
  limpiarReportesAntiguos();
  console.log(`📊 Reportes activos en memoria: ${reportesRecientes.size}`);
}, 10 * 60 * 1000); // 10 minutos

// ===== ENDPOINTS WHAPI CLOUD =====

// Endpoint para verificar estado de WhAPI Cloud
app.get('/estado-whapi', async (req, res) => {
  try {
    const estadoWhAPI = await verificarEstadoWhAPI();
    const estadoWebJS = await verificarEstadoCliente();
    
    res.json({
      success: true,
      whapi_cloud: {
        enabled: WHAPI_CONFIG.ENABLED,
        channel_id: WHAPI_CONFIG.CHANNEL_ID,
        phone_number: WHAPI_CONFIG.PHONE_NUMBER,
        status: estadoWhAPI
      },
      whatsapp_webjs: {
        status: estadoWebJS
      },
      sistema_hibrido: {
        metodo_principal: WHAPI_CONFIG.ENABLED ? 'WhAPI Cloud' : 'WhatsApp Web.js',
        fallback_disponible: true
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para test de envío híbrido
app.post('/test-hibrido', async (req, res) => {
  try {
    const { numero, mensaje } = req.body;
    
    if (!numero || !mensaje) {
      return res.status(400).json({
        success: false,
        message: 'Número y mensaje son requeridos'
      });
    }
    
    console.log(`🧪 Test híbrido solicitado para: ${numero}`);
    
    const resultado = await enviarMensajeHibrido(numero, mensaje);
    
    res.json({
      success: resultado.success,
      method_used: resultado.method,
      attempts: resultado.intentos,
      error: resultado.error || null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para verificar mapeo de producto
app.get('/verificar-producto/:producto', (req, res) => {
  try {
    const producto = decodeURIComponent(req.params.producto);
    console.log(`🔍 Verificación de producto solicitada: ${producto}`);
    
    const resultado = verificarEntregaProducto(producto);
    
    res.json({
      success: true,
      producto: resultado.producto,
      tutorial_alias: resultado.tutorialAlias,
      tutorial_url: resultado.tutorialUrl,
      esta_mapeado: resultado.estaMapeado,
      mensaje_preview: resultado.mensaje.substring(0, 300) + '...',
      mensaje_completo: resultado.mensaje
    });
    
  } catch (error) {
    console.error('❌ Error en verificación de producto:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para auditoría completa de productos
app.get('/auditoria-productos', (req, res) => {
  try {
    console.log(`🧪 Auditoría completa solicitada`);
    
    const resultado = auditoriaTodosLosProductos();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      resumen: {
        total: resultado.total,
        mapeados: resultado.mapeados,
        no_mapeados: resultado.noMapeados,
        porcentaje: resultado.porcentaje
      },
      productos_mapeados: resultado.resultados.filter(r => r.estaMapeado),
      productos_sin_mapear: resultado.productosProblema,
      todos_los_resultados: resultado.resultados
    });
    
  } catch (error) {
    console.error('❌ Error en auditoría de productos:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========== ENDPOINT DE DIAGNÓSTICO ==========
app.get('/diagnostico', async (req, res) => {
    console.log('🔍 DIAGNÓSTICO INICIADO...');
    
    const diagnostico = {
        timestamp: new Date().toISOString(),
        variables_entorno: {
            WHAPI_TOKEN: process.env.WHAPI_TOKEN ? 'CONFIGURADO ✅' : 'FALTANTE ❌',
            WHAPI_CHANNEL: process.env.WHAPI_CHANNEL ? process.env.WHAPI_CHANNEL : 'FALTANTE ❌',
            NODE_ENV: process.env.NODE_ENV || 'NO CONFIGURADO',
            PORT: process.env.PORT || 'NO CONFIGURADO'
        },
        configuracion_whapi: {
            WHAPI_ENABLED: WHAPI_ENABLED,
            WHAPI_BASE_URL: WHAPI_BASE_URL,
            WHAPI_TOKEN_LENGTH: WHAPI_TOKEN ? WHAPI_TOKEN.length : 0,
            WHAPI_CHANNEL_VALUE: WHAPI_CHANNEL
        },
        tests: []
    };

    // Test 1: Verificar conexión a WhAPI
    try {
        console.log('🧪 Test 1: Verificando conexión WhAPI...');
        
        const testResponse = await fetch(`${WHAPI_BASE_URL}/account`, {
            headers: {
                'Authorization': `Bearer ${WHAPI_TOKEN}`
            }
        });
        
        const testData = await testResponse.text();
        diagnostico.tests.push({
            nombre: 'Conexión WhAPI',
            status: testResponse.status,
            resultado: testData.substring(0, 200) + '...',
            exito: testResponse.status === 200
        });
        
    } catch (error) {
        diagnostico.tests.push({
            nombre: 'Conexión WhAPI',
            status: 'ERROR',
            resultado: error.message,
            exito: false
        });
    }

    // Test 2: Envío directo de mensaje
    try {
        console.log('🧪 Test 2: Envío directo de mensaje...');
        const testMessage = {
            to: "120363418067354378@g.us",
            body: "🔍 DIAGNÓSTICO RAILWAY " + Date.now()
        };
        
        const messageResponse = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHAPI_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testMessage)
        });
        
        const messageResult = await messageResponse.text();
        diagnostico.tests.push({
            nombre: 'Envío mensaje directo',
            status: messageResponse.status,
            resultado: messageResult.substring(0, 300),
            exito: messageResponse.ok
        });
        
    } catch (error) {
        diagnostico.tests.push({
            nombre: 'Envío mensaje directo',
            status: 'ERROR',
            resultado: error.message,
            exito: false
        });
    }

    // Test 3: Función enviarMensajeWhAPI
    try {
        console.log('🧪 Test 3: Función enviarMensajeWhAPI...');
        const resultado = await enviarMensajeWhAPI("120363418067354378@g.us", "🧪 TEST FUNCIÓN " + Date.now());
        diagnostico.tests.push({
            nombre: 'Función enviarMensajeWhAPI',
            status: 'OK',
            resultado: JSON.stringify(resultado),
            exito: true
        });
    } catch (error) {
        diagnostico.tests.push({
            nombre: 'Función enviarMensajeWhAPI',
            status: 'ERROR',
            resultado: error.message,
            exito: false
        });
    }

    console.log('🔍 DIAGNÓSTICO COMPLETADO:', JSON.stringify(diagnostico, null, 2));
    res.json(diagnostico);
});

// ========== WEBHOOK PARA RESPUESTAS DE WHAPI CLOUD ==========
app.post('/webhook-whapi', async (req, res) => {
    try {
        console.log('📥 WEBHOOK RECIBIDO DE WHAPI CLOUD');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Body completo:', JSON.stringify(req.body, null, 2));
        
        // Respuesta inmediata para confirmar recepción
        res.status(200).json({ 
            status: 'received', 
            timestamp: new Date().toISOString(),
            bodyReceived: !!req.body 
        });
        
        // Procesar el mensaje después de responder
        setTimeout(async () => {
            try {
                const { messages } = req.body;
                
                if (messages && messages.length > 0) {
                    console.log(`📊 Procesando ${messages.length} mensajes`);
                    for (const message of messages) {
                        console.log(`📨 Mensaje individual:`, JSON.stringify(message, null, 2));
                        await procesarMensajeEntrante(message);
                    }
                } else {
                    console.log('⚠️ No se encontraron mensajes en el payload');
                    console.log('Estructura recibida:', Object.keys(req.body || {}));
                }
            } catch (procError) {
                console.error('❌ Error procesando mensaje:', procError.message);
            }
        }, 100);
        
    } catch (error) {
        console.error('❌ Error en webhook WhAPI:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========== ENDPOINT DE TEST WEBHOOK ==========
app.get('/webhook-whapi-test', (req, res) => {
    console.log('🧪 Test de webhook llamado');
    res.json({
        status: 'Webhook endpoint funcionando',
        url: '/webhook-whapi',
        method: 'POST',
        timestamp: new Date().toISOString()
    });
});

// Función para procesar mensajes entrantes del grupo
async function procesarMensajeEntrante(message) {
    try {
        const { from, body, chat_id, quoted_message } = message;
        
        // Solo procesar mensajes de grupos
        if (!chat_id || !chat_id.endsWith('@g.us')) {
            return;
        }
        
        // Solo procesar respuestas a mensajes (quoted_message)
        if (!quoted_message) {
            return;
        }
        
        const textoRespuesta = (body || '').trim();
        
        // Buscar si es aprobación o rechazo (múltiples formas)
        const esAprobacion = textoRespuesta === '✅' || 
                            textoRespuesta.toLowerCase().includes('aprobar') ||
                            textoRespuesta.toLowerCase().includes('aprobar ticket') ||
                            textoRespuesta.toLowerCase().includes('si') ||
                            textoRespuesta.toLowerCase().includes('ok');
                            
        const esRechazo = textoRespuesta === '❌' || 
                         textoRespuesta.toLowerCase().includes('rechazar') ||
                         textoRespuesta.toLowerCase().includes('rechazar ticket') ||
                         textoRespuesta.toLowerCase().includes('no') ||
                         textoRespuesta.toLowerCase().includes('cancel');
        
        if (esAprobacion) {
            await procesarAprobacion(quoted_message, from, chat_id);
        } else if (esRechazo) {
            await procesarRechazo(quoted_message, from, chat_id);
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje entrante:', error.message);
    }
}

// Función para procesar aprobación
async function procesarAprobacion(quotedMessage, administrador, grupoId) {
    try {
        console.log('✅ Procesando aprobación...');
        
        // Extraer número de ticket del mensaje original (múltiples formatos)
        const ticketMatch = quotedMessage.body.match(/(?:TICKET #|Ticket:\s*#)(\d+)/) || 
                           quotedMessage.body.match(/#(\d+)/);
        if (!ticketMatch) {
            console.log('❌ No se pudo extraer número de ticket');
            console.log('❌ Mensaje original:', quotedMessage.body);
            return;
        }
        
        const ticketId = ticketMatch[1];
        
        // Extraer datos del cliente del mensaje original
        const numeroMatch = quotedMessage.body.match(/(?:Número|Cliente):\s*([+\d\s]+)/);
        const productoMatch = quotedMessage.body.match(/Producto:\s*([^\n]+)/);
        const duracionMatch = quotedMessage.body.match(/Duración:\s*([^\n]+)/);
        
        if (!numeroMatch || !productoMatch) {
            console.log('❌ No se pudieron extraer datos del cliente');
            return;
        }
        
        const numeroCliente = numeroMatch[1].trim();
        const producto = productoMatch[1].trim();
        const duracion = duracionMatch ? duracionMatch[1].trim() : '';
        
        console.log(`✅ Aprobando ticket #${ticketId} para ${numeroCliente}`);
        
        // Enviar confirmación al grupo
        await enviarMensajeWhAPI(grupoId, `✅ *TICKET #${ticketId} APROBADO*\n👤 Administrador: ${administrador}\n📱 Cliente notificado y producto entregado`);
        
        // Procesar entrega del producto
        await entregarProductoAprobado(numeroCliente, producto, duracion, ticketId);
        
    } catch (error) {
        console.error('❌ Error procesando aprobación:', error.message);
    }
}

// Función para procesar rechazo
async function procesarRechazo(quotedMessage, administrador, grupoId) {
    try {
        console.log('❌ Procesando rechazo...');
        
        // Extraer número de ticket del mensaje original (múltiples formatos)
        const ticketMatch = quotedMessage.body.match(/(?:TICKET #|Ticket:\s*#)(\d+)/) || 
                           quotedMessage.body.match(/#(\d+)/);
        if (!ticketMatch) {
            console.log('❌ No se pudo extraer número de ticket');
            console.log('❌ Mensaje original:', quotedMessage.body);
            return;
        }
        
        const ticketId = ticketMatch[1];
        
        const numeroMatch = quotedMessage.body.match(/(?:Número|Cliente):\s*([+\d\s]+)/);
        if (!numeroMatch) {
            console.log('❌ No se pudo extraer número del cliente');
            return;
        }
        
        const numeroCliente = numeroMatch[1].trim();
        
        console.log(`❌ Rechazando ticket #${ticketId} para ${numeroCliente}`);
        
        // Enviar confirmación al grupo
        await enviarMensajeWhAPI(grupoId, `❌ *TICKET #${ticketId} RECHAZADO*\n👤 Administrador: ${administrador}\n📱 Cliente notificado`);
        
        // Notificar al cliente
        await enviarMensajeWhAPI(numeroCliente, `❌ *PAGO RECHAZADO*\n\n🎫 *Ticket:* #${ticketId}\n💬 *Motivo:* Tu comprobante de pago no fue aprobado.\n\n📞 Si crees que es un error, contacta a soporte.`);
        
    } catch (error) {
        console.error('❌ Error procesando rechazo:', error.message);
    }
}

// Función para entregar producto aprobado
async function entregarProductoAprobado(numeroCliente, producto, duracion, ticketId) {
    try {
        console.log(`🚀 Entregando producto: ${producto} a ${numeroCliente}`);
        
        // Actualizar balance del cliente
        await actualizarBalance(numeroCliente, producto, duracion);
        
        // Entregar producto (licencia/tutorial)
        await entregarProducto(numeroCliente, producto, duracion);
        
        console.log(`✅ Producto entregado exitosamente para ticket #${ticketId}`);
        
    } catch (error) {
        console.error(`❌ Error entregando producto para ticket #${ticketId}:`, error.message);
        
        // Notificar error al cliente
        await enviarMensajeWhAPI(numeroCliente, `⚠️ *PAGO APROBADO - ERROR EN ENTREGA*\n\n🎫 *Ticket:* #${ticketId}\n💬 Tu pago fue aprobado pero hubo un error en la entrega.\n\n📞 Contacta a soporte con el número de ticket.`);
    }
}

// ========== DIAGNÓSTICO PASO A PASO DE TICKET ==========
app.post('/diagnostico-ticket', async (req, res) => {
    console.log('🔍 INICIANDO DIAGNÓSTICO PASO A PASO...');
    
    const logs = [];
    const addLog = (paso, mensaje, data = null) => {
        const logEntry = { paso, mensaje, timestamp: new Date().toISOString(), data };
        logs.push(logEntry);
        console.log(`📋 [${paso}] ${mensaje}`, data || '');
    };
    
    try {
        addLog('INICIO', 'Recibiendo payload de test');
        
        // Payload de prueba similar a ManyChat
        const testPayload = {
            "Numero": "+5213333055098",
            "Producto": "netflix", 
            "Comprobante": "TEST DIAGNOSTICO DETALLADO",
            "Duracion o Cantidad": "30",
            "ID": "DIAG" + Date.now()
        };
        
        addLog('PAYLOAD', 'Payload procesado', testPayload);
        
        // Paso 1: Extraer campos
        const { Numero, Producto, Comprobante } = testPayload;
        addLog('EXTRACCION', 'Campos extraídos', { Numero, Producto, Comprobante });
        
        // Paso 2: Detectar país
        const prefijo = Numero.replace(/[^\d]/g, '').substring(0, 2);
        addLog('PREFIJO', 'Prefijo detectado', { prefijo });
        
        // Paso 3: Buscar grupo
        const grupoInfo = obtenerGrupoPais(prefijo);
        addLog('GRUPO', 'Grupo asignado', grupoInfo);
        
        // Paso 4: Generar mensaje
        const mensaje = `🎫 *TICKET DIAGNÓSTICO*
📱 *Número:* ${Numero}
📦 *Producto:* ${Producto}  
🧾 *Comprobante:* ${Comprobante}
⏰ *Timestamp:* ${new Date().toLocaleString()}`;
        addLog('MENSAJE', 'Mensaje generado', { mensaje });
        
        // Paso 5: Enviar via WhAPI
        addLog('ENVIO_INICIO', 'Iniciando envío via WhAPI...');
        
        const resultado = await enviarMensajeWhAPI(grupoInfo.grupo_id, mensaje);
        addLog('ENVIO_RESULTADO', 'Resultado del envío', { resultado });
        
        if (resultado) {
            addLog('EXITO', 'Ticket enviado exitosamente');
        } else {
            addLog('ERROR', 'Ticket falló al enviar');
        }
        
        // Respuesta con logs completos
        res.json({
            success: !!resultado,
            mensaje: resultado ? 'Diagnóstico completado exitosamente' : 'Diagnóstico falló',
            logs: logs,
            grupo_destino: grupoInfo.grupo_id,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        addLog('ERROR_CRITICO', 'Error durante diagnóstico', { error: error.message, stack: error.stack });
        
        res.status(500).json({
            success: false,
            error: error.message,
            logs: logs
        });
    }
});

app.listen(3000, () => {
  console.log('✅ Sistema de Tickets de Autorización escuchando en puerto 3000');
  console.log('🛡️ Sistema anti-duplicados activado (ventana de tiempo: 30 minutos)');
  console.log('🔐 APIs cubanhacks.com configuradas con autenticación');
  console.log('📸 Sistema de comprobantes con imágenes activado');
  console.log('🤖 Comandos WhatsApp internos activados');
  console.log('');
  console.log('📋 ENDPOINTS HTTP:');
  console.log('   📝 TICKETS:');
  console.log('     POST /reportar-ticket - Reportar nuevo ticket (soporta Foto de PAgo)');
  console.log('     GET  /estado-ticket/:id - Verificar estado de ticket');
  console.log('     GET  /tickets-pendientes - Listar tickets pendientes');
  console.log('     POST /procesar-ticket/:id - Procesar ticket (aprobar/rechazar)');
  console.log('   🚚 ENTREGA:');
  console.log('     POST /entrega-directa - Entrega directa de productos');
  console.log('     GET  /recibir-datos-zapier - Recibir datos de Zapier');
  console.log('   📱 WHATSAPP:');
  console.log('     POST /detectar-grupos - Detectar grupos automáticamente');
  console.log('     POST /detectar-grupos-manual - Forzar detección de grupos');
  console.log('     GET  /estado-whatsapp - Estado de conexión WhatsApp');
  console.log('     POST /enviar-mensaje - Enviar mensaje directo');
  console.log('     POST /test-imagen - Test de envío con imagen adjunta');
  console.log('     GET  /verificar-producto/:producto - Verificar mapeo de producto');
  console.log('     GET  /auditoria-productos - Auditoría completa de productos');
  console.log('   🧪 TESTING PAÍSES:');
  console.log('     POST /test-grupos-paises - Enviar mensaje test a cada país');
  console.log('     GET  /configuracion-paises - Ver configuración sin enviar');
  console.log('     POST /simular-ticket-pais - Simular ticket desde número');
  console.log('   🔧 DIAGNÓSTICO:');
  console.log('     GET  /health - Estado del sistema');
  console.log('     GET  /diagnostico-apis - Diagnóstico de APIs y conectividad');
  console.log('');
  console.log('💬 COMANDOS WHATSAPP (mensaje privado al bot):');
  console.log('   /testpaises - Test completo de países');
  console.log('   /configpaises - Ver configuración actual');
  console.log('   /simular +numero - Simular ticket (ej: /simular +502 1234 5678)');
  console.log('   /verificar [producto] - Verificar mapeo de producto');
  console.log('   /auditoria - Auditoría completa de TODOS los productos');
  console.log('   /estado - Estado del sistema');
  console.log('   /grupos - Detectar grupos');
  console.log('   /ayuda - Mostrar ayuda');
});

// Exportar funciones para testing
module.exports = {
  app,
  // convertirProductoAVariable - OBSOLETO (ahora mapeo directo)
  // obtenerTutorialAlias - OBSOLETO (automático en API)
};
