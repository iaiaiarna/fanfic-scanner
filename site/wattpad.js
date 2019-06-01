'use strict'
const Site = require('../site.js')
const url = require('url')
const cheerio = require('cheerio')
const moment = require('moment')
const done = new Error()
const qr = require('@perl/qr')

const site = module.exports = {
  ...Site,
  parseScan,
  fetchLink (href) {
    return href.replace(qr`https://www[.]wattpad[.]com/search/(.*)`, 
      'https://www.wattpad.com/v4/search/stories/?query=$1&mature=true&limit=100&fields=stories(id%2Ctitle%2CvoteCount%2CreadCount%2CcommentCount%2Cdescription%2Cmature%2Ccompleted%2Ccover%2Curl%2CnumParts%2Cuser(name)%2ClastPublishedPart(createDate)%2Cpromoted%2Csponsor(name%2Cavatar)%2Ctags%2Ctracking(clickUrl%2CimpressionUrl%2CthirdParty(impressionUrls%2CclickUrls))%2Ccontest(endDate%2CctaLabel%2CctaURL))%2Ctotal%2Ctags%2CnextUrl')
  },
  linkFromId (siteId, href) {
    return `https://www.wattpad.com/story/${siteId}`
  }
}

async function parseScan (scanLink, rawJson, pageId) {
  const json = JSON.parse(rawJson)
  const nextPage = json.nextUrl
  const scan = {
    nextPage: nextPage && url.resolve(scanLink, nextPage),
    fics: [],
  }

  for (let story of json.stories) {
    const fic = new Site.ScanFic()
    scan.fics.push(fic)
    fic.site = 'wattpad'
    // Some fic don't carry any date data, which renders them unusable for
    // our purposes
    if (!story.lastPublishedPart.createDate) continue
    fic.updated = moment(story.lastPublishedPart.createDate).unix()
    fic.siteId = story.id
    fic.link = this.linkFromId(fic.siteId, story.url)
    fic.rawContent = JSON.stringify(story)

    fic.title = story.title.trim()
    fic.authors.push({
      name: story.user.name,
      link: `https://www.wattpad.com/user/${story.user.name}`
    })
    fic.summary = story.description
    fic.chapterCount = story.numParts
    fic.stats.comments = story.commentCount
    fic.stats.kudos = story.voteCount
    fic.stats.hits = story.readCount
    fic.tags = fic.tags.concat(story.tags)
    fic.cover = story.cover
    if (story.mature) {
      fic.tags.push('NSFW')
    }
    if (story.completed) {
      fic.tags.push(story.numParts === 1 ? 'status:one-shot' : 'status:complete')
    }
  }
  return scan
}
