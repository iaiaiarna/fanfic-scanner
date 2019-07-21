'use strict'
const deeplyEquivalent = require('./deeply-equivalent.js')
const url = require('url')
const validate = require('aproba')

function num (val) {
  if (val == null) return val
  return Number(val)
}

class Fic {
  constructor (site) {
    this._data = {
      site: undefined,
      siteName: undefined,
      siteId: undefined,
      link: undefined,
      published: undefined,
      updated: undefined,
      title: undefined,
      rating: undefined,
      language: undefined,

      status: undefined,
      words: undefined,
      chapterCount: undefined,
      maxChapterCount: undefined,
      cover: undefined,
      summary: undefined,
    }
    this.site = site

    this.authors = []
    this.tags = []
    this.stats = {}
    // db holds some values that are full database fields, used in serialization/deserialization
    this.db = undefined
  }

  get site () {
    return this._data.site
  }
  set site (site) {
    validate('O|S|Z', arguments)
    if (typeof site === 'object') {
      this._data.site = site
      this._data.siteName = this.site.name
    } else if (typeof site === 'string') {
      try {
        this._data.site = require(`./site/${site}.js`)
        this._data.siteName = this.site.name
      } catch (_) {
        this._data.siteName = site
      }
    }
    return this._data.site
  }
  get siteName () {
    return this._data.siteName
  }
  set siteName (siteName) {
    validate('S', arguments)
    try {
      this._data.site = require(`./site/${siteName}.js`)
    } catch (_) {
      // ignore errors
    } finally {
      return this._data.siteName = siteName
    }
  }
  get siteId () {
    return this._data.siteId
  }
  set siteId (id) {
    validate('Z|N|S', arguments)
    return this._data.siteId = id == null ? id : Number(id)
  }
  get link () {
    return this._data.link
  }
  set link (href) {
    validate('Z|S', arguments)
    return this._data.link = href
  }
  get published () {
    return this._data.published
  }
  set published (stamp) {
    validate('Z|N|S', arguments)
    return this._data.published = stamp == null ? stamp : Number(stamp)
  }
  get updated () {
    return this._data.updated
  }
  set updated (stamp) {
    validate('Z|N|S', arguments)
    return this._data.updated = stamp == null ? stamp : Number(stamp)
  }
  get title () {
    return this._data.title
  }
  set title (val) {
    validate('S', arguments)
    return this._data.title = val
  }

  get rating () {
    return this._data.rating
  }
  set rating (val) {
    validate('Z|S', arguments)
    return this._data.rating = val
  }

  get language () {
    return this._data.language
  }
  set language (val) {
    validate('Z|S', arguments)
    return this._data.language = val
  }

  get status () {
    return this._data.status
  }
  set status (val) {
    validate('Z|S', arguments)
    return this._data.status = val
  }

  get words () {
    return this._data.words
  }
  set words (val) {
    validate('Z|N|S', arguments)
    return this._data.words = val == null ? val : Number(val)
  }

  get chapterCount () {
    return this._data.chapterCount
  }
  set chapterCount (val) {
    validate('Z|N|S', arguments)
    return this._data.chapterCount = val == null ? val : Number(val)
  }

  get maxChapterCount () {
    return this._data.maxChapterCount
  }
  set maxChapterCount (val) {
    validate('Z|N|S', arguments)
    return this._data.maxChapterCount = val == null ? val : Number(val)
  }

  get cover () {
    return this._data.cover
  }
  set cover (val) {
    validate('Z|S', arguments)
    return this._data.cover = val
  }

  get summary () {
    return this._data.summary
  }
  set summary (val) {
    validate('Z|S', arguments)
    return this._data.summary = val
  }

  addAuthor (name_or_au, link, base) {
    let au
    if (arguments.length > 1) {
      if (this.site) {
        au = this.site.newAuthor(name_or_au, link, base)
      } else {
        au = {name: name_or_au}
        if (link) au.link = base ? url.resolve(base, link) : link
      }
    } else {
      au = name_or_au
    }
    if (this.authors.some(_ => (_.link||_.name) === (au.link||au.name))) return
    this.authors.push(au)
    this.authors.sort((aa, bb) => aa.name.localeCompare(bb.name) || (aa.link||'').localeCompare(bb.link))
    return au
  }

  tagMatch (filterTags) {
    if (!filterTags) return true
    return this.tags.some(_ => filterTags.test(_))
  }

  entryMatch (filterEntry) {
    if (!filterEntry) return true
    // filterEntry acts on ALL of the info we have, collectively.
    // originally it matched against "rawContent" which was a site specific
    // textual rendering of the entire fic page.
    // Using a more normalized form let's us only carry around data
    // that we'll store. It also makes the matching more predicatable.
    const content =
      'Tags: ' + this.tags.join(', ') + '\n' +
      'Title: ' + this.title + '\n' +
      'Summary: ' + this.summary
    return filterEntry.test(content)
  }

  equal (other) {
    if (typeof other !== 'object') return false
    return deeplyEquivalent(this.toJSON(), other.toJSON())
  }

  contentEqual (other) {
    if (typeof other !== 'object') return false
    return deeplyEquivalent(this.toDB(), other.toDB())
  }

  fromJSON (obj) {
    this.siteName = obj.site
    this.siteId = num(obj.siteId)
    this.link = obj.link
    this.published = num(obj.published)
    this.updated = num(obj.updated)
    this.title = obj.title
    this.rating = obj.rating
    this.language = obj.language

    obj.authors.forEach(_ => this.addAuthor(_.name, _.link))

    this.status = obj.status
    this.words = num(obj.words)
    this.chapterCount = num(obj.chapterCount)
    this.maxChapterCount = num(obj.maxChapterCount)
    this.cover = obj.cover

    this.stats = {...obj.stats}
    this.tags = [...obj.tags]

    this.summary = obj.summary
    this.db = {
      id: num(obj.db.id),
      updated: num(obj.db.updated),
      added: num(obj.db.added),
      scanned: num(obj.db.scanned),
      online: obj.db.online
    }

    return this
  }

  toDB () {
    return {
      site: this.siteName,
      siteId: this.siteId,
      link: this.link,
      published: this.published,
      updated: this.updated,
      title: this.title,
      rating: this.rating,
      language: this.language,

      authors: this.authors,

      status: this.status,
      words: this.words,
      chapterCount: this.chapterCount,
      maxChapterCount: this.maxChapterCount,
      cover: this.cover,

      stats: this.stats,
      tags: this.tags,

      summary: this.summary
    }
  }

  toJSON () {
    const json = this.toDB()
    json.db = this.db
    return json
  }
}

module.exports = Fic
