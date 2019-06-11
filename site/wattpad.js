'use strict'
const Site = require('../site.js')
const Scan = require('../scan.js')
const moment = require('moment')
const qr = require('@perl/qr')

class WattPad extends Site {
  constructor () {
    super()
    this.name = 'wattpad'
  }
  fetchLink (href) {
    // we transform human searches into the internal JSON API search--the website returned by
    // the human search URL makes a request for this end point
    return href.replace(qr`https://www[.]wattpad[.]com/search/(.*)`, 
      'https://www.wattpad.com/v4/search/stories/?query=$1&mature=true&limit=100&fields=stories(id%2Ctitle%2CvoteCount%2CreadCount%2CcommentCount%2Cdescription%2Cmature%2Ccompleted%2Ccover%2Curl%2CnumParts%2Cuser(name)%2ClastPublishedPart(createDate)%2Cpromoted%2Csponsor(name%2Cavatar)%2Ctags%2Ctracking(clickUrl%2CimpressionUrl%2CthirdParty(impressionUrls%2CclickUrls))%2Ccontest(endDate%2CctaLabel%2CctaURL))%2Ctotal%2Ctags%2CnextUrl')
  }
  linkFromId (siteId) {
    return `https://www.wattpad.com/story/${siteId}`
  }
  parseScan (scanLink, rawJson) {
    const json = JSON.parse(rawJson)
    const nextPage = json.nextUrl
    const scan = new Scan(this, this.normalizeLink(nextPage, scanLink))

    for (let story of json.stories) {
      const fic = scan.addFic()
      // Some fic don't carry any date data, which renders them unusable for
      // our purposes
      if (!story.lastPublishedPart.createDate) continue
      fic.updated = moment(story.lastPublishedPart.createDate).unix()
      fic.siteId = story.id
      fic.link = this.linkFromId(fic.siteId)
      fic.rawContent = JSON.stringify(story)

      fic.title = story.title.trim()
      fic.addAuthor({
        name: story.user.name,
        link: `https://www.wattpad.com/user/${story.user.name}`
      })
      fic.summary = story.description
        .replace(/</g, '&lt;')
        .replace(/\n/g, '<br>\n')
        .replace(/^\s+|\s+$/mg, '')
      fic.chapterCount = story.numParts
      fic.stats.comments = story.commentCount
      fic.stats.kudos = story.voteCount
      fic.stats.hits = story.readCount
      fic.tags = fic.tags.concat(story.tags)
      fic.cover = story.cover
      if (story.mature) {
        fic.rating = 'Explicit'
      }
      if (story.completed) {
        fic.status = 'complete'
      } else {
        fic.status = 'in-progress'
      }
    }
    return scan
  }
}

module.exports = new WattPad()
module.exports.Class = WattPad
