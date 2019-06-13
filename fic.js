'use strict'
const deeplyEquivalent = require('./deeply-equivalent.js')
const url = require('url')

class Fic {
  constructor (site) {
    this.rawContent = undefined

    this.setSite(site)
    this.siteId = undefined
    this.link = undefined
    this.published = undefined
    this.updated = undefined
    this.title = undefined
    this.rating = undefined
    this.language = undefined

    this.authors = []

    this.status = undefined
    this.words = undefined
    this.chapterCount = undefined
    this.maxChapterCount = undefined
    this.cover = undefined

    this.tags = []
    this.stats = {}

    this.summary = undefined

    // db holds some values that are full database fields, used in serialization/deserialization
    this.db = undefined
  }

  setSite (site) {
    if (typeof site === 'object') {
      this.site = site
      this.siteName = this.site.name
    } else if (typeof site === 'string') {
      try {
        this.site = require(`./site/${site}.js`)
        this.siteName = this.site.name
      } catch (_) {
        this.siteName = site
      }
    }
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
    if (!filterTags) return true // if there is no tag filter then its always a match
    return this.tags.some(_ => filterTags.test(_))
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
    this.setSite(obj.site)
    this.siteId = obj.siteId || obj.siteid
    this.link = obj.link
    this.published = obj.published
    this.updated = obj.updated
    this.title = obj.title
    this.rating = obj.rating
    this.language = obj.language

    obj.authors.forEach(_ => this.addAuthor(_.name, _.link))

    this.status = obj.status
    this.words = obj.words
    this.chapterCount = obj.chapterCount
    this.maxChapterCount = obj.maxChapterCount
    this.cover = obj.cover

    this.stats = {...obj.stats}
    this.tags = [...obj.tags]

    this.summary = obj.summary
    this.db = {...obj.db}

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
