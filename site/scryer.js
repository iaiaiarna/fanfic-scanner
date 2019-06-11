'use strict'
const FFNet = require('./ffnet.js').Class
const Scan = require('../scan.js')
const cheerio = require('cheerio')
const moment = require('moment')

const qw = require('@perl/qw')
const qr = require('@perl/qr')

/*
  NOTE: Due to limitations in the output format of Scryer's search, we can
  only detect one fandom per fic.  If you search for crossovers with X, then
  the fandom will always be the thing being crossed over into.
*/

//Complete - T - Romance - Ginny W. - 1,108 words - 1 chapter - 0 reviews - 0 favorites - 0 follows
class Scryer extends FFNet {
  parseScan (scanLink, html) {
    const $ = cheerio.load(html)
    const nextPage = $('a[rel=next]').attr('href')
    const base = $('base').attr('href') || scanLink
    const scan = new Scan(this, this.normalizeLink(nextPage, base))

    const items = []
    $('div.panel').each((ii, item) => {
      items.push($(item))
    })

    const $searchTitle = $('.search_controller .page-header')
    $searchTitle.find('small').remove()
    const searchTitle = ($searchTitle.text()||'').trim()
    const [, searchFandom] = searchTitle.match(/^Search\s+in\s+(.*?)\s+and All Crossovers$/)
                          || searchTitle.match(/^Search\s+in\s+(.*?)$/)
                          || []

    for (let $item of items) {
      const fic = scan.addFic()
      const $footer = $item.find('div.panel-footer')
      fic.updated = moment($footer.find('time').attr('datetime')).unix()
      fic.published = moment($footer.find('strong').first().attr('title').replace(/Published: (\S+) (\S+) UTC/, '$1T$2Z')).unix()

      const $storyLink = $item.find('a.story-link')
      fic.title = $storyLink.attr('data-story')
      fic.siteId = $storyLink.attr('data-story-id')
      fic.link = this.linkFromId(fic.siteId)
      const $authorLink = $item.find('a.author-link')
      const author = $authorLink.text().trim()
      const authorUrl = $authorLink.attr('href')
      fic.addAuthor(author, authorUrl, base)
      const $summary = $item.find('div.story-summary')
      const labels = []
      const $labels = $summary.find('span.label')
      $labels.each((ii, label) => {
        const $label = $(label)
        labels.push($label.text().trim())
        $label.remove()
      })
      // remove labels from summary text
      $summary.find('div').remove()

      $footer.find('span.text-muted').first().remove()
      $footer.find('.fa-angle-left').each((ii, angle) => $(angle).text('<'))
      $footer.find('.fa-angle-right').each((ii, angle) => $(angle).text('>'))
      const footer = $footer.text().replace(/\s+/g, ' ').trim()
      const info = this.parseSearchLine(footer)
      const {xover, rating, words, reviews, favs, follows, chapterCount, status} = info
      fic.summary = $summary.text().trim().replace(/</g, '&lt;')
      fic.chapterCount = chapterCount
      fic.words = words
      fic.rating = this.ratingMap(rating)
      fic.stats.reviews = reviews || 0
      fic.stats.favs = favs || 0
      fic.stats.follows = follows || 0
      if (searchFandom) fic.tags.push(`fandom:${searchFandom}`)
      if (xover) fic.tags.push(`fandom:${xover}`)
      fic.tags.push.apply(fic.tags, []
        .concat(info.genre.map(_ => `genre:${_}`))
        .concat(info.characters.map(_ => `character:${_}`))
        .concat(info.pairing.map(_ => `ship:${_.join('/')}`))
        .concat(labels.map(_ => `scryer:${_}`)))
      if (info.status === 'Complete') {
        fic.status = 'complete'
        fic.maxChapterCount = fic.chapterCount
      } else if (info.status === 'In-Progress') {
        fic.status = 'in-progress'
      }
    }
    return scan
  }

  parseSearchLine (status) {
    const mNum = this.mNum()
    const mGenres = this.mGenres()
    let matched = status.match(qr.join('', [
      qr`^`,
      qr`(?:(?<xover>.*?) - )?`,
      qr`(?<status>In-Progress|Complete) - `,
      qr`(?<rating>..?)`,
      qr`(?: - (?<genres>${mGenres}))?`,
      qr`(?: - (?<charship>.*?))?`,
      qr` - (?<words>${mNum}) words?`,
      qr` - (?<chapters>${mNum}) chapters?`,
      qr` - (?<reviews>${mNum}) reviews?`,
      qr` - (?<favorites>${mNum}) favorites?`,
      qr` - (?<follows>${mNum}) follows?`,
      qr`$`
    ]))
    if (!matched) throw new Error('Unparseable: »' + status + '«')
    const info = matched.groups

    let cp = info.charship || ''
    let characters = []
    let pairing = []
    if (/<.+>/.test(cp)) {
      pairing = cp.match(/<(.+?)>/g).map(p => p.slice(1,-1).split(/, /))
      cp = cp.replace(/<(.*?)>/g, '')
    }
    if (cp.length) {
      characters = cp.split(/, /).filter(c => c !== '').map(c => c.trim())
    }
    return {
      xover: info.xover,
      rating: info.rating,
      genre: info.genres ? info.genres.replace(qr`Hurt/Comfort`, 'HC').split(qr`/`).map(_ => _ === 'HC' ? 'Hurt/Comfort' : _) : [],
      chapterCount: this.num(info.chapters || 0),
      words: this.num(info.words),
      reviews: this.num(info.reviews),
      favs: this.num(info.favs),
      follows: this.num(info.follows),
      characters: characters || [],
      pairing: pairing || [],
      status: info.status
    }
  }

}

module.exports = new Scryer()
module.exports.Class = Scryer
