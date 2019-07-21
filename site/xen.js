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

class ItemParser {
  constructor ($, $item) {
    this.$ = $
    this.$item = $item
  }
  find (search) {
    const result = []
    this.$item.find(search).each((_, item) => {
      result.push(this.$(item))
    })
    return result
  }
  findText (search) {
    return this.find(search).map($_ => $_.text().trim())
  }
  first (search) {
    return this.$item.find(search).first()
  }

  $author () {
    return this.first('a.username')
  }
  authorName () {
    return this.$author().text().trim()
  }
  authorLink () {
    const href = this.$author().attr('href')
    return href ? href.trim() : undefined
  }
  updated () {
    const lastPost = this.$lastPostDate()
    return lastPost.attr('data-time')
           ? moment.unix(lastPost.attr('data-time')).unix()
           : moment.utc(lastPost.attr('title'), 'MMM DD, YYYY [at] h:mm A Z').unix()
  }
  link () {
    return this.$linkAndTitle().attr('href')
  }
  title () {
    return this.$linkAndTitle().text().trim()
  }
  summary () {
  }
  words () {
  }
  stats () {
    const $stats = this.$stats()
    const firstPostLikes = ($stats.attr('title') || '').replace(/.*: /, '')
    const stats = {}
    $stats.find('dl').each((ii, stat) => {
      const $stat = this.$(stat)
      const name = $stat.find('dt').text().trim().replace(/:$/, '')
      const value = $stat.find('dd').text().trim().replace(/,/g, '')
      stats[name] = value
    })
    return {
      replies: stats['Replies'],
      views: stats['Views'],
      likes: firstPostLikes
    }
  }
  tags () {
    const tags = []
    for (let forum of this._forums()) {
      tags.push(`forum:${forum}`)
    }
    for (let section of this._sections()) {
      tags.push(`section:${section}`)
    }
    for (let tag of this._tags()) {
      tags.push(`freeform:${tag}`)
    }
    return tags
  }
  _forums () {
    return [ this.$('meta[property="og:title"]').attr('content').trim() ]
  }

  status () {
    if (/(?<!never )\b(complete|finished)\b/i.test(this.title())) {
      return 'complete'
    }
  }
}

class Forum20ItemParser extends ItemParser {
  $lastPostDate () {
    return this.first('.lastPostInfo .DateTime')
  }
  $stats () {
    return this.first('div.stats')
  }
  $linkAndTitle () {
    let $linkAndTitle = this.$item.find('.title a.PreviewTooltip')
    if ($linkAndTitle.length === 0) {
      // xen v0 styling
      $linkAndTitle = this.$item.find('h3.title a')
    }
    return $linkAndTitle
  }
  title () {
    const $linkAndTitle = this.$linkAndTitle().clone()
    $linkAndTitle.find('.prefix').remove()
    return $linkAndTitle.first().text().trim()
  }
  _sections () {
    return this.findText('.title .prefix')
  }
  _tags () {
    return this.findText('a.tag')
  }
}

class Search20ItemParser extends Forum20ItemParser {
  $lastPostDate () {
    return this.first('.meta .DateTime')
  }
  summary () {
    return this.first('.snippet a').html().trim()
  }
  words () {
    return this.$item.find('a.wordcount').text()
  }
  stats () {
    const infoLine = this.first('div.meta').text()
    const matched = infoLine.match(/\b([\d,]+\w?) replies/)
    return {
      replies: matched[1]
    }
  }
  _forums () {
    const infoLine = this.first('div.meta').text()
    const matched = infoLine.match(/in forum: (.*)/)
    return [matched[1]]
  }
}
class Forum21ItemParser extends ItemParser {
  $lastPostDate () {
    return this.first('div.structItem-cell--latest time')
  }
  $stats () {
    return this.first('div.structItem-cell--meta')
  }
  $linkAndTitle () {
    return this.first('div.structItem-title a[data-tp-primary="on"]')
  }
  _sections () {
    return this.findText('.labelLink .label')
  }
  _tags () {
    return this.findText('a.tagItem')
  }
}
class Search21ItemParser extends ItemParser {
  $lastPostDate () {
    return this.first('time.u-dt')
  }
  summary () {
    return this.first('.contentRow-snippet').html().trim()
  }
  stats () {
    const [ $replies ] = this.find('.contentRow-minor .listInline li')
      .filter(_ => /Replies:/.test(_.text()))
    const [, replies] = $replies.text().match(/Replies: ([,\d]+\w*)/)
    return {
      replies
    }
  }
  words () {
    return this.$item.find('a.wordcount').attr('data-word_count')
  }
  $linkAndTitle () {
    return this.first('.contentRow-title a')
  }
  title () {
    const $linkAndTitle = this.$linkAndTitle().clone()
    $linkAndTitle.find('.label').remove()
    return $linkAndTitle.first().text().trim()
  }
  _forums () {
    const infoLine = this.find('contentRow-minor listInline li')
    const [$forum] = infoLine.filter(_ => /Forum:/.test(_.text()))
    return $forum ? [$forum.find('a').text().trim()] : []
  }
  _sections () {
    return this.findText('.label')
  }
  _tags () {
    return []
  }
}

const XenVersions = {
  'li.discussionListItem': Forum20ItemParser,
  'li.searchResult': Search20ItemParser,
  'div.js-threadList > div': Forum21ItemParser,
  'li.block-row': Search21ItemParser
}

function itemList ($) {
  for (let search of Object.keys(XenVersions)) {
    const $results = $(search)
    if ($results.length) {
      const ItemParser = XenVersions[search]
      const results = []
      $results.each((_, item) => {
        results.push(new ItemParser($, $(item)))
      })
      return results
    }
  }
  return []
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

    const nextPage = $('link[rel=next]').attr('href')
    const base = $('base').attr('href') || scanLink
    const scan = new Scan(this, this.normalizeLink(nextPage, base))

    for (let item of itemList($)) {
      const fic = scan.addFic()
      fic.siteName = siteName
      fic.updated = item.updated()

      if (!fic.updated) {
        // This happens when a fic moved to another section and a link is left behind
        // we don't bother trying to capture these as they should be picked up
        // at the place they were moved to.
        continue
      }

      const rawLink = item.link()
      const idMatch = rawLink && this.normalizeFicLink(rawLink, base)
        .replace(/[/]unread/, '')
        .match(/[/]threads[/](?:.*?[.])?(\d+)/)
      fic.siteId = idMatch && idMatch[1]
      fic.title = item.title()
      fic.link = this.linkFromId(fic.siteId, base)
      const author = item.authorName()
      const authorUrl = item.authorLink()
      fic.addAuthor(author, authorUrl, base)
      fic.summary = item.summary()
      fic.words = this.num(item.words())
      const stats = item.stats()
      for (let stat of Object.keys(stats)) {
        fic.stats[stat] = this.num(stats[stat])
      }
      fic.tags.push(...item.tags())
      fic.status = item.status()
    }
    return scan
  }
  num (n) {
    if (/K$/.test(n)) {
      return Number(n.replace(/K$/, '')) * 1000
    } else if (/M$/.test(n)) {
      return Number(n.replace(/M$/, '')) * 1000000
    } else if (n == null) {
      return
    } else {
      return Number(n)
    }
  }
}

module.exports = new XenForo()
module.exports.Class = XenForo
module.exports.Fic = XenFic
