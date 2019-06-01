'use strict'
const defaultMaxRunning = 50

const limit = module.exports = (func, maxRunning) => {
  const state = {running: 0, queue: []}
  if (!maxRunning) maxRunning = defaultMaxRunning
  return function limited () {
    const args = Array.prototype.slice.call(arguments)
    const self = this
    if (state.running >= maxRunning) {
      return new Promise(resolve => {
        state.queue.push({resolve, self, args})
      })
    }
    return callFunc(this, args)
  }
  function callNext () {
    return function () {
      if (state.queue.length) {
        const next = state.queue.shift()
        next.resolve(callFunc(next.self, next.args))
      }
    }
  }
  async function callFunc (self, args) {
    ++state.running
    try {
      return await func.apply(self, args)
    } finally {
      --state.running
      callNext()()
    }
  }
}

module.exports.method = (classOrObj, method, maxRunning) => {
  if (typeof classOrObj === 'function') {
    const func = classOrObj.prototype[method]
    classOrObj.prototype[method] = limit(func, maxRunning)
  } else {
    const func = classOrObj[method]
    classOrObj[method] = limit(func, maxRunning)
  }
}
