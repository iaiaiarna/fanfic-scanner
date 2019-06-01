'use strict'
const EventEmitter = require('events')
const Koa = require('koa')
const TOML = require('@iarna/toml')
const fs = require('fs')
const path = require('path')
const fun = require('funstream')
const ScannerDB = require('./scanner-db.js')
const qr = require('@perl/qr')
const Handlebars = require('handlebars')
const http = require('http')
const logger = require('koa-logger')
const callLimit = require('./call-limit.js')
const proxyFetch = require('./proxy-fetch.js')
const unixTime = require('./unix-time.js')
const service = require('./service.js')

const sbTemplate = Handlebars.compile(fs.readFileSync(`${__dirname}/scanner-scoreboard.html`, 'utf8'))

const db = {}
const status = {
  scannerService: false,
  scanRunning: false,
  scanStarted: null,
  scanCompleted: null,
  activeScans: {}
}

module.exports = scan

async function scan (userConf) {
  const conf = {
    ...userConf
  }
  conf.fetch = callLimit(proxyFetch(conf['fic-proxy']), 50)

  await loadDatabase(conf)

  const scanner = conf.scanner && startScanner(conf)
  const webservice = startWebService(conf)
  const scannerComplete = scanner && scanner.complete.then(() => webservice.stop())

  process.once('SIGINT', () => {
    console.error("\nSIGINT: Exiting...")
    webservice.stop()
    scanner && scanner.stop()
  })

  await Promise.all([
    scannerComplete,
    webservice.complete
  ])

  await closeDatabase()
}

function startWebService (conf) {
  let webSrv

  return service({
    start (status) {
      // Koa web service that returns all recorrds updated after a particular
      // date and then feeds them in real time after that forever.  ndjson
      // output.
      // since it works from memory, it has access to a fully updated db at all times
      // access can't happen in our time slice, so when we hit the end, register a listener
      // to emit anything extra. That's it.
      // just need to clean up after the consumer drops the connection.
      const web = new Koa()
      if (conf.requestlog) web.use(logger())
      web.use(routeRequest)
      webSrv = http.createServer(web.callback()).listen(conf.port)
      return new Promise((resolve, reject) => {
        web.once('error', reject)
        webSrv.once('error', reject)
        webSrv.once('close', resolve)
      })
    },
    async stop () {
      webSrv.close()
    }
  })

  async function routeRequest (ctx, next) {
    if (ctx.request.path === '/') {
      const accepts = ctx.accepts('html', 'json')
      if (accepts === 'json') {
        ctx.status = 200
        ctx.body = scoreBoard()
      } else {
        ctx.status = 200
        ctx.body = sbTemplate(scoreBoard())
      }
      return next()
    } else if (ctx.path === '/updates') {
      const since = Number(ctx.query.since) || unixTime()
      ctx.status = 200
      ctx.type = 'application/x-ndjson'
      await emitSince(ctx, since)
      return next()
    }
  }
}

async function emitSince (ctx, since) {
  ctx.body = fun()
  const start = unixTime()
  const db = ScannerDB.db
  const queued = []
  const queue = fic => queued.push(fic)
  const forward = fic => {
    console.error('forwarding', fic.siteId)
    ctx.body.write(JSON.stringify(fic) + '\n')
  }
  let ended = false
  const endHandler = reason => _ => {
    console.error('************', 'ending', reason, new Error().stack)
    ended = true
    db.removeListener('updated', queue)
    db.removeListener('updated', forward)
  }

  ctx.res.once('finish', endHandler('finish'))
  ctx.res.once('close', endHandler('close'))
  ctx.res.once('error', endHandler('error'))
  
  setImmediate(async () => {
    console.log('querying', since, start)
    if (since != null) {
      console.error('fetching fic since', since)
      db.on('updated', queue)
      let cnt = 0
      for await (let fic of db.ficsSince(since)) {
        ++cnt
        if (ended) return
        ctx.body.write(JSON.stringify(fic) + '\n')
          || await ctx.body.fun.writable()
      }
      let qcnt = 0
      while (queued.length) {
        ++ qcnt
        ctx.body.write(queued.shift() + '\n')
          || await ctx.body.fun.writable()
      }
      db.removeListener('updated', queue)
      console.error('flushing queue', cnt, qcnt)
    }
    console.error('setting up final forward')
    db.on('updated', forward)
  })
}

function scoreBoard () {
  const sb = {
    online: Boolean(status.scannerService),
    running: status.scanRunning,
    started: status.scanStarted,
    completed: status.scanCompleted,
    queued: status.queuedScans,
    active: []
  }
  for (let host of Object.keys(status.activeScans)) {
    sb.active.push({name: host, ...status.activeScans[host]})
  }
  return sb
}

function loadTOML (file) {
  try {
    return TOML.parse(fs.readFileSync(file))
  } catch (ex) {
    console.error('Trying to read:', file)
    throw ex
  }
}

async function loadDatabase (conf) {
  console.log('Opening DB')
  const existing = (await ScannerDB.db.init(conf.dbfile || ':memory:')) && !conf.reset
  if (conf.reset) await ScannerDB.db.reset()
  for (let filename of conf.sources) {
    const srcConf = loadTOML(filename)
    for (let source of srcConf.source) {
      if (!source.name) throw new Error("Sources must have names, no name found in: " + JSON.stringify(source))
      const dbfile = (path.dirname(filename)||'.') + '/' + (srcConf.name || path.basename(filename, '.toml')) + '-' + source.name + '.db'
      source.filterTags = source.filterTags || srcConf.filterTags
      if (source.filterTags) {
        if (source.filterTags[0] === '^') {
          source.filterTags = qr.i`${[source.filterTags]}`
        } else {
          source.filterTags = qr.i`\b${[source.filterTags]}\b`
        }
      }
      source.filterEntry = source.filterEntry || srcConf.filterEntry
      if (source.filterEntry) {
        source.filterEntry = qr.i`${[source.filterEntry]}`
      }
      source.filterAuthor = source.filterAuthor || srcConf.filterAuthor
      source.tags = source.tags || srcConf.tags
      source.engine = source.engine || srcConf.engine
      source.schedule = source.schedule || srcConf.schedule
      db[dbfile] = {
        filename,
        dbfile,
        conf: source,
        lastRun: null,
        data: new ScannerDB({...source, name: path.basename(dbfile)})
      }
      await db[dbfile].data.init()
      if (!existing) await importData(db[dbfile])
      db[dbfile].lastRun = await db[dbfile].data.lastScan()
    }
  }
  console.log('Database online')
}
async function closeDatabase () {
  await ScannerDB.db.end()
}

function startScanner (conf) {
  if (status.scannerService) throw new Error("Scanner already running")

  let finish
  const finished = new Promise(resolve => finish = resolve)
  return service({
    async start () {
      await runScans(conf)
      if (conf.once) {
        finish()
      } else {
        status.scannerService = setInterval(runScans, 60000, conf)
      }
      return finished
    },
    async stop () {
      if (status.scannerService) clearInterval(status.scannerService)
      finish()
    }
  })
}

async function importData (scan) {
console.log('importing', scan.dbfile)
  try {
    for await (let fic of fun(fs.createReadStream(scan.dbfile)).ndjson()) {
      await scan.data.replace(fic)
    }
  } catch (ex) {
    if (ex.code !== 'ENOENT') throw ex
  }
  return scan
}

async function runScans (conf) {
  if (status.scanRunning) return
  const now = unixTime()
  const activeScans = conf.now ? Object.values(db) : Object.values(db).filter(_ => inSchedule(now, _))
  if (activeScans.length === 0) return
  status.scanRunning = true
  status.scanStarted = now
  status.queuedScans = activeScans.length
  const run = callLimit(runScan, 20)
  try {
    await Promise.all(activeScans.map(_ => run(_, conf).catch(err => {
      console.error('Skipping due to error:', err)
    })))
  } finally {
    status.scanCompleted = unixTime()
    status.scanRunning = false
  }
}

function inSchedule (now, scan) {
  // never ran, should be run
  if (!scan.lastRun) return true
  const sinceLast = now - scan.lastRun
  const howOften = scan.conf.schedule || 3599
  return sinceLast >= howOften
}

async function runScan (scan, conf) {
  const now = unixTime()
  console.log('Scanning', scan.dbfile, 'Starting')
  scan.lastRun = unixTime()
  status.activeScans[scan.dbfile] = {
    started: scan.lastRun,
    engine: scan.conf.engine,
    activity: 'scanning'
  }
  const site = require(`./site/${scan.conf.engine}.js`)
  const opts = conf['force-cache'] ? {headers:{'cache-control': 'prefer-cached'}} : {}
  await site.updateScan(link => conf.fetch(link, opts), scan)
  status.activeScans[scan.dbfile].activity = 'saving'
  await saveData(scan)
  delete status.activeScans[scan.dbfile]
  await scan.data.setLastScan(scan.lastRun)
  console.log('Scanning', scan.dbfile, 'Complete')
}

async function saveData (scan) {
  try {
    await scan.data.serialize().map(_ => `${_}\n`).pipe(fs.createWriteStream(scan.dbfile + '.new'))
    fs.renameSync(scan.dbfile + '.new', scan.dbfile)
  } catch (err) {
    console.error('saveData', err.stack)
    try {
      fs.unlinkSync(scan.dbfile + '.new')
    } catch (_) {}
  }
}
