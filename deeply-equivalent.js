'use strict'
module.exports = deeplyEquivalent

const kindOf = require('./kind-of.js')

// deep equals, but can compare the values of dates, the contents of buffers
// and the values of numbers with the values of bigints.
function deeplyEquivalent (aa, bb) {
  const aaKind = kindOf(aa)
  const bbKind = kindOf(bb)
  if (aaKind !== bbKind) return false
  if (aaKind === 'array') {
    if (aa.length !== bb.length) return false
    return aa.every((_, ii) => deeplyEquivalent(_, bb[ii]))
  } else if (aaKind === 'object') {
    const aaKeys = Object.keys(aa)
    const bbKeys = Object.keys(bb)
    if (!deeplyEquivalent(aaKeys, bbKeys)) return false
    return aaKeys.every(_ => deeplyEquivalent(aa[_], bb[_]))
  } else if (aaKind === 'buffer') {
    return aa.equals(bb)
  } else if (aaKind === 'date') {
    return aa.valueOf() === bb.valueOf()
  } else {
    // guaranteed the same kind already, this allows equivalent numbers and
    // bigints to match
    return aa == bb
  }
}