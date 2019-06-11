'use strict'
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')
const qw = require('@perl/qw')
const Site = require('../site.js')
const Scan = require('../scan.js')
const unixTime = require('../unix-time.js')

class FFNet extends Site {
  constructor () {
    super()
    this.name = 'ffnet'

    this.mNum = qr`[\d,]+`
    const mGenre = qr.join('|', qw`
      General Romance Humor Drama Poetry Adventure Mystery Horror Parody
      Angst Supernatural Suspense Sci-Fi Fantasy Spiritual Tragedy Western
      Crime Family Hurt/Comfort Friendship`)
    this.mGenres = qr`${mGenre}(?:/${mGenre})*`
  }
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

    for (let $item of items) {
      const fic = scan.addFic()
      fic.updated = moment.unix($item.find('span[data-xutime]').first().attr('data-xutime')).unix()
      fic.rawContent = $item.text().trim()

      const matchId = this.normalizeFicLink($item.find('a.stitle').attr('href'), base)
        .match(qr`/s/(\d+)`)
      fic.siteId = matchId && matchId[1]
      fic.link = this.linkFromId(fic.siteId)
      fic.title = $item.find('a.stitle').text().trim()
      let $author = $item.find('a.stitle').next('a')
      if ($author.text().trim() === '') $author = $author.next('a')
      const author = $author.text().trim()
      const authorUrl = this.normalizeAuthorLink($author.attr('href'), base)
      fic.addAuthor(author, authorUrl)
      const infoline = $item.find('.xgray').text()
      const info = this.parseSearchLine(infoline)
      let {fandom, language, rating, words, reviews, favs, follows, updated, published, chapterCount} = info
      fic.chapterCount = chapterCount
      fic.words = words
      fic.stats.reviews = reviews || 0
      fic.stats.favs = favs || 0
      fic.stats.follows = follows || 0
      if (!updated || (fic.updated && updated < fic.updated)) updated = fic.updated
      if (published && published > 0) fic.published = published
      fic.updated = updated

      const img_src = $item.find('img').attr('data-original')
      const img = img_src ? this.normalizeLink(img_src, base).replace(qr`/(75|150)/`, '/180/') : undefined
      if (img) fic.cover = img


      if (fandom) {
        if (/^Crossover -/.test(fandom)) {
          const [name, xover] = fandom.replace(/^Crossover - /, '').split(/ & /)
          fic.tags.unshift(`fandom:${name}`, `fandom:${xover}`)
        } else {
          fic.tags.unshift(`fandom:${fandom}`)
        }
      }
      fic.tags.push('language:' + language)
      fic.tags.push('rating:' + rating)
      info.genre.map(g => 'genre:' + g).forEach(_ => fic.tags.push(_))
      info.characters.map(c => 'character:' + c).forEach(_ => fic.tags.push(_))
      for (let p of info.pairing) {
        fic.tags.push('ship:' + p.join('/'))
        for (let c of p) fic.tags.push('character:' + c)
      }
      if (info.status === 'Complete') {
        if (info.chapterCount <= 1) {
          fic.tags.push('status:one-shot')
        } else {
          fic.tags.push('status:complete')
        }
      }
      
      const $desc = $item.find('div.z-indent')
      $desc.find('div').remove()
      fic.summary = $desc.text().trim()
    }
    return scan
  }

  parseSearchLine (status) {
    let matched = status.match(qr`^Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+(${this.mGenres}))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+(${this.mNum})(?:\s+-\s+Reviews:\s+(${this.mNum}))?(?:\s+-\s+Favs: (${this.mNum}))?(?:\s+-\s+Follows:\s+(${this.mNum}))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$`)
    if (!matched) matched = status.match(qr`^Crossover - .*? - Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+(${this.mGenres}))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+(${this.mNum})(?:\s+-\s+Reviews:\s+(${this.mNum}))?(?:\s+-\s+Favs: (${this.mNum}))?(?:\s+-\s+Follows:\s+(${this.mNum}))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$`)
    if (!matched) matched = status.match(qr`^Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+(${this.mGenres}))?(?:\s+-\s+Chapters:\s+(\d+))?\s+-\s+Words:\s+(${this.mNum})(?:\s+-\s+Reviews:\s+(${this.mNum}))?(?:\s+-\s+Favs: (${this.mNum}))?(?:\s+-\s+Follows:\s+(${this.mNum}))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$`)
    if (!matched) matched = status.match(qr`^.* - Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+(${this.mGenres}))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+(${this.mNum})(?:\s+-\s+Reviews:\s+(${this.mNum}))?(?:\s+-\s+Favs: (${this.mNum}))?(?:\s+-\s+Follows:\s+(${this.mNum}))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$`)
    if (!matched) throw new Error('Unparseable: ' + status)
    let fandomMatch = status.match(/^(.*?) - Rated:/)
    let fandom = fandomMatch && fandomMatch[1].trim()
    let ficStatus = matched[12] && matched[12].trim()
    let cp = (matched[11] || '').trim()
    let characters = []
    let pairing = []
    if (cp === 'Complete') {
      ficStatus = 'Complete'
      cp = ''
    }
    if (/\[.+\]/.test(cp)) {
      pairing = cp.match(/\[(.+?)\]/g).map(p => p.slice(1,-1).split(/, /))
      cp = cp.replace(/\[(.*?)\]/g, '')
    }
    if (cp.length) {
      characters = cp.split(/, /).filter(c => c !== '').map(c => c.trim())
    }
    return {
      fandom: fandom,
      rating: matched[1],
      language: matched[2],
      genre: matched[3] ? matched[3].replace(qr`Hurt/Comfort`, 'HC').split(qr`/`).map(g => g === 'HC' ? 'Hurt/Comfort' : g) : [],
      chapterCount: this.num(matched[4] || 0),
      reviews: this.num(matched[6]),
      favs: this.num(matched[7]),
      follows: this.num(matched[8]),
      updated: this.date(matched[9]),
      published: this.date(matched[10]),
      characters: characters || [],
      pairing: pairing || [],
      status: ficStatus
    }
  }

  num (n) {
    return Number(String(n).replace(/,/g, ''))
  }

  date (d) {
    if (d==null) return d
    let parsed
    if (qr`/`.test(d)) {
      var sp = d.split(qr`/`)
      parsed = moment(sp[2] + '-' + sp[0] + '-' + sp[1], 'YYYY-MM-DD').unix()
    } else if (/(\d+)h/.test(d)) {
      const [, hours] = /(\d+)h/.exec(d)
      parsed = (Math.round(unixTime()/3600) - hours) * 3600
    } else if (/(\d+)m/.test(d)) {
      const [, min] = /(\d+)m/.exec(d)
      parsed = (Math.round(unixTime()/60) - min) * 60
    } else {
      parsed = moment(d, 'MM-DD').unix()
    }
    return isNaN(parsed) ? null : parsed
  }
}

module.exports = new FFNet()
module.exports.Class = FFNet
