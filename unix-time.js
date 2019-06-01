'use strict'

module.exports = function unixTime () {
  return Math.floor(new Date().getTime()/1000)
}
