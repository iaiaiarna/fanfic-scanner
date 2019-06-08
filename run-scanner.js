#!/usr/bin/env node
'use strict'
const scanner = require('./scanner.js')

const promisify = require('util').promisify
const readFile = promisify(require('fs').readFile)
const TOML = require('@iarna/toml')
require('@iarna/cli')(main)
  .usage('$0 [options] <conf>')
  .boolean('force-cache')
  .describe('force-cache', 'Force use of existing cache, never validate')
  .boolean('flush')
  .describe('flush', 'Flush all database to disk immediatelly, then return')
  .boolean('scanner')
  .default('scanner', true)
  .describe('scanner', 'Disabling the scanner will serve the existing database only')
  .boolean('now')
  .describe('now', 'Do ALL scans immediately')
  .boolean('once')
  .describe('once', 'Run only once. If no scans are schedule do exit without doing anything.')
  .boolean('reset')
  .describe('reset', 'Drop and recreate the database')
  .demand(1)
  .strict()
  .version()
  .help()

async function main (opts, confFile) {
  const conf = TOML.parse(await readFile(confFile))
  return Promise.all([
    scanner({...conf, ...opts})
  ])
}

