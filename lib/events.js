// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var domain;
var inherits = require('_inherits').inherits;
var InternalTask = require('task').InternalTask;
var util = require('util');

function assert(expr) {
  if (!expr)
    throw new Error('Assertion failure');
}

function EventEmitter() {
  this.domain = null;
  if (EventEmitter.usingDomains) {
    // if there is an active domain, then attach to it.
    domain = domain || require('domain');
    if (domain.active && !(this instanceof domain.Domain)) {
      this.domain = domain.active;
    }
  }
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}

exports.EventEmitter = EventEmitter;

EventEmitter.usingDomains = false;

EventEmitter.prototype.domain = undefined;
EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;


// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!util.isNumber(n) || n < 0)
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (util.isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (this.domain) {
        if (!er) er = new TypeError('Uncaught, unspecified "error" event.');
        er.domainEmitter = this;
        er.domain = this.domain;
        er.domainThrown = false;
        this.domain.emit('error', er);
      } else if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (util.isUndefined(handler))
    return false;

  if (this.domain && this !== process)
    this.domain.enter();

  if (util.isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (util.isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  if (this.domain && this !== process)
    this.domain.exit();

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              util.isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (util.isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (util.isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!util.isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  function g() {
    this.removeListener(type, g);
    listener.apply(this, arguments);
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (util.isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (util.isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (util.isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (util.isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (util.isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};


function ListenerTask(resource, type, fn) {
  // Expect InternalTask to at least set _parent
  InternalTask.call(this);
  this._resource = resource;
  this._type = type;
  this._fn = fn;
  this._setParent(currentTask);
}

inherits(ListenerTask, InternalTask);

ListenerTask.prototype._abandon = function() {
  // Listeners can be abandoned silently
  this._end();
}

ListenerTask.prototype._complete = function() {
  this._end();
}

ListenerTask.prototype._fail = function() {
  assert(!'ListenerTask should never fail because nothing ever runs in the context of a ListenerTask!');
}


ListenerTask.prototype._invoke = function ListenerTask$_invoke (args) {
  if (args)
    args = [this._type].concat(args);
  else
    args = [this._type];

  this._parent._apply(this._fn, args);
}


function OnceListenerTask() {
  ListenerTask.apply(this, arguments);
}

inherits(OnceListenerTask, ListenerTask);


OnceListenerTask.prototype._invoke = function OnceListenerTask$_invoke(args) {
  if (args)
    args = [this._type].concat(args);
  else
    args = [this._type];

  this._parent._apply(this._fn, args);
  this._removeListener();
}


function Resource() {
  InternalTask.call(this);
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || EventEmitter.defaultMaxListeners;
}

inherits(Resource, InternalTask);
exports.Resource = Resource;


Resource.prototype.setMaxListeners = function(n) {
  if (typeof n !== 'number' || n < 0)
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
};


Resource.prototype.emit = function(type, err) {
  if (currentTask !== this) {
    console.error("(node) warning: emitting Resource event '%s' from an unrelated task. You shouldn't do that.", type);
    console.trace();
  }

  if (type === 'error') {
    // Stupid shit. Just doing it for backwards compat.
    var r = typeof this._events.error !== 'undefined' &&
            this._events.error.length > 0;
    this._fail(err);
    return r;
  }

  var listeners = this._events[type];

  if (typeof listeners === 'undefined')
    return false;

  if (this.domain && this !== process)
    this.domain.enter();

  var args = Array.prototype.slice.call(arguments, 1);

  for (var i = 0; i < listeners.length; i++)
    listeners[i]._invoke(args);

  if (this.domain && this !== process)
    this.domain.exit();

  return i > 0;
}


Resource.prototype.addListener = Resource.prototype.on = function Resource$on(type, fn) {
  var listeners;

  if (type in this._events)
    listeners = this._events[type];
  else
    listeners = this._events[type] = [];

  listeners.push(new ListenerTask(this, type, fn));

  return this;
}


Resource.prototype.once = function Resource$once(type, fn) {
  var listeners;

  if (type in this._events)
    listeners = this._events[type];
  else
    listeners = this._events[type] = [];

  listeners.push(new OnceListenerTask(this, type, fn));

  return this;
}

Resource.prototype._removeTaskListener = function(type, listener) {
  var listeners = this._events[type];

  for (var i = 0; i < listeners.length; i++)
    if (listeners[i] === listener)
      return listeners.splice(i, 1), this;

  return this;
}


// TODO: should removeListener refuse or warn about removing listeners that are removed by a task
// that is different from the task that added the listener?
Resource.prototype.removeListener = function(type, fn) {
  var parent = global.currentTask,
      listeners = this._events[type];

  if (typeof listeners === 'undefined')
    return this;

  var index = -1, altIndex = -1;

  for (var i = 0; i < listeners.length; i++) {
    var listener = listeners[i];

    // The listener constructor should have set these properties.
    assert(typeof listener._fn === 'function');
    assert(typeof listener._parent);

    if (listener._fn === fn) {
      if (listener._parent === parent) {
        index = i;
        break;
      } else if (altIndex === -1) {
        altIndex = i;
      }
    }
  }

  if (index === -1 && altIndex !== -1) {
    console.error("(node) warning: '%s' listener (%s) is being removed by a task that didn't add it.",
                  type,
                  fn.name || 'anonymous');
    console.trace();
    index = altIndex;
  }

  if (index !== -1)
    listeners.splice(index, 1)[0]._end();

  return this;
}



Resource.prototype.removeAllListeners = function(type) {
  throw new Error('TODO: implement me');
};


Resource.prototype.listeners = function(type) {
  throw new Error('TODO: implement me');
};


Resource.prototype.listenerCount = function(type) {
  if (!this._events[type])
    return 0;
  else
    return this._events[type].length;
};


Resource.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};
