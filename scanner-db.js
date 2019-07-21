'use strict'
const EventEmitter = require('events')
const { PG, sql } = require('@iarna/pg')
const fun = require('funstream')
const unixTime = require('./unix-time.js')
const Fic = require('./fic.js')
const validate = require('aproba')

class ScannerDB extends EventEmitter {
  constructor () {
    super()
    this.db = null
  }
  init (dbfile) {
    this.db = new PG({connectionString: dbfile})
    return this.exists()
  }

  async exists () {
    try {
      await this.db.run('SELECT servicename FROM services LIMIT 1')
      return true
    } catch (err) {
      return false
    }
  }

  name () {
    return 'scanner'
  }

  async reset () {
    let todo = `
      DROP TABLE IF EXISTS services;
      CREATE TABLE services (
        servicename VARCHAR(20) PRIMARY KEY,
        laststarted INTEGER,
        lastrecord INTEGER
      );
      INSERT INTO services (servicename) VALUES ('${this.name()}');
      DROP TABLE IF EXISTS source_fic;
      DROP TABLE IF EXISTS source;
      DROP TABLE IF EXISTS fic;
      DROP TYPE IF EXISTS FIC_STATUS;
      CREATE TYPE FIC_STATUS AS ENUM ('active', 'deleted');
      CREATE TABLE source (
        sourceid SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        tags JSONB NOT NULL,
        lastseen INTEGER,
        lastscan INTEGER
      );
      CREATE TABLE fic (
        ficid SERIAL PRIMARY KEY,
        site VARCHAR(40) NOT NULL,
        siteid INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        scanned INTEGER NOT NULL,
        added INTEGER NOT NULL,
        online FIC_STATUS NOT NULL DEFAULT 'active',
        content JSONB NOT NULL
      );
      CREATE UNIQUE INDEX idx_fic_identity ON fic (site, siteid);
      CREATE INDEX idx_fic_scanned_order ON fic (scanned DESC, updated DESC);
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

  noteStart (time) {
    return this.db.run(sql`UPDATE services SET laststarted=${time} WHERE servicename=${this.name()}`)
  }
  noteRecord (time) {
    return this.db.run(sql`UPDATE services SET lastrecord=${time} WHERE servicename=${this.name()}`)
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

  async setLastSeen (sourceid, lastseen) {
    validate('NN', arguments)
    await this.db.run(sql`
      UPDATE source SET ${{lastseen}} WHERE sourceid=${sourceid}`)
  }

  async setLastScan (sourceid, lastscan) {
    validate('NN', arguments)
    await this.db.run(sql`
      UPDATE source SET ${{lastscan}} WHERE sourceid=${sourceid}`)
  }

  async replace (sourceid, fic) {
    validate('NO', arguments)
    return await this.db.serial(async txn => {
      const existing = await this.getById(fic.siteName, fic.siteId)
      const now = unixTime()
      let sourceFic
      let newFic
      if (existing) {
        if (fic.updated >= existing.updated) {
          const toUpdate = {
            online: 'active'
          }
          if (!fic.contentEqual(existing)) {
            toUpdate.content = fic.toDB()
          }
          if (fic.updated >= existing.updated) {
            toUpdate.updated = fic.updated
          }
          if (fic.scanned >= existing.scanned) {
            toUpdate.scanned = fic.scanned
          }
          this.emit('updated', newFic = this._rowToFic(await txn.get(sql`
            UPDATE fic
            SET ${toUpdate}
            WHERE ficid=${existing.db.ficid}
            RETURNING *`)))
          await this.noteRecord(now)
        } else {
          newFic = existing
        }
        sourceFic = await txn.get(sql`
          SELECT ficid, sourceid
          FROM source_fic
          WHERE ficid=${existing.db.ficid} AND sourceid=${sourceid}`)
      } else {
        const scanned = (fic.db && fic.db.scanned) || now
        const added = (fic.db && fic.db.added) || now
        const updated = fic.updated == null ? (fic.db && fic.db.updated) : fic.updated
        const online = (fic.db && fic.db.online) || 'active'
        this.emit('updated', newFic = this._rowToFic(await txn.get(sql`
          INSERT
          INTO fic (site, siteid, updated, added, scanned, online, content)
          VALUES (${fic.siteName}, ${fic.siteId}, ${updated}, ${added}, ${scanned}, ${online}, ${{$$jsonb:fic.toDB()}})
          RETURNING *`)))
        await this.noteRecord(now)
      }
      if (!sourceFic) {
        await txn.run(sql`
          INSERT
          INTO source_fic (sourceid, ficid)
          VALUES (${sourceid}, ${newFic.db.ficid})`)
      }
    })
  }

  async getById (siteName, siteId) {
    validate('SN', arguments)
    return this._rowToFic(await this.db.get(sql`
      SELECT fic.*
      FROM fic
      WHERE site=${siteName}
        AND siteid=${siteId}`))
  }

  async getByIds (sourceid, ids) {
    validate('NA', arguments)
    if (ids.length === 0) return []
    return (await this.db.all(sql`
      SELECT fic.*, source_fic.sourceid
      FROM fic
      JOIN source_fic USING (ficid)
      WHERE ${{sourceid}} AND siteid IN ${ids}`))
     .map(_ => this._rowToFic(_))
  }

  async lastSeen (sourceid) {
    validate('N', arguments)
    return await this.db.value(sql`
      SELECT lastseen
      FROM source
      WHERE sourceid=${sourceid}`)
  }

  async lastScan (sourceid) {
    validate('N', arguments)
    return await this.db.value(sql`
      SELECT lastscan
      FROM source
      WHERE sourceid=${sourceid}`)
  }

/*
  async delete (fic) {
    validate('O', arguments)
    return await this.db.run(sql`
      DELETE
      FROM fic
      WHERE site=${fic.siteName},
            siteid=${fic.siteId}`)
  }
*/

  serialize (sourceid) {
    validate('N', arguments)
    const result = fun()

    this.db.readonly(async txn => {
      const meta = await txn.get(sql`
        SELECT lastseen, lastscan
        FROM source
        WHERE sourceid=${sourceid}`)
      meta.SOURCE = true
      result.write(meta)
      return txn.iterate(sql`
        SELECT fic.*
        FROM fic
        JOIN source_fic USING (ficid)
        WHERE sourceid=${sourceid}
        ORDER BY site, siteid
      `).map(_ => this._rowToFic(_)).pipe(result)
    }).catch(err => result.emit('error', err))

    return result
      .toNdjson()
  }

  ficsSince (when) {
    validate('N', arguments)
    return this.db.iterate(sql`
      SELECT fic.*
      FROM fic
      WHERE updated >= ${when}
      ORDER BY scanned, updated
      `).map(_ => this._rowToFic(_))
  }
  end () {
    return this.db.end()
  }
  _rowToFic (row) {
    if (!row) return row
    const {content, site, ficid, updated, added, scanned, online} = row
    return new Fic(site).fromJSON({db: {ficid, updated, added, scanned, online}, ...content})
  }
}

module.exports = new ScannerDB()
module.exports.Class = ScannerDB
