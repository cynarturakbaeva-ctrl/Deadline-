'use strict';
// Puppeteer жүктейтін Chrome жобаның ішінде сақталады — Railway-де build кезінде жүктелген браузер
// іске қосылғанда да табылады (әйтпесе ~/.cache ішінде қалып, «Could not find Chrome» қатесі шығады).
const { join } = require('path');
module.exports = { cacheDirectory: join(__dirname, '.cache', 'puppeteer') };
