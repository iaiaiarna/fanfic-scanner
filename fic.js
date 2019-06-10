'use strict'
const deeplyEquivalent = require('./deeply-equivalent.js')

class Fic {
  constructor (site) {
    this.rawContent = undefined
    this.site = site
    this.siteName = site.name
    this.siteId = undefined
    this.link = undefined
    this.published = undefined
    this.updated = undefined
    this.title = undefined
    this.authors = []
    this.summary = undefined
    this.words = undefined
    this.chapterCount = undefined
    this.maxChapterCount = undefined
    this.cover = undefined
    this.tags = []
    this.stats = {}
  }

  addAuthor (name_or_au, link) {
    const au = link ? this.site.newAuthor(name_or_au, link) : name_or_au
    if (this.authors.some(_ => _.link === au.link)) return
    this.authors.push(au)
    this.authors.sort((aa, bb) => aa.name.localeCompare(bb.name) || aa.link.localeCompare(bb.link))
    return au
  }

  tagMatch (filterTags) {
    if (!filterTags) return true // if there is no tag filter then its always a match
    return this.tags.some(_ => filterTags.test(_))
  }

  equal (other) {
    return deeplyEquivalent(this.toJSON(), other.toJSON())
  }

  fromJSON (obj) {
    this.site = require(`./site/${obj.site}.js`)
    this.siteName = obj.site
    this.link = obj.link
    this.updated = obj.updated
    this.title = obj.title
    obj.authors.forEach(_ => this.addAuthor(_.name, _.link))
    this.words = obj.words
    this.chapterCount = obj.chapterCount
    this.cover = obj.cover
    this.stats = {...obj.stats}
    this.tags = [...obj.tags]
    this.summary = obj.summary
    return this
  }
      
  toJSON () {
    return {
      site: this.siteName,
      siteId: this.siteId,
      link: this.link,
      published: this.published,
      updated: this.updated,
      title: this.title,
      authors: this.authors,
      words: this.words,
      chapterCount: this.chapterCount,
      maxChapterCount: this.maxChapterCount,
      cover: this.cover,
      stats: this.stats,
      tags: this.tags,
      summary: this.summary,
    }
  }
}

module.exports = Fic
