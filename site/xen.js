'use strict'
const Site = require('../site.js')
const Scan = require('../scan.js')
const Fic = require('../fic.js')
const url = require('url')
const cheerio = require('cheerio')
const moment = require('moment')
const qr = require('@perl/qr')

class XenFic extends Fic {
  tagMatch (filterTags) {
    if (!filterTags) return true // if there is no tag filter then its always a match
    return super.tagMatch(filterTags)
        // also check the title, 'cause true tags are rare/incomplete on
        // xenforo sites
        || filterTags.test(this.title)
  }
}

class XenForo extends Site {
  constructor () {
    super()
    this.name = 'xen'
  }

  newFic (obj) {
    return obj ? new XenFic(this).fromJSON(obj) : new XenFic(this)
  }

  linkFromId (siteId, baseLink) {
    return this.normalizeLink(`/threads/${siteId}`, baseLink)
  }

  normalizeAuthorLink (href, base) {
    if (!href) return
    return super.normalizeAuthorLink(href, base)
      .replace(qr`/members/[^.]+[.](\d+)/?$`, '/members/$1')
  }

  normalizeFicLink (href, base) {
    if (!href) return
    return super.normalizeFicLink(href, base)
      .replace(qr`/threads/[^/]+/(?:page-\d+)?#post-(\d+)$`, '/posts/$1')
      .replace(qr`(/posts/[^/]+)/$`, '$1')
      .replace(qr`/threads/([^./]+[.])?(\d+)([/].*)?$`, '/threads/$2')
      .replace(qr`/goto/post[?]id=(\d+).*?$`, '/posts/$1')
  }

  parseScan (scanLink, html) {
    // NOTE: This is an _extremely_ naive domain name extractor.  It takes
    // the last two names in the fqdn, so this'll pick bar.baz from
    // foo.bar.baz.  This is right in the common case, but may be wrong for
    // some forums.  Making this a bit smarter would be keen.
    const siteName = url.parse(scanLink).hostname.replace(/^.*[.]([^.]+[.][^.]+)$/, '$1')
    const $ = cheerio.load(html)

    let list = $('li.discussionListItem')
    let fromForum = true
    if (list.length === 0) {
      fromForum = false
      list = $('li.searchResult')
    }


    const items = []
    list.each((ii, item) => { items.push($(item)) })

    const nextPage = $('link[rel=next]').attr('href')
    const base = $('base').attr('href') || scanLink
    const scan = new Scan(this, this.normalizeLink(nextPage, base))

    for (let $item of items) {
      const fic = scan.addFic()
      fic.siteName = siteName

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

      const linkAndTitle = $item.find('.title a.PreviewTooltip').length ? $item.find('.title a.PreviewTooltip') : $item.find('h3.title a')
      const rawLink = linkAndTitle.first().attr('href')
      const idMatch = rawLink && this.normalizeFicLink(rawLink, base)
        .replace(/[/]unread/, '')
        .match(/[/]threads[/](?:.*?[.])?(\d+)/)
      fic.siteId = idMatch && idMatch[1]
      fic.link = this.linkFromId(fic.siteId, base)
      const $author = $item.find('a.username').first()
      const author = $author.text()
      const authorUrl = $author.attr('href')
      fic.addAuthor(author, authorUrl, base)
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
      linkAndTitle.find('.prefix').remove()
      fic.title = linkAndTitle.first().text().trim()
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
}

module.exports = new XenForo()
module.exports.Class = XenForo
module.exports.Fic = XenFic
