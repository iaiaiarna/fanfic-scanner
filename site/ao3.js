'use strict'
const Site = require('../site.js')
const Scan = require('../scan.js')
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')

class AO3 extends Site {
  constructor () {
    super()
    this.name = 'ao3'
  }
  linkFromId (siteId) {
    return `https://archiveofourown.org/works/${siteId}`
  }
  parseScan (scanLink, html) {
    const $ = cheerio.load(html)
    const nextPage = $('a[rel=next]').attr('href')
    const base = $('base').attr('href') || scanLink
    const scan = new Scan(this, this.normalizeLink(nextPage, base))

    const items = []
    $('ol > li[role=article]').each((ii, _) => { items.push($(_)) })

    for (let $item of items) {
      const $titleLink = $item.find('.header .heading a').first()
      const link = $titleLink.attr('href')
      const matchId = link.match(qr`/(?:works|series)/(\d+)`)
      if (!matchId) continue

      const fic = scan.addFic()
      fic.title = $titleLink.text().trim()
      fic.siteId = matchId && Number(matchId[1])
      fic.link = this.linkFromId(fic.siteId)

      const $authorLink = $item.find('.header .heading a[rel="author"]').each((ii, author) => {
        const $author = $(author)
        // AO3 lists names as Pseudonym (Username).  We don't care about the
        // latter part (the later merge layer will detect pseudonyms of the
        // same person and merge them, and we truely don't care about the
        // username).
        const name = $author.text().trim().replace(qr` [(](.*)[)]$`, '')
        const link = $author.attr('href')
        fic.addAuthor(name, link, base)
      })
      $item.find('.fandoms a.tag').each((ii, fandom) => {
        const fandomName = $(fandom).text()
        fic.tags.push(`fandom:${fandomName}`)
      })

      fic.rating = $item.find('.rating').attr('title').trim()

      // Don't need warnings from here, as they show up in main tags too
      //const warnings = $item.find('.warnings').attr('title').trim().split(', ')

      const category = $item.find('.category').attr('title').trim()
      fic.tags.push(`category:${category}`)

      const iswip = $item.find('.iswip').attr('title').trim() === 'Work in Progress'
      const iscomplete = $item.find('.iswip').attr('title').trim() === 'Complete Work'
      fic.status = iswip ? 'in-progress' : iscomplete ? 'complete' : undefined

      fic.updated = moment.utc($item.find('.header .datetime').text(), 'DD MMM YYYY').unix()

      $item.find('.tags li').each((ii, tag) => {
        const $tag = $(tag)
        let tagType = $tag.attr('class').replace(/ last/, '').replace(/s$/, '')
        const tagName = $tag.find('.tag').text().trim()
        if (tagName === 'Friendship - Relationship') return
        if (tagName === 'Abandoned Work - Unfinished and Discontinued') {
          fic.status = 'abandoned'
          return
        }
        if (tagType === 'relationship') {
          if (/ [&] /.test(tagName)) {
            tagType = 'friendship'
          } else {
            tagType = 'ship'
          }
        }
        fic.tags.push(`${tagType}:${tagName}`) 
      })
      const summary = $item.find('.summary').html()
      if (summary != null) fic.summary = summary.trim()
      fic.language = $item.find('dd.language').text()
      fic.words = this.num($item.find('dd.words').text())

      const [chapterCount, maxChapterCount] = $item.find('dd.chapters').text().split('/').map(_ => _ === '?' ? undefined : this.num(_))
      fic.chapterCount = chapterCount
      fic.maxChapterCount = maxChapterCount

      fic.stats.comments = this.num($item.find('dd.comments').text())
      fic.stats.kudos = this.num($item.find('dd.kudos').text().trim())
      fic.stats.hits = this.num($item.find('dd.hits').text().trim())
      fic.stats.bookmarks = this.num($item.find('dd.bookmarks').text())
      fic.stats.collections = this.num($item.find('dd.collections').text())
    }
    return scan
  }
}

module.exports = new AO3()
module.exports.Class = AO3
