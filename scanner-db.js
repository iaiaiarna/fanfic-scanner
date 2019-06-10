'use strict'
const EventEmitter = require('events')
const { PG, sql } = require('@iarna/pg')
const fs = require('fs')
const fun = require('funstream')
const unixTime = require('./unix-time.js')
const Fic = require('./fic.js')
const validate = require('aproba')

class ScannerDB extends EventEmitter {
  constructor () {
    super()
    this.db = null
  }
  async init (dbfile) {
    this.db = new PG({connectionString: dbfile})
    const alreadyExists = await this.exists()
    if (!alreadyExists) await this.reset()
    return alreadyExists
  }

  async exists () {
    try {
      await this.db.run('SELECT sourceid FROM source LIMIT 1')
      return true
    } catch (err) {
      return false
    }
  }

  async reset () {
    let todo = `
      DROP TABLE IF EXISTS source_fic;
      DROP TABLE IF EXISTS source;
      DROP TABLE IF EXISTS fic;
      DROP TYPE IF EXISTS FIC_STATUS;
      CREATE TYPE FIC_STATUS AS ENUM ('active', 'deleted');
      CREATE TABLE source (
        sourceid SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        tags JSONB NOT NULL,
        lastSeen INTEGER,
        lastScan INTEGER
      );
      CREATE TABLE fic (
        ficid SERIAL PRIMARY KEY,
        site VARCHAR(40) NOT NULL,
        siteid INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        scanned INTEGER NOT NULL,
        added INTEGER NOT NULL,
        status FIC_STATUS NOT NULL DEFAULT 'active',
        content JSONB NOT NULL
      );
      CREATE UNIQUE INDEX idx_fic_identity ON fic (site, siteid);
      CREATE INDEX idx_fic_update_order ON fic (site, siteid, updated DESC);
      CREATE INDEX idx_link ON fic USING GIN ((content->'link'));
      CREATE INDEX idx_published ON fic USING GIN ((content->'published'));
      CREATE TABLE source_fic (
        sourceid SERIAL,
        ficid SERIAL,
        FOREIGN KEY(sourceid) REFERENCES source(sourceid) ON DELETE CASCADE,
        FOREIGN KEY(ficid) REFERENCES fic(ficid) ON DELETE CASCADE,
        PRIMARY KEY (sourceid, ficid)
      );
    `.split(';').map(_ => _.trim())
    for (let sql of todo) {
      await this.db.run(sql)
    }
  }

  async addSource (source) {
    validate('O', arguments)
    const tags = JSON.stringify(source.tags||[])
    return await this.db.serial(async txn => {
      const sourceid = await txn.value(sql`
        SELECT sourceid
        FROM source
        WHERE name=${source.name}
      `)
      if (sourceid) {
        await txn.run(sql`
          UPDATE source
          SET ${{tags}}
          WHERE sourceid=${sourceid}`)
        return sourceid
      } else {
        return await txn.value(sql`
          INSERT
          INTO source (name, tags) 
          VALUES (${source.name}, ${tags})
          RETURNING sourceid`)
      }
    })
  }

  async setLastSeen (sourceid, lastSeen) {
    validate('NN', arguments)
    await this.db.run(sql`
      UPDATE source SET ${{lastSeen}} WHERE sourceid=${sourceid}`)
  }

  async setLastScan (sourceid, lastScan) {
    validate('NN', arguments)
    await this.db.run(sql`
      UPDATE source SET ${{lastScan}} WHERE sourceid=${sourceid}`)
  }

  async replace (sourceid, fic) {
    validate('NO', arguments)
    return await this.db.serial(async txn => {
      const existing = await txn.get(sql`
        SELECT ficid, updated
        FROM fic
        WHERE site=${fic.siteName} AND siteid=${fic.siteId}`)
      const now = unixTime()
      let sourceFic
      let ficid
      if (existing) {
        ficid = existing.ficid
        if (existing.updated > existing.scanned || fic.updated >= existing.updated) {
          await txn.run(sql`
            UPDATE fic
            SET content=${JSON.stringify(fic)},
                updated=${fic.updated},
                scanned=${now},
                status='active'
            WHERE ${{ficid}}`)
          this.emit('updated', {
            db: {
              updated: fic.updated,
              scanned: now,
              status: 'active',
            },
            ...(fic.toJSON ? fic.toJSON() : fic)
          })
        }
        sourceFic = await txn.get(sql`
          SELECT ficid, sourceid
          FROM source_fic
          WHERE ficid=${existing.ficid} AND sourceid=${sourceid}`)
      } else {
        const scanned = (fic.db && fic.db.scanned) || now
        const added = (fic.db && fic.db.added) || now
        const updated = fic.updated || (fic.db && fic.db.updated)
        const status = (fic.db && fic.db.status) || 'active'
        ficid = await txn.value(sql`
          INSERT
          INTO fic (site, siteid, updated, added, scanned, status, content)
          VALUES (${fic.siteName}, ${fic.siteId}, ${updated}, ${added}, ${scanned}, ${status}, ${JSON.stringify(fic)})
          RETURNING ficid`)
        this.emit('updated', {
          db: {updated, added, scanned, status},
          ...(fic.toJSON ? fic.toJSON() : fic)
        })
      }
      if (!sourceFic) {
        await txn.run(sql`
          INSERT
          INTO source_fic (sourceid, ficid)
          VALUES (${sourceid}, ${ficid})`)
      }
    })
  }

  async getById (site, siteId) {
    validate('SN', arguments)
    return this._rowToFic(await this.db.get(sql`
      SELECT content, updated, added, scanned, status
      FROM fic
      WHERE site=${siteName}
        AND siteid=${siteId}`))
  }

  async getByIds (sourceid, ids) {
    validate('NA', arguments)
    if (ids.length === 0) return []
    return (await this.db.all(sql`
      SELECT content, updated, added, scanned, status
      FROM fic
      JOIN source_fic USING (ficid)
      WHERE ${{sourceid}} AND siteid IN ${ids}`))
     .map(_ => this._rowToFic(_))
  }

  async lastSeen (sourceid) {
    validate('N', arguments)
    return await this.db.value(sql`
      SELECT lastSeen
      FROM source
      WHERE sourceid=${sourceid}`)
  }

  async lastScan (sourceid) {
    validate('N', arguments)
    return await this.db.value(sql`
      SELECT lastScan
      FROM source
      WHERE sourceid=${sourceid}`)
  }

  async delete (fic) {
    validate('O', arguments)
    return await this.db.run(sql`
      DELETE
      FROM fic
      WHERE site=${fic.siteName},
            siteid=${fic.siteId}`)
  }

  serialize (sourceid) {
    validate('N', arguments)
    const result = fun()

    this.db.readonly(async txn => {
      const meta = await txn.get(sql`
        SELECT lastSeen, lastScan
        FROM source
        WHERE sourceid=${sourceid}`)
      meta.SOURCE = true
      result.write(meta)
      return txn.iterate(sql`
        SELECT content, site, updated, added, scanned, status
        FROM fic
        JOIN source_fic USING (ficid)
        WHERE sourceid=${sourceid}
        ORDER BY updated
      `).pipe(result)
    }).catch(err => result.emit('error', err))

    return result
      .map(_ => this._rowToFic(_))
      .toNdjson()
  }

  ficsSince (when) {
    validate('N', arguments)
    return this.db.iterate(sql`
      SELECT content, site, updated, added, scanned, status
      FROM fic
      WHERE updated >= ${when}
      ORDER BY updated
      `).map(_ => this._rowToFic(_))
  }
  end () {
    return this.db.end()
  }
  _rowToFic (row) {
    const {site, updated, added, scanned, status} = row
    return new Fic(site).fromJSON({db: {updated, added, scanned, status}, ...row.content})
  }
}

const db = new ScannerDB()

/*
Database methods from the point-of-view of a source
*/

class ScannerSource {
  constructor (source) {
    this.source = source
    this.sourceid = null
  }
  async init () {
    this.sourceid = await db.addSource(this.source)
  }
  setLastSeen (lastSeen) {
    validate('N', arguments)
    if (!this.sourceid) return Promise.reject(new Error('setLastSeen called without init()'))
    return db.setLastSeen(this.sourceid, lastSeen)
  }
  setLastScan (lastScan) {
    validate('N', arguments)
    if (!this.sourceid) return Promise.reject(new Error('setLastScan called without init()'))
    return db.setLastScan(this.sourceid, lastScan)
  }
  replace (fic) {
    validate('O', arguments)
    if (!this.sourceid) return Promise.reject(new Error('replace called without init()'))
    if (!(fic instanceof Fic)) return Promise.reject(new Error('replace called with non-Fic object'))
    return db.replace(this.sourceid, fic)
  }
/* not in use
  get (match) {
    validate('O', arguments)
    if (match.site && match.siteId) {
      return db.getdById(match.site, match.siteId)
    } else {
      return Promise.reject(new Error('No index available for getting fics by ' + JSON.stringify(match)))
    }
  }
*/
  getByIds (ids) {
    validate('A', arguments)
    if (!this.sourceid) return Promise.reject(new Error('getByIds called without init()'))
    return db.getByIds(this.sourceid, ids)
  }
  lastSeen () {
    if (!this.sourceid) return Promise.reject(new Error('lastSeen called without init()'))
    return db.lastSeen(this.sourceid)
  }
  lastScan () {
    if (!this.sourceid) return Promise.reject(new Error('lastScan called without init()'))
    return db.lastScan(this.sourceid)
  }
/* not used
  delete (fic) {
    validate('O', arguments)
    return db.delete(fic)
  }
  ficsSince (when) {
    validate('N', arguments)
    return db.ficsSince(when)
  }
*/
  serialize () {
    if (!this.sourceid) return Promise.reject(new Error('serialize called without init()'))
    return db.serialize(this.sourceid)
  }
}

module.exports = ScannerSource
ScannerSource.db = db
