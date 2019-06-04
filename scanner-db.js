'use strict'
const EventEmitter = require('events')
const { PG, sql } = require('@iarna/pg')
const fs = require('fs')
const fun = require('funstream')
const unixTime = require('./unix-time.js')

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
    await this.db.run(sql`
      UPDATE source SET ${{lastSeen}} WHERE sourceid=${sourceid}`)
  }

  async setLastScan (sourceid, lastScan) {
    await this.db.run(sql`
      UPDATE source SET ${{lastScan}} WHERE sourceid=${sourceid}`)
  }

  async replace (site, sourceid, fic) {
    if (!sourceid) throw new Error('MUST HAVE SOURCE')
    return await this.db.serial(async txn => {
      const existing = await txn.get(sql`
        SELECT ficid, updated
        FROM fic
        WHERE site=${site} AND siteid=${fic.siteId}`)
      const now = unixTime()
      let sourceFic
      let ficid
      if (existing) {
        ficid = existing.ficid
        if (existing.updated > existing.scanned || fic.updated >= existing.updated) {
          await txn.run(sql`
            UPDATE fic
            SET content=${JSON.stringify(fic)}, updated=${fic.updated}, scanned=${now}, status='active'
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
          SELECT *
          FROM source_fic
          WHERE ficid=${existing.ficid} AND sourceid=${sourceid}`)
      } else {
        ficid = await txn.value(sql`
          INSERT
          INTO fic (site, siteid, updated, added, scanned, content)
          VALUES (${site}, ${fic.siteId}, ${fic.updated}, ${now}, ${now}, ${JSON.stringify(fic)})
          RETURNING ficid`)
        this.emit('updated', {
          db: {
            updated: fic.updated,
            scanned: now,
            status: 'active'
          },
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
    const content = await this.db.value(sql`
      SELECT content
      FROM fic
      WHERE site=${site}
        AND siteid=${siteId}`)
    return content
  }

  async getByIds (sourceid, ids) {
    if (ids.length === 0) return []
    return (await this.db.all(sql`SELECT content FROM fic JOIN source_fic USING (ficid) WHERE ${{sourceid}} AND siteid IN ${ids}`))
  }

  async lastSeen (sourceid) {
    return await this.db.value(sql`
      SELECT lastSeen
      FROM source
      WHERE sourceid=${sourceid}`)
  }

  async lastScan (sourceid) {
    return await this.db.value(sql`
      SELECT lastScan
      FROM source
      WHERE sourceid=${sourceid}`)
  }

  async delete (fic) {
    return await this.db.run(sql`
      DELETE
      FROM fic
      WHERE site=${fic.site},
            siteid=${fic.siteId}`)
  }

  serialize (sourceid) {
    const result = fun().toNdjson()

    this.db.readonly(async txn => {
      const meta = await txn.get(sql`
        SELECT lastSeen, lastScan
        FROM source
        WHERE sourceid=${sourceid}`)
      meta.SOURCE = true
      result.write(meta)
      return txn.iterate(sql`
        SELECT content
        FROM fic
        JOIN source_fic USING (ficid)
        WHERE sourceid=${sourceid}
        ORDER BY updated
      `).map(_ => _.content).pipe(result)
    }).catch(err => result.emit('error', err))

    return result
  }

  ficsSince (when) {
    return this.db.iterate(sql`
      SELECT content, updated, scanned, status
      FROM fic
      WHERE updated >= ${when}
      ORDER BY updated
      `).map(_ => ({db: {updated: _.updated, scanned: _.scanned, status:_.status}, ..._.content}))
  }
  end () {
    return this.db.end()
  }
}

const db = new ScannerDB()

class ScannerSource {
  constructor (source) {
    this.source = source
    this.site = source.site
    this.sourceid = null
  }
  async init () {
    this.sourceid = await db.addSource(this.source)
  }
  async setLastSeen (lastSeen) {
    return await db.setLastSeen(this.sourceid, lastSeen)
  }
  async setLastScan (lastScan) {
    return await db.setLastScan(this.sourceid, lastScan)
  }
  async replace (fic) {
    if (fic.SOURCE) {
      return await this.setLastSeen(fic.lastSeen)
    } else {
      return await db.replace(fic.site || this.site, this.sourceid, fic)
    }
  }
  async get (match) {
    if (match.siteId) {
      return await db.getById(this.site, match.siteId)
    } else {
      throw new Error('No index available for getting fics by ' + JSON.stringify(match))
    }
  }
  async getByIds (ids) {
    return await db.getByIds(this.sourceid, ids)
  }
  async lastSeen () {
    return await db.lastSeen(this.sourceid)
  }
  async lastScan () {
    return await db.lastScan(this.sourceid)
  }
  async delete (fic) {
    return await db.delete(fic)
  }
  serialize () {
    return db.serialize(this.sourceid)
  }
}

module.exports = ScannerSource
ScannerSource.db = db
