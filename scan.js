'use strict'
class Scan {
  constructor (site, nextPage) {
    this.site = site
    this.fics = []
    this.nextPage = nextPage
  }
  addFic (obj) {
    const fic = this.site.newFic(obj)
    this.fics.push(fic)
    return fic
  }
}
module.exports = Scan
