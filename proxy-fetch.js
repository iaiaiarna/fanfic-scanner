'use strict'
const fetch = require('node-fetch')
const MOVED_PERM = 301
const FOUND = 302
const SEE_OTHER = 303
const TEMP_REDIR = 307
const PERM_REDIR = 308
const moved = [
  MOVED_PERM, FOUND, SEE_OTHER, TEMP_REDIR, PERM_REDIR
]
const REDIR_LIMIT = 10

module.exports = ficProxy => async function proxyFetch (link, opts, redirects = 0) {
  const proxyLink = ficProxy + '/' + link
  const follow = (!opts || !opts.redirect || opts.redirect === 'follow')
  if (!follow) return fetch(proxyLink, opts)
  const manualOpts = {...opts, redirect: 'manual'}
  const result = await fetch(proxyLink, manualOpts)
  if (moved.includes(result.status) && result.headers.has('location')) {
    await result.buffer()
    if (redirects >= REDIR_LIMIT) throw new Error('Maximum redirects reached at: ${link}')
    return proxyFetch(result.headers.get('location'), opts, redirects + 1)
  } else {
    return result
  }
}
