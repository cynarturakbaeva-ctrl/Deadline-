'use strict';

/**
 * Дерекқор таңдаушысы (ашық API екеуінде бірдей):
 *  - DATABASE_URL бар болса (Railway) → PostgreSQL (storage/pgDb.js)
 *  - жоқ болса (жергілікті / Termux / тесттер) → JSON файл data/db.json (storage/jsonDb.js)
 */
module.exports = process.env.DATABASE_URL
  ? require('./storage/pgDb')
  : require('./storage/jsonDb');
