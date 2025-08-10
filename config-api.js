// Configuración de APIs para el sistema de licencias
// Zapier: SOLO para crear tickets iniciales
// Cuban Hacks: 100% entrega de licencias y tutoriales

const CONFIG = {
  // Configuración para desarrollo - ahora usa API de producción
  development: {
    CUBANHACKS_API_URL: 'https://cubanhacks.com/api/get_product_data.php',
    ZAPIER_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/23031717/u46edg7/' // SOLO TICKETS
  },
  
  // Configuración para producción
  production: {
    CUBANHACKS_API_URL: 'https://cubanhacks.com/api/get_product_data.php',
    ZAPIER_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/23031717/u46edg7/' // SOLO TICKETS
  }
};

// Detectar entorno actual
const environment = process.env.NODE_ENV || 'development';

// Exportar configuración actual
module.exports = {
  CUBANHACKS_API_URL: CONFIG[environment].CUBANHACKS_API_URL,
  ZAPIER_WEBHOOK_URL: CONFIG[environment].ZAPIER_WEBHOOK_URL,
  environment: environment
};