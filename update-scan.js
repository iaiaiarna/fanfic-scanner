'use strict'
module.exports = updateScan

const url = require('url')
const { Site } = require('@fanfic/parser')
const deeplyEquivalent = require('./deeply-equivalent.js')

function ficEqual (ficA, ficB) {
  if (typeof ficA !== 'object') return false
  if (typeof ficB !== 'object') return false
  return deeplyEquivalent(ficA.toJSON(), ficB.toJSON())
}

async function updateScan (fetch, activeScan) {
  const site = Site.create(activeScan.conf.engine || activeScan.conf.link)

  let lastSeen = await activeScan.data.lastSeen() || 0
  let nextPage = activeScan.conf.link
  let pageId = url.parse(activeScan.conf.link).hash
  const authors = activeScan.conf.authors && activeScan.conf.authors.map(_ => {
    return site.newAuthor(_.name, _.link)
  })
  let newerThan = lastSeen
  while (nextPage) {
    const res = await fetch(site.fetchLink(nextPage))
    const scan = site.parseScan(nextPage, await res.buffer(), pageId)
    const existingItems = {}
    const existingFics = await activeScan.data.getByIds(scan.fics.map(_ => _.siteId))
    existingFics.forEach(existing => {
      if (existing == null) return
      existingItems[existing.siteId] = existing
    })

    nextPage = scan.nextPage
    let sawAnyNewer
    for (let fic of scan.fics) {
      if (authors) authors.forEach(au => fic.addAuthor(au))
      const updated = fic.updated
      if (updated > newerThan) {
        sawAnyNewer = true
      }
      if (updated > lastSeen) {
        lastSeen = updated
      }
      if (!fic.siteId) {
        //console.error('Skipping, no id', fic.link)
        continue
      }

      const existing = existingItems[fic.siteId]

      // no changes, skip
      if (ficEqual(fic, existing)) continue

      const tagMatch = fic.tagMatch(activeScan.conf.filterTags)
      const entryMatch = fic.entryMatch(activeScan.conf.filterEntry)
      if (existing || tagMatch || entryMatch) {
        await activeScan.data.replace(fic)
      }
    }
    if (newerThan && !sawAnyNewer) break
  }
  if (lastSeen > newerThan) {
    await activeScan.data.setLastSeen(lastSeen)
  }
}
