const fetch = require('node-fetch');
const { htmlToText } = require('html-to-text');
const config = require('./config-api');

// URLs configuradas según el entorno
const ZAPIER_WEBHOOK_URL = config.ZAPIER_WEBHOOK_URL;
const CUBANHACKS_API_URL = config.CUBANHACKS_API_URL;

console.log(`🔧 Configuración de Licencias cargada (${config.environment}):`);
console.log(`📡 Cuban Hacks API (PRINCIPAL): ${CUBANHACKS_API_URL}`);
console.log(`🎫 Zapier (SOLO TICKETS): ${ZAPIER_WEBHOOK_URL}`);
console.log(`🌐 Entrega de Licencias: 100% Cuban Hacks Database`);

// Mapeo de productos a tutorial_alias
const PRODUCTO_TO_TUTORIAL = {
  'dripsilent1': 'drip_silent_dll',
  'dripsilent10': 'drip_silent_dll',
  'dripsilent30': 'drip_silent_dll',
  'cuban8bp1': 'cuban_8bp',
  'cuban8bp7': 'cuban_8bp',
  'cuban8bp30': 'cuban_8bp',
  'dripaimkill1': 'aimkill',
  'dripaimkill5': 'aimkill',
  'dripaimkill7': 'aimkill',
  'easyvictory7': 'easy_victory',
  'autokill': 'autokill_t',
  'autokill20D': 'autokill_t',
  'autokillperma': 'autokill_t',
  'noroot': 'noroot_t',
  'noroot20D': 'noroot_t',
  'norootperma': 'noroot_t',
  'dripmobile1D': 'drip_mobile',
  'dripmobile15D': 'drip_mobile',
  'dripmobile30D': 'drip_mobile',
  'brmods1D': 'br_mods',
  'brmods30D': 'br_mods',
  'brbypass1D': 'br_mods',
  'brbypass10D': 'br_mods',
  'brbypass30D': 'br_mods',
  'cubanpanel1D': 'cuban_panel',
  'cubanpanel7D': 'cuban_panel',
  'cubanpanel30D': 'cuban_panel',
  // Agregar mapeo para productos con espacios
  'drip client aimkill': 'aimkill',
  'drip client silent': 'drip_silent_dll',
  'cuban 8bp': 'cuban_8bp',
  'easy victory': 'easy_victory',
  'auto kill': 'autokill_t',
  'no root': 'noroot_t',
  'drip mobile': 'drip_mobile',
  'br mods': 'br_mods',
  'br bypass': 'br_mods',
  'cuban panel': 'cuban_panel'
};

// Función para obtener la duración del producto
function obtenerDuracionProducto(producto) {
  if (producto.includes('1') || producto.includes('1D')) return '1 día';
  if (producto.includes('5') || producto.includes('5D')) return '5 días';
  if (producto.includes('7') || producto.includes('7D')) return '7 días';
  if (producto.includes('10') || producto.includes('10D')) return '10 días';
  if (producto.includes('15') || producto.includes('15D')) return '15 días';
  if (producto.includes('20') || producto.includes('20D')) return '20 días';
  if (producto.includes('30') || producto.includes('30D')) return '30 días';
  if (producto.includes('perma')) return 'Permanente';
  return '1 día'; // Por defecto
}

// Función para obtener una licencia disponible
async function obtenerLicencia(producto) {
  try {
    console.log(`🔍 Buscando licencia para producto: ${producto}`);
    console.log(`🌐 Entrega 100% desde Cuban Hacks Database`);
    
    // Obtener duración del producto
    const duracion = obtenerDuracionProducto(producto);
    const tutorial_alias = PRODUCTO_TO_TUTORIAL[producto] || 'default';
    
    const requestData = {
      producto: producto,
      duracion: duracion,
      tutorial_alias: tutorial_alias
    };
    
    console.log('📤 Enviando datos a Cuban Hacks API:', JSON.stringify(requestData, null, 2));
    
    // ===== OBTENER LICENCIA DESDE CUBAN HACKS DATABASE =====
    const response = await fetch(CUBANHACKS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData),
      timeout: 15000 // 15 segundos timeout (aumentado para mayor confiabilidad)
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    
    // Verificar si la respuesta es HTML en lugar de JSON
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      console.error('❌ Cuban Hacks API devolvió HTML en lugar de JSON');
      console.error('Respuesta recibida:', responseText.substring(0, 200));
      throw new Error('Cuban Hacks API devolvió HTML inesperado');
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Error parseando respuesta JSON:', parseError.message);
      console.error('Respuesta recibida:', responseText.substring(0, 300));
      throw new Error('Respuesta JSON inválida de Cuban Hacks API');
    }
    
    console.log('📋 Respuesta de Cuban Hacks API:', JSON.stringify(data, null, 2));
    
    // Procesar respuesta de Cuban Hacks con licencia y tutorial
    if (data.status === 'success' && data.licencia && data.tutorial) {
      console.log(`✅ Licencia obtenida desde Cuban Hacks: ${data.licencia}`);
      console.log(`✅ Tutorial obtenido para: ${tutorial_alias}`);
      console.log(`📦 Producto: ${data.product_name || 'N/A'}`);
      
      // Convertir HTML a texto plano para WhatsApp si es necesario
      let tutorialText = data.tutorial;
      if (data.tutorial.includes('<') && data.tutorial.includes('>')) {
        tutorialText = htmlToText(data.tutorial, {
          wordwrap: 80,
          preserveNewlines: true
        });
      }
      
      return {
        success: true,
        licencia: data.licencia,
        tutorial: tutorialText,
        tutorial_alias: tutorial_alias,
        product_name: data.product_name,
        source: 'cubanhacks_database'
      };
    } else if (data.status === 'error') {
      console.error(`❌ Error desde Cuban Hacks: ${data.message}`);
      return {
        success: false,
        message: `Error en Cuban Hacks: ${data.message}`
      };
    } else {
      console.error(`❌ Respuesta incompleta de Cuban Hacks`);
      console.error('Data recibida:', data);
      return {
        success: false,
        message: 'Respuesta incompleta de Cuban Hacks: faltan licencia o tutorial'
      };
    }
    
  } catch (error) {
    console.error('❌ Error obteniendo licencia desde Cuban Hacks:', error.message);
    
    // Log detallado del error para debugging
    if (error.name === 'FetchError') {
      console.error('🔗 Error de conexión con Cuban Hacks API');
      console.error('URL:', CUBANHACKS_API_URL);
    }
    
    return {
      success: false,
      message: `Error conectando con Cuban Hacks Database: ${error.message}`
    };
  }
}

// Función para obtener tutorial
async function obtenerTutorial(tutorial_alias) {
  try {
    console.log(`📚 Buscando tutorial para: ${tutorial_alias}`);
    
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'get_tutorial',
        tutorial_alias: tutorial_alias
      })
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const responseText = await response.text();
    
    // Verificar si la respuesta es HTML en lugar de JSON
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      console.error('❌ Google Apps Script devolvió HTML en lugar de JSON');
      return {
        success: false,
        message: 'Error en Google Apps Script: Respuesta HTML inesperada'
      };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Error parseando respuesta JSON:', parseError.message);
      console.error('Respuesta recibida:', responseText.substring(0, 200));
      return {
        success: false,
        message: 'Respuesta inválida del servidor'
      };
    }
    
    if (data.success) {
      // Convertir HTML a texto plano para WhatsApp
      const tutorialText = htmlToText(data.tutorial, {
        wordwrap: 80,
        preserveNewlines: true
      });
      
      console.log(`✅ Tutorial obtenido para: ${tutorial_alias}`);
      return {
        success: true,
        tutorial: tutorialText
      };
    } else {
      console.error(`❌ Error obteniendo tutorial: ${data.message}`);
      return {
        success: false,
        message: data.message
      };
    }
  } catch (error) {
    console.error('❌ Error en obtenerTutorial:', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

// Función para marcar licencia como entregada
async function marcarLicenciaEntregada(licencia, telefono) {
  try {
    console.log(`📝 Marcando licencia como entregada: ${licencia} a ${telefono}`);
    
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'mark_delivered',
        licencia: licencia,
        telefono: telefono
      })
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      console.log(`✅ Licencia marcada como entregada: ${licencia}`);
      return {
        success: true
      };
    } else {
      console.error(`❌ Error marcando licencia: ${data.message}`);
      return {
        success: false,
        message: data.message
      };
    }
  } catch (error) {
    console.error('❌ Error en marcarLicenciaEntregada:', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

// Función principal para entregar producto
async function entregarProducto(producto, telefono) {
  try {
    console.log(`🎁 Iniciando entrega de producto: ${producto} a ${telefono}`);
    
    // Obtener licencia y tutorial de Zapier
    const resultado = await obtenerLicencia(producto);
    if (!resultado.success) {
      return resultado;
    }
    
    console.log(`✅ Licencia obtenida: ${resultado.licencia}`);
    console.log(`✅ Tutorial obtenido para: ${resultado.tutorial_alias}`);
    console.log(`📱 Cliente: ${telefono}`);
    
    return {
      success: true,
      licencia: resultado.licencia,
      tutorial: resultado.tutorial,
      producto: producto
    };
    
  } catch (error) {
    console.error('❌ Error en entregarProducto:', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  obtenerLicencia,
  obtenerTutorial,
  marcarLicenciaEntregada,
  entregarProducto,
  PRODUCTO_TO_TUTORIAL
}; 