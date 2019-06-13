'use strict'
const db = require('./scanner-db.js')
const validate = require('aproba')
const Fic = require('./fic.js')

class ScannerSource {
  constructor (source) {
    this.source = source
    this.sourceid = null
  }
  async init () {
    this.sourceid = await db.addSource(this.source)
  }
  setLastSeen (lastseen) {
    validate('N', arguments)
    if (!this.sourceid) return Promise.reject(new Error('setLastSeen called without init()'))
    return db.setLastSeen(this.sourceid, lastseen)
  }
  setLastScan (lastscan) {
    validate('N', arguments)
    if (!this.sourceid) return Promise.reject(new Error('setLastScan called without init()'))
    return db.setLastScan(this.sourceid, lastscan)
  }
  replace (fic) {
    validate('O', arguments)
    if (!this.sourceid) return Promise.reject(new Error('replace called without init()'))
    if (!(fic instanceof Fic)) return Promise.reject(new Error('replace called with non-Fic object'))
    return db.replace(this.sourceid, fic)
  }
/* not in use
  get (match) {
    validate('O', arguments)
    if (match.site && match.siteId) {
      return db.getdById(match.site, match.siteId)
    } else {
      return Promise.reject(new Error('No index available for getting fics by ' + JSON.stringify(match)))
    }
  }
*/
  getByIds (ids) {
    validate('A', arguments)
    if (!this.sourceid) return Promise.reject(new Error('getByIds called without init()'))
    return db.getByIds(this.sourceid, ids)
  }
  lastSeen () {
    if (!this.sourceid) return Promise.reject(new Error('lastSeen called without init()'))
    return db.lastSeen(this.sourceid)
  }
  lastScan () {
    if (!this.sourceid) return Promise.reject(new Error('lastScan called without init()'))
    return db.lastScan(this.sourceid)
  }
  serialize () {
    if (!this.sourceid) return Promise.reject(new Error('serialize called without init()'))
    return db.serialize(this.sourceid)
  }
}

module.exports = async (source) => {
  const scan = new ScannerSource(source)
  await scan.init()
  return scan
}
module.exports.Class = ScannerSource
