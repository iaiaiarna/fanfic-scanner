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

  num (n) {
    if (n == null) return n
    return Number(String(n).trim().replace(/,/g, ''))
  }

}

function parseURL (href) {
  try {
    return url.parse(href)
  } catch (_) {
    return
  }
}

Site.create = function SiteCreate (engine, href) {
  if (engine == null || engine === 'auto') {
    const link = parseURL(href)
    if (link) {
      if (link.hostname.includes('archiveofourown.org')) {
        return require('./site/ao3.js')
      } else if (link.hostname.includes('fanfiction.net')) {
        return require('./site/ffnet.js')
      } else if (link.hostname.includes('reddit.com')) {
        return require('./site/reddit.js')
      } else if (link.hostname.includes('scryer.darklordpotter.net')) {
        return require('./site/scryer.js')
      } else if (link.hostname.includes('wattpad.com')) {
        return require('./site/wattpad.js')
      // xenforo checks are necessarily weak and must be last
      } else if (link.pathname.incldues('/forums/') || link.pathname.incldues('/tags/')) {
        return require('./site/xen.js')
      }
    }
    throw new Error('Could not determine site from: ' + href)
  } else {
    return require(`./site/${engine}.js`)
  }
}

module.exports = Site
