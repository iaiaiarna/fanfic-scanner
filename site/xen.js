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
    return url.resolve(href, `/threads/${siteId}`)
  },
  normalizeAuthorLink (href, base) {
    if (!href) return href
    return this.normalizeLink(href, base)
      .replace(qr`/members/[^.]+[.](\d+)/?$`, '/members/$1')
  },
  normalizeLink (href, base) {
    if (!href) return href
    // force ssl
    if (!/index.php/.test(href)) href = href.replace(/^http:/, 'https:')
    // resolve base url
    if (base) href = url.resolve(base, href)
    // normalize post urls
    href = href.replace(qr`/threads/[^/]+/(?:page-\d+)?#post-(\d+)$`, '/posts/$1')
               .replace(qr`(/posts/[^/]+)/$`, '$1')
               .replace(qr`/threads/([^./]+[.])?(\d+)([/].*)?$`, '/threads/$2')
               .replace(qr`/goto/post[?]id=(\d+).*?$`, '/posts/$1')
    return href
  }
}

async function parseScan (scanLink, html, pageId) {
  const site = url.parse(scanLink).hostname.replace(/^.*[.]([^.]+[.][^.]+)$/, '$1')
  const $ = cheerio.load(html)

  let list = $('li.discussionListItem')
  let fromForum = true
  if (list.length === 0) {
    fromForum = false
    list = $('li.searchResult')
  }

  const base = $('base').attr('href') || scanLink

  const items = []
  list.each((ii, item) => { items.push($(item)) })

  const nextPage = $('link[rel=next]').attr('href')
  const scan = {
    nextPage: nextPage && url.resolve(base, nextPage),
    fics: [],
  }

  for (let $item of items) {
    const fic = new Site.ScanFic()
    
    fic.site = site
    const lastPost = fromForum ? $item.find('.lastPostInfo .DateTime') : $item.find('.meta .DateTime')
    fic.updated = lastPost.attr('data-time')
                  ? moment.unix(lastPost.attr('data-time')).unix()
                  : moment.utc(lastPost.attr('title'), 'MMM DD, YYYY [at] h:mm A Z').unix()
    fic.rawContent = $item.text().trim()
    if (!fic.updated) {
      // This happens when a fic moved to another section and a link is left behind
      // we don't bother trying to capture these as they should be picked up
      // at the place they were moved to.
      continue
    }
    scan.fics.push(fic)

    const linkAndTitle = $item.find('.title a.PreviewTooltip').length ? $item.find('.title a.PreviewTooltip') : $item.find('h3.title a')
    const idMatch = url.resolve(base, linkAndTitle.first().attr('href')
      .replace(/[/]unread/, ''))
      .match(/[/]threads[/](?:.*?[.])?(\d+)/)
    fic.siteId = idMatch && idMatch[1]
    fic.link = this.linkFromId(fic.siteId, base)
    fic.title = linkAndTitle.first().text().trim()
    const $author = $item.find('a.username').first()
    const author = $author.text()
    const authorUrl = this.normalizeAuthorLink($author.attr('href') && url.resolve(base, $author.attr('href')))
    fic.authors.push({name: author, link: authorUrl})
    const $stats = $item.find('div.stats').first()
    const firstPostLikes = Number(($stats.attr('title') || '').replace('.*: ', ''))
    const stats = {}
    $stats.find('dl').each((ii, stat) => {
      const $stat = $(stat)
      const name = $stat.find('dt').text().trim().replace(/:$/, '')
      const value = Number($stat.find('dd').text().trim().replace(/,/g, ''))
      stats[name] = value
    })
    fic.stats.replies = stats['Replies']
    fic.stats.views = stats['Views']
    $item.find('.title .prefix').each((ii, prefix) => {
      const $prefix = $(prefix)
      fic.tags.push('section:' + $prefix.text().trim())
    })
    $item.find('a.tag').each((ii, tag) => {
      const $tag = $(tag)
      fic.tags.push('freeform:' + $tag.text().trim())
    })
    if (/in forum:\s*Quest/i.test($item.find('.meta').text())) {
      fic.tags.push('forum:Quest')
    }
    if (!fic.tags.some(_ => _.startsWith('status:') && /(?<!never )\b(complete|finished)\b/i.test(title))) {
      fic.tags.push('status:complete')
    }
  }
  return scan
}
