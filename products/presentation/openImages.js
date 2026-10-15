'use strict';
/**
 * OPEN IMAGES — кілтсіз ашық сурет базалары (музейлер, архивтер, ғылым). Толтырылады: зерттеу нәтижесі бойынша.
 * Әр провайдер: async (query) => [{url, thumb, credit, source, w, h, desc, license}]
 */
const OPEN_PROVIDERS = {};

/** Сұраныс түріне қарай қай ашық базалар сұралады (бәрі емес — vision топтамасы шектеулі) */
function routeOpen(query, opts = {}) {
  void query; void opts;
  return [];
}

module.exports = { OPEN_PROVIDERS, routeOpen };
