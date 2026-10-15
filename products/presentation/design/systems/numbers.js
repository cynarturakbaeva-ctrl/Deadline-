'use strict';
/** Жүйе бойынша нөмір: 1 → «01» / «1» / «1.» / «I» / «[01]» */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function formatNum(style, n) {
  const pad = String(n).padStart(2, '0');
  switch (style) {
    case 'plain': return String(n);
    case 'dot': return n + '.';
    case 'roman': return ROMAN[n] || String(n);
    case 'bracket': return '[' + pad + ']';
    default: return pad;
  }
}

module.exports = { formatNum };
