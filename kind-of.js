'use strict'
module.exports = kindOf

function kindOf (aa) {
  if (aa === null) return 'null'
  if (Array.isArray(aa)) return 'array'
  if (Buffer.isBuffer(aa)) return 'buffer'
  if (aa instanceof Date || aa._isAMomentObject) return 'date'
  if (typeof aa === 'bigint') return 'number'
  
  return typeof aa
}