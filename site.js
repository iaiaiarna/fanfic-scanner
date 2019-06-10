'use strict'
const url = require('url')
const Fic = require('./fic.js')

class Site {
  constructor () {
    this.name = undefined
  }
  normalizeLink (href, base) {
   if (!href) return href

    // resolve base url
    if (base) href = url.resolve(base, href)

    // force ssl
    href = href.replace(/^http:/, 'https:')
    href = href.replace(/[/]$/, '')
    return href
  }

  normalizeFicLink (href, base) {
    return this.normalizeLink(href, base)
  }

  normalizeAuthorLink (href, base) {
    return this.normalizeLink(href, base)
  }

  fetchLink (href) {
    return href
  }

  newAuthor (name, href, base) {
    return {name, link: this.normalizeAuthorLink(href, base)}
  }

  linkFromId (siteId, baseLink) {
    throw new Error('linkFromId is unimplemented')
  }

  newFic (obj) {
    return obj ? new Fic(this).fromJSON(obj) : new Fic(this)
  }
}

module.exports = Site
