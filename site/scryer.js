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
  const nextPage = $('a[rel=next]').attr('href')
  const scan = {
    nextPage: nextPage && url.resolve(scanLink, nextPage),
    fics: [],
  }

  const items = []
  $('div.panel').each((ii, item) => {
    items.push($(item))
  })

  for (let $item of items) {
    const fic = new Site.ScanFic()
    scan.fics.push(fic)
    fic.site = 'ffnet'
    const $footer = $item.find('div.panel-footer')
    fic.updated = moment($footer.find('time').attr('datetime')).unix()
    fic.published = moment($footer.find('strong').first().attr('title').replace(/Published: (\S+) (\S+) UTC/, '$1T$2Z')).unix()
    fic.rawContent = $item.text().trim()

    const $storyLink = $item.find('a.story-link')
    fic.title = $storyLink.attr('data-story')
    const matchId = url.resolve(scanLink, $storyLink.attr('href')).match(/[/]s[/](\d+)/)
    fic.siteId = matchId && matchId[1]
    fic.link = this.linkFromId(fic.siteId, scanLink)
    const $authorLink = $item.find('a.author-link')
    const author = $authorLink.text().trim()
    const authorUrl = $authorLink.attr('href') && this.normalizeAuthorLink(url.resolve(scanLink, $authorLink.attr('href')))
    fic.authors.push({name: author, link: authorUrl})
    const $summary = $item.find('div.story-summary')
    const labels = []
    const $labels = $summary.find('span.label')
    $labels.each((ii, label) => {
      const $label = $(label)
      labels.push($label.text().trim())
      $label.remove()
    })
    fic.summary = $summary.text().trim()
    $footer.find('span.text-muted').first().remove()
    $footer.find('.fa-angle-left').each((ii, angle) => $(angle).text('<'))
    $footer.find('.fa-angle-right').each((ii, angle) => $(angle).text('>'))
    const footer = $footer.text().trim().replace(/\s+/g, ' ')
    const info = ffp(footer)
    const {rating, words, reviews, favs, follows, chapterCount, status} = info
    fic.words = words
    fic.stats.reviews = reviews || 0
    fic.stats.favs = favs || 0
    fic.stats.follows = follows || 0
    fic.tags.push.apply(fic.tags, []
      .concat(info.genre.map(_ => `genre:${_}`))
      .concat([`rating:${rating}`])
      .concat(info.characters.map(_ => `character:${c}`))
      .concat(info.pairing.map(p => `ship:${p.join('/')}`))
      .concat(labels.map(_ => `freeform:${_}`)))

    if (info.status === 'Complete') {
      if (info.chapterCount <= 1) {
        fic.tags.push('status:one-shot')
      } else {
        fic.tags.push('status:complete')
      }
    }
  }
}

//Complete - T - Romance - Ginny W. - 1,108 words - 1 chapter - 0 reviews - 0 favorites - 0 follows
const hn = qr`[\d,]+`
const genre = qr`(?:General|Romance|Humor|Drama|Poetry|Adventure|Mystery|Horror|Parody|Angst|Supernatural|Suspense|Sci-Fi|Fantasy|Spiritual|Tragedy|Western|Crime|Family|Hurt[/]Comfort|Friendship|[/])`
function ffp (status) {
  let matched = status.match(qr`^(.*?) - (.*?) - (?:(${genre}(?:/${genre})*) )?- (?:(.*?) )?- (${hn}) words - (${hn}) chapterCount? - (${hn}) reviews? - (${hn}) favorites? - (${hn}) follows?$`)
  if (!matched) throw new Error('Unparseable: »' + status + '«')
  let cp = matched[4] || ''
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
    rating: matched[2],
    genre: matched[3] ? matched[3].replace(/Hurt[/]Comfort/, 'HC').split(/[/]/).map(g => g === 'HC' ? 'Hurt/Comfort' : g) : [],
    chapterCount: num(matched[6] || 0),
    words: num(matched[5]),
    reviews: num(matched[7]),
    favs: num(matched[8]),
    follows: num(matched[9]),
    characters: characters || [],
    pairing: pairing || [],
    status: matched[1]
  }
}
function num (n) {
  return Number(String(n).replace(/,/g, ''))
}
