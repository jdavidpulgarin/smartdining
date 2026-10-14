const menuService = require('../services/menu.service');

async function obtener(req, res, next) {
  try {
    const { menu } = await menuService.obtenerMenu();
    // Se responde con la clave `categorias`, igual que GET /categorias: el
    // contenido del JSON de la función se devuelve tal cual, sin tocar ninguna
    // de sus claves (categoria, platos, pasos, ingredientes...).
    return res.json({ categorias: menu });
  } catch (err) {
    return next(err);
  }
}

module.exports = { obtener };
