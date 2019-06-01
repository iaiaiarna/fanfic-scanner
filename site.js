'use strict'
const url = require('url')
const qw = require('@perl/qw')
const qr = require('@perl/qr')
const deeplyEquivalent = require('./deeply-equivalent.js')
const fun = require('funstream')

class ScanFic {
  constructor () {
    this.rawContent = undefined
    this.site = undefined
    this.siteId = undefined
    this.link = undefined
    this.published = undefined
    this.updated = undefined
    this.title = undefined
    this.authors = []
    this.summary = undefined
    this.words = undefined
    this.chapterCount = undefined
    this.maxChapterCount = undefined
    this.cover = undefined
    this.tags = []
    this.stats = {}
  }
  toJSON () {
    return {
      site: this.site,
      siteId: this.siteId,
      link: this.link,
      published: this.published,
      updated: this.updated,
      title: this.title,
      authors: this.authors,
      words: this.words,
      chapterCount: this.chapterCount,
      maxChapterCount: this.maxChapterCount,
      cover: this.cover,
      stats: this.stats,
      tags: this.tags,
      summary: this.summary,
    }
  }
}

module.exports = {
  normalizeLink (href, base) {
    // resolve base url
    if (base) {
      const url = require('url')
      href = url.resolve(base, href)
    }
    // force ssl
    href = href.replace(/^http:/, 'https:')
    href = href.replace(/[/]$/, '')
    return href
  },
  fetchLink (href) {
    return href
  },
  normalizeAuthorLink (href, base) {
    return this.normalizeLink(href, base)
  },

  ScanFic,
  async updateScan (fetch, currentScan) {
    let lastSeen = await currentScan.data.lastSeen() || 0
    let nextPage = currentScan.conf.link
    let pageId = url.parse(currentScan.conf.link).hash
    const authors = currentScan.conf.authors && currentScan.conf.authors.map(_ => {
      return {name: _.name, link: this.normalizeAuthorLink(_.link)}
    })
    let newerThan = lastSeen
    while (nextPage) {
      const res = await fetch(this.fetchLink(nextPage))
      const scan = await this.parseScan(nextPage, await res.buffer(), pageId)
      const fics = scan.fics
      const existingItems = {}
      const existingFics = await currentScan.data.getByIds(fics.map(_ => _.siteId))
      existingFics.forEach(existing => {
        if (existing == null) return
        existingItems[existing.siteId] = existing
      })

      nextPage = scan.nextPage
      let sawAnyNewer
      for (let fic of fics) {
        if (authors) authors.forEach(au => {
          if (!fic.authors.some(_ => _.link === au.link)) fic.authors.push(au)
        })
        const updated = fic.updated
        if (updated > newerThan) {
          sawAnyNewer = true
        }
        if (updated > lastSeen) {
          lastSeen = updated
        }
        if (currentScan.conf.filterEntry && !currentScan.conf.filterEntry.test(fic.rawContent)) continue

        if (!fic.siteId) {
          //console.error('Skipping, no id', fic.link)
          continue
        }
        const existing = existingItems[fic.siteId]

        if (existing && deeplyEquivalent(fic.toJSON(), existing)) continue

        if (existing || !currentScan.conf.filterTags || fic.tags.some(_ => currentScan.conf.filterTags.test(_)) || currentScan.conf.filterTags.test(fic.title)) {
          await currentScan.data.replace(fic)
        }
      }
      if (newerThan && !sawAnyNewer) break
    }
    if (lastSeen > newerThan) {
      await currentScan.data.setLastSeen(lastSeen)
    }
  }

}

function shipchars (ship) {
   return ship.slice(5).split('/')
}
