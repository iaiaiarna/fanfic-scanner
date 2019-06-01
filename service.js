'use strict'

module.exports = function service ({start, stop}) {
  let markComplete
  const complete = new Promise(resolve => markComplete = resolve)
  const status = {
    complete: new Promise(resolve => {
      resolve(start().finally(stop))
    }),
    stop
  }
  return status
}
