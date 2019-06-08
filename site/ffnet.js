'use strict'
const Site = require('../site.js')
const url = require('url')
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')

const site = module.exports = {
  ...Site,
  parseScan,
  linkFromId (siteId, href) {
    return `https://www.fanfiction.net/s/${siteId}`
  }
}

async function parseScan (scanLink, html, pageId) {
  const $ = cheerio.load(html)
  const nextPage = $('a:contains(Next »)').attr('href')
  const scan = {
    nextPage: nextPage && url.resolve(scanLink, nextPage),
    fics: [],
  }

  const items = []
  const findWith = pageId ? `${pageId} .z-list` : '.z-list'
  $(findWith).each((ii, item) => {
    items.push($(item))
  })

  for (let $item of items) {
    const fic = new Site.ScanFic()
    scan.fics.push(fic)
    fic.updated = moment.unix($item.find('span[data-xutime]').first().attr('data-xutime')).unix()
    fic.rawContent = $item.text().trim()

    const matchId = url.resolve(scanLink, $item.find('a.stitle').attr('href'))
      .match(/[/]s[/](\d+)/)
    fic.site = 'ffnet'
    fic.siteId = matchId && matchId[1]
    fic.link = this.linkFromId(fic.siteId, scanLink)
    fic.title = $item.find('a.stitle').text().trim()
    let $author = $item.find('a.stitle').next('a')
    if ($author.text().trim() === '') $author = $author.next('a')
    const author = $author.text().trim()
    const authorUrl = $author.attr('href') && this.normalizeAuthorLink(url.resolve(scanLink, $author.attr('href')))
    fic.authors.push({name: author, link: authorUrl})
    const infoline = $item.find('.xgray').text()
    const info = parseSearchLine(infoline)
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
    const img = img_src ? url.resolve(scanLink, img_src).replace(qr`/(75|150)/`, '/180/') : undefined
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

// this is not quite the same as fetch-fic's ffp as the format is different in search (of course!)
function parseSearchLine (status) {
  let matched = status.match(/^Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+((?:General|Romance|Humor|Drama|Poetry|Adventure|Mystery|Horror|Parody|Angst|Supernatural|Suspense|Sci-Fi|Fantasy|Spiritual|Tragedy|Western|Crime|Family|Hurt[/]Comfort|Friendship|[/])+))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+([\d,]+)(?:\s+-\s+Reviews:\s+([\d,]+))?(?:\s+-\s+Favs: ([\d,]+))?(?:\s+-\s+Follows:\s+([\d,]+))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$/)
  if (!matched) matched = status.match(/^Crossover - .*? - Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+((?:General|Romance|Humor|Drama|Poetry|Adventure|Mystery|Horror|Parody|Angst|Supernatural|Suspense|Sci-Fi|Fantasy|Spiritual|Tragedy|Western|Crime|Family|Hurt[/]Comfort|Friendship|[/])+))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+([\d,]+)(?:\s+-\s+Reviews:\s+([\d,]+))?(?:\s+-\s+Favs: ([\d,]+))?(?:\s+-\s+Follows:\s+([\d,]+))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$/)
  if (!matched) matched = status.match(/^Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+((?:General|Romance|Humor|Drama|Poetry|Adventure|Mystery|Horror|Parody|Angst|Supernatural|Suspense|Sci-Fi|Fantasy|Spiritual|Tragedy|Western|Crime|Family|Hurt[/]Comfort|Friendship|[/])+))?(?:\s+-\s+Chapters:\s+(\d+))?\s+-\s+Words:\s+([\d,]+)(?:\s+-\s+Reviews:\s+([\d,]+))?(?:\s+-\s+Favs: ([\d,]+))?(?:\s+-\s+Follows:\s+([\d,]+))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$/)
  if (!matched) matched = status.match(/^.* - Rated:\s+(\S+)\s+-\s+([^-]+)(?:\s+-\s+((?:General|Romance|Humor|Drama|Poetry|Adventure|Mystery|Horror|Parody|Angst|Supernatural|Suspense|Sci-Fi|Fantasy|Spiritual|Tragedy|Western|Crime|Family|Hurt[/]Comfort|Friendship|[/])+))?\s+-\s+Chapters:\s+(\d+)\s+-\s+Words:\s+([\d,]+)(?:\s+-\s+Reviews:\s+([\d,]+))?(?:\s+-\s+Favs: ([\d,]+))?(?:\s+-\s+Follows:\s+([\d,]+))?(?:\s+-\s+Updated:\s+([^-]+))?\s+-\s+Published:\s+([^-]+)(?:\s+-\s+(.+?))?(?:\s+-\s+(.+?))?$/)
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
  const current = now()
  const updated = date(matched[9])
  const published = date(matched[10])
  return {
    fandom: fandom,
    rating: matched[1],
    language: matched[2],
    genre: matched[3] ? matched[3].replace(/Hurt[/]Comfort/, 'HC').split(/[/]/).map(g => g === 'HC' ? 'Hurt/Comfort' : g) : [],
    chapterCount: num(matched[4] || 0),
    reviews: num(matched[6]),
    favs: num(matched[7]),
    follows: num(matched[8]),
    updated: isNaN(updated) ? null : updated,
    published: isNaN(published) ? null : published,
    characters: characters || [],
    pairing: pairing || [],
    status: ficStatus
  }
}

function num (n) {
  return Number(String(n).replace(/,/g, ''))
}
function date (d) {
  if (d==null) return d
  if (/[/]/.test(d)) {
    var sp = d.split(/[/]/)
    return moment(sp[2] + '-' + sp[0] + '-' + sp[1], 'YYYY-MM-DD').unix()
  } else if (/(\d+)h/.test(d)) {
    const [, hours] = /(\d+)h/.exec(d)
    return (Math.round(now()/3600) - hours) * 3600
  } else if (/(\d+)m/.test(d)) {
    const [, min] = /(\d+)m/.exec(d)
    return (Math.round(now()/60) - min) * 60
  } else {
    return moment(d, 'MM-DD').unix()
  }
}
function now () {
  return moment().unix()
}
