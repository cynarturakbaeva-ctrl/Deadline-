'use strict';
// Бағалар мен пакеттер (бір жерде). .env арқылы өзгертуге болады.
module.exports = {
  PRICE: 250,           // 1 кредит
  FIRST_PRICE: 100,     // бірінші сатып алу (1 кредит)
  PLUS: {
    name: 'Plus',
    amount: parseInt(process.env.PLUS_PRICE || '1990', 10),    // ₸
    credits: parseInt(process.env.PLUS_CREDITS || '50', 10),   // кредит саны
  },
};
