'use strict'
const Site = require('../site.js')
const url = require('url')
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')

const site = module.exports = {
  ...Site,
  parseScan,
  normalizeAuthorLink (href, base) {
    return this.normalizeLink(href, base)
      .replace(qr`/pseuds/.*`, '/profile')
  },
  linkFromId (siteId, href) {
    return `https://archiveofourown.org/works/${siteId}`
  }
}

async function parseScan (scanLink, html, pageId) {
  const $ = cheerio.load(html)
  const nextPage = $('a[rel=next]').attr('href')
  const scan = {
    nextPage: nextPage && url.resolve(scanLink, nextPage),
    fics: [],
  }

  const items = []
  $('li.work[role=article]').each((ii, _) => { items.push($(_)) })
  $('li.bookmark[role=article]').each((ii, _) => { items.push($(_)) })

  for (let $item of items) {
    const fic = new Site.ScanFic()
    scan.fics.push(fic)
    fic.site = 'ao3'
    fic.updated = moment($item.find('p.datetime').text(), 'DD MMM YYYY').unix()
    fic.rawContent = $item.text().trim()
    const matchId = $item.find('div.header a').first().attr('href')
      .replace(qr`/collections/[^/]+`, '')
      .match(/[/](?:works|series)[/](\d+)/)
    fic.siteId = matchId && matchId[1]
    fic.link = this.linkFromId(fic.siteId, scanLink)
    fic.title = $item.find('.heading a').first().text().trim()
    fic.summary = $item.find('.summary').text().trim()

    const authors = fic.authors
    $item.find('a[rel=author]').each((ii, author) => {
      const $author = $(author)
      authors.push({
        name: $author.text().trim().replace(/ [(].*[)]$/, ''),
        link: $author.attr('href') && this.normalizeAuthorLink(url.resolve(scanLink, $author.attr('href')))
      })
    })

    const fandoms = []
    $item.find('.fandoms a.tag').each((ii, fandom) => {
      fandoms.push($(fandom).text())
    })

    fandoms.forEach(f => fic.tags.push(`fandom:${f}`))

    const rating = $item.find('ul.required-tags span.rating').attr('title')
    fic.tags.push('rating:' + rating)

    const category = $item.find('ul.required-tags span.category').attr('title')
    if (category) category.split(/,\s*/).forEach(_ => fic.tags.push('category:' + _))

    const language = $item.find('dd.language').text()
    fic.tags.push('language:' + language)

    fic.words = Number($item.find('dd.words').text().replace(',', ''))

    const [chapterCount, maxChapterCount] = $item.find('dd.chapters').text().split('/').map(n => n === '?' ? n : Number(n))
    fic.chapterCount = chapterCount
    fic.maxChapterCount = maxChapterCount

    fic.stats.comments = Number($item.find('dd.comments').text().trim().replace(',', ''))
    fic.stats.kudos = Number($item.find('dd.kudos').text().trim().replace(',', ''))
    fic.stats.hits = Number($item.find('dd.hits').text().trim().replace(',', ''))
    fic.stats.bookmarks = Number($item.find('dd.bookmarks').text().trim().replace(',', ''))
    fic.stats.collections = Number($item.find('dd.collections').text().trim().replace(',', ''))

    $item.find('ul.tags li').each((ii, li) => {
      const $li = $(li)
      const kind = $li.attr('class')
      if (!kind) return
      let prefix = kind.split(/ /)[0].replace(/s$/, '')
      const value = $li.text().trim()
      if (value === 'Friendship - Relationship') return
      if (prefix === 'relationship') {
        if (/[/]/.test(value)) {
          prefix = 'ship'
        } else {
          prefix = 'friendship'
        }
      }
      fic.tags.push(`${prefix}:${value}`)
    })
    if (fic.tags.includes('freeform:Abandoned Work - Unfinished and Discontinued')) {
      fic.tags.push('status:abandoned')
    } else {
      const iswip = $item.find('ul.required-tags span.iswip').attr('title')
      if (iswip === 'Complete Work') {
        if (maxChapterCount === 1) {
          fic.tags.push('status:one-shot')
        } else {
          fic.tags.push('status:complete')
        }
      }
    }
  }
  return scan
}
