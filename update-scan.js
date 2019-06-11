'use strict'
module.exports = updateScan

const url = require('url')

async function updateScan (fetch, activeScan) {
  const site = require(`./site/${activeScan.conf.engine}.js`)

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
      if (activeScan.conf.filterEntry && !activeScan.conf.filterEntry.test(fic.rawContent)) continue

      if (!fic.siteId) {
        //console.error('Skipping, no id', fic.link)
        continue
      }
      const existing = existingItems[fic.siteId]

      // no changes, skip
      if (fic.equal(existing)) continue

      // Tag matching ALSO looks at the title, due to sites that put tags in the title
      const tagMatch = fic.tagMatch(activeScan.conf.filterTags)

      if (existing || tagMatch) {
        await activeScan.data.replace(fic)
      }
    }
    if (newerThan && !sawAnyNewer) break
  }
  if (lastSeen > newerThan) {
    await activeScan.data.setLastSeen(lastSeen)
  }
}
