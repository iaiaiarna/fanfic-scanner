'use strict'
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')
const qw = require('@perl/qw')
const Site = require('../site.js')
const Scan = require('../scan.js')
const unixTime = require('../unix-time.js')

const mNum = qr`[\d,]+`
const mGenre = qr.join('|', qw`
  General Romance Humor Drama Poetry Adventure Mystery Horror Parody
  Angst Supernatural Suspense Sci-Fi Fantasy Spiritual Tragedy Western
  Crime Family Hurt/Comfort Friendship`)
const mGenres = qr`${mGenre}(?:/${mGenre})*`
const ratingMap = {
  'K': 'General Audiences',
  'K+': 'General Audiences',
  'T': 'Teen And Up Audiences',
  'M': 'Mature'
}

class FFNet extends Site {
  constructor () {
    super()
    this.name = 'ffnet'
  }
  mNum () { return mNum }
  mGenres () { return mGenres }
  ratingMap (key) { return ratingMap[key] }
  linkFromId (siteId) {
    return `https://www.fanfiction.net/s/${siteId}`
  }
  parseScan (scanLink, html, pageId) {
    const $ = cheerio.load(html)
    const nextPage = $('a:contains(Next »)').attr('href')
    const base = $('base').attr('href') || scanLink
    const scan = new Scan(this, this.normalizeLink(nextPage, base))

    const items = []
    const findWith = pageId ? `${pageId} .z-list` : '.z-list'
    $(findWith).each((ii, item) => {
      items.push($(item))
    })

    const canonicalUrl = $('link[rel="canonical"]').attr('href')
    const pageTitle = $('title').text().replace(/ [|] FanFiction$/, '')
    let pageAuthorUrl
    let pageAuthorName
    let pageFandom
    if (qr`/u/`.test(canonicalUrl)) {
      pageAuthorUrl = canonicalUrl
      pageAuthorName = pageTitle
    } else if (pageTitle.match(/ (Crossover|FanFiction) Archive$/)) {
      pageFandom = pageTitle.replace(/ (Crossover|FanFiction) Archive$/, '')
    }

    for (let $item of items) {
      const fic = scan.addFic()
      const firstDate = moment.unix($item.find('span[data-xutime]').first().attr('data-xutime')).unix()
      const secondDate = moment.unix($item.find('span[data-xutime]').next().attr('data-xutime')).unix()
      if (secondDate > 0) {
        fic.updated = firstDate
        fic.published = secondDate
      } else {
        fic.updated = fic.published = firstDate
      }

      const matchId = $item.find('a.stitle').attr('href').match(qr`/s/(\d+)`)
      fic.siteId = matchId && matchId[1]
      fic.link = this.linkFromId(fic.siteId)
      fic.title = $item.find('a.stitle').text().trim()

      let $author = $item.find('a.stitle').next('a[class!="reviews"]')
      if ($author.text().trim() === '') $author = $author.next('a[class!="reviews"]')
      const author = $author.text().trim() || pageTitle
      const authorUrl = $author.attr('href') || canonicalUrl
      if (authorUrl) fic.addAuthor(author, authorUrl, base)
      const infoline = $item.find('.xgray').text()
      const info = this.parseSearchLine(infoline)
      let {crossover, fandom, language, rating, words, reviews, favs, follows, updated, published, chapterCount} = info
      if (!fandom) fandom = pageFandom
      fic.rating = this.ratingMap(rating)
      fic.chapterCount = chapterCount
      fic.words = words
      fic.stats.reviews = reviews || 0
      fic.stats.favs = favs || 0
      fic.stats.follows = follows || 0
      if (!fic.updated) fic.updated = updated
      if (!fic.published) fic.published = published

      const img_src = $item.find('img').attr('data-original')
      const img = img_src ? this.normalizeLink(img_src, base).replace(qr`/(75|150)/`, '/180/') : undefined
      if (img) fic.cover = img


      if (crossover) {
        if (qr`^${pageFandom} & `.test(fandom)) {
          const xover = fandom.replace(qr`^${pageFandom} & `, '')
          fic.tags.push(`fandom:${pageFandom}`, `fandom:${xover}`)
        } else if (qr` & ${pageFandom}$`.test(fandom)) {
          const xover = fandom.replace(qr` & ${pageFandom}$`, '')
          fic.tags.push(`fandom:${pageFandom}`, `fandom:${xover}`)
        } else if (fandom.match(/&/g).length === 1) {
          const [fandom1, fandom2] = fandom.replace(/^Crossover - /, '').split(/ & /)
          fic.tags.push(`fandom:${fandom1}`, `fandom:${fandom2}`)
        }
      } else if (fandom) {
        fic.tags.push(`fandom:${fandom}`)
      }
      fic.language = language
      info.genre.map(g => 'genre:' + g).forEach(_ => fic.tags.push(_))
      info.characters.map(c => 'character:' + c).forEach(_ => fic.tags.push(_))
      for (let p of info.pairing) {
        fic.tags.push('ship:' + p.join('/'))
        for (let c of p) fic.tags.push('character:' + c)
      }
      if (info.status === 'Complete') {
        fic.status = 'complete'
        fic.maxChapterCount = fic.chapterCount
      } else {
        fic.status = 'in-progress'
      }
      
      const $desc = $item.find('div.z-indent')
      $desc.find('div').remove()
      fic.summary = $desc.text().trim().replace(/</g, '&lt;')
    }
    return scan
  }

  parseSearchLine (status) {
    const mNum = this.mNum()
    const mGenres = this.mGenres()
    // Author story lists
    let matched = status.match(qr.join('', [
      qr`^`,
      qr`(?:(?<crossover>Crossover) - )?`,
      qr`(?:(?<fandom>.+?) - )?`,
      qr`Rated: (?<rating>..?)`,
      qr` - (?<language>.+?)`,
      qr`(?: - (?<genres>${mGenres}))?`,
      qr` - Chapters: (?<chapters>${mNum})`,
      qr` - Words: (?<words>${mNum})`,
      qr`(?: - Reviews: (?<reviews>${mNum}))?`,
      qr`(?: - Favs: (?<favs>${mNum}))?`,
      qr`(?: - Follows: (?<follows>${mNum}))?`,
      qr`(?: - Updated: (?<updated>\S+))?`,
      qr` - Published: (?<published>\S+)`,
      qr`(?: - (?<charship>.*?))?`,
      qr`(?: - (?<status>Complete))?`,
      qr`$`
    ]))

    if (!matched) throw new Error('Unparseable: ' + status)
    let info = matched.groups

    let cp = (info.charship || '').trim()
    let characters = []
    let pairing = []
    if (/\[.+\]/.test(cp)) {
      pairing = cp.match(/\[(.+?)\]/g).map(_ => _.slice(1,-1).split(/, /))
      cp = cp.replace(/\[(.*?)\]/g, '')
    }
    if (cp.length) {
      characters = cp.split(/, /).filter(_ => _ !== '').map(_ => _.trim())
    }
    return {
      crossover: info.crossover,
      fandom: info.fandom,
      rating: info.rating,
      language: info.language.trim(),
      genre: info.genres ? info.genres.replace(qr`Hurt/Comfort`, 'HC').split(qr`/`).map(_ => _ === 'HC' ? 'Hurt/Comfort' : _) : [],
      chapterCount: this.num(info.chapters),
      words: this.num(info.words),
      reviews: this.num(info.reviews),
      favs: this.num(info.favs),
      follows: this.num(info.follows),
      updated: this.date(info.updated),
      published: this.date(info.published),
      characters: characters || [],
      pairing: pairing || [],
      status: info.status
    }
  }

  date (d) {
    if (d==null) return d
    d = d.trim()
    let parsed
    if (qr`/`.test(d)) {
      var sp = d.split(qr`/`)
      parsed = moment(sp[2] + '-' + sp[0] + '-' + sp[1], 'YYYY-MM-DD').unix()
    } else if (/(\d+)h/.test(d)) {
      const [, hours] = /(\d+)h/.exec(d)
      parsed = moment().utc().subtract(2 + Number(hours), 'hour').unix()
    } else if (/(\d+)m/.test(d)) {
      const [, min] = /(\d+)m/.exec(d)
      parsed = moment().utc().subtract(2, 'hour').subtract(min, 'minute').unix()
    } else {
      parsed = moment(d, 'MM-DD').unix()
    }
    return isNaN(parsed) ? null : parsed
  }
}

module.exports = new FFNet()
module.exports.Class = FFNet
