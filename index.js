const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('📱 Escanea el código QR para conectar WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Bot de WhatsApp conectado y listo para el sistema de tickets.');
  console.log('🎫 Sistema de Tickets de Autorización activo');

  // Mostrar información de grupos disponibles
  try {
    const chats = await client.getChats();
    const grupos = chats.filter(chat => chat.isGroup);
    console.log('\n📋 Grupos disponibles para tickets:');
    grupos.forEach(group => {
      console.log(`📛 ${group.name} — ID: ${group.id._serialized}`);
    });
  } catch (e) {
    console.log('⚠️ No se pudieron obtener los grupos:', e.message);
  }
});

// Manejo de desconexiones
client.on('disconnected', (reason) => {
  console.log('⚠️ WhatsApp desconectado:', reason);
  console.log('🔄 Intentando reconectar en 10 segundos...');
  
  setTimeout(() => {
    console.log('🔄 Reiniciando cliente de WhatsApp...');
    try {
      client.initialize();
    } catch (error) {
      console.error('❌ Error al reinicializar:', error.message);
      console.log('🔄 Reintentando en 30 segundos...');
      setTimeout(() => {
        process.exit(1); // Forzar restart del proceso
      }, 30000);
    }
  }, 10000);
});

// Manejo de errores de autenticación
client.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
  console.log('🔄 Reiniciando en 15 segundos...');
  setTimeout(() => {
    process.exit(1);
  }, 15000);
});

// Manejo de errores de puppeteer
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('Execution context was destroyed')) {
    console.error('❌ Error de contexto de ejecución destruido detectado');
    console.log('🔄 Reiniciando sistema para recuperar estabilidad...');
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  } else {
    console.error('❌ Rechazo no manejado:', reason);
  }
});

client.on('message', async (message) => {
  // Escuchar respuestas de autorización en grupos
  if (message.from.endsWith('@g.us')) {
    const texto = message.body.trim();
    
    // NUEVO: Detectar emojis ✅ y ❌ en respuestas a tickets
    if ((texto === '✅' || texto === '❌') && message.hasQuotedMsg) {
      try {
        const quotedMsg = await message.getQuotedMessage();
        const mensajeOriginal = quotedMsg.body;
        
        // Extraer ticket ID del mensaje original
        const ticketMatch = mensajeOriginal.match(/🎫\s*\*?Ticket:?\*?\s*#?(\d{3})/i);
        
        if (ticketMatch) {
          const ticketId = parseInt(ticketMatch[1]);
          const accion = texto === '✅' ? 'APROBADO' : 'RECHAZADO';
          
          console.log(`🎫 Ticket #${ticketId} ${accion} por ${message.author || 'Usuario'} usando emoji ${texto}`);
          
          // Procesar la autorización
          await procesarAutorizacion(ticketId, accion, message.author, message.from);
          return;
        }
      } catch (error) {
        console.log('⚠️ Error procesando respuesta con emoji:', error.message);
      }
    }
    
    // MANTENER: Sistema anterior como respaldo
    const textoLower = texto.toLowerCase();
    if (textoLower.includes('aprobado') || textoLower.includes('rechazado')) {
      const ticketMatch = textoLower.match(/(aprobado|rechazado)\s+(\d{3})/i);
      if (ticketMatch) {
        const accion = ticketMatch[1].toUpperCase();
        const ticketId = parseInt(ticketMatch[2]);
        
        console.log(`🎫 Ticket #${ticketId} ${accion} por ${message.author || 'Usuario'} (método anterior)`);
        
        // Procesar la autorización
        await procesarAutorizacion(ticketId, accion, message.author, message.from);
      }
    }
  }
});

// Función para procesar autorización
async function procesarAutorizacion(ticketId, accion, autor, grupoId) {
  try {
    console.log(`✅ Procesando autorización para ticket #${ticketId}`);
    
    // Marcar ticket como procesado directamente
    const response = await fetch(`http://localhost:3000/procesar-ticket/${ticketId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, autor })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Ticket #${ticketId} procesado exitosamente como ${accion}`);
      
      // Enviar confirmación corta y limpia
      const emoji = accion === 'APROBADO' ? '✅' : '❌';
      const confirmacion = `${emoji} *Ticket #${ticketId} ${accion}* por ${autor}`;
      
      if (grupoId) {
        await client.sendMessage(grupoId, confirmacion);
      }
      
    } else {
      console.log(`⚠️ Error procesando ticket #${ticketId}: ${result.message}`);
    }
  } catch (error) {
    console.error(`❌ Error procesando autorización para ticket #${ticketId}:`, error);
  }
}



client.initialize();

module.exports = client;
