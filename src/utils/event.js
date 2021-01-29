export default class Event {
  constructor (type) {
    this.listener = {};
    this.type = type || '';
  }
  on(event, fn) {
    if (!this.listener[event]) {
      this.listener[event] = [];
    }
    this.listener[event].push(fn);
    return true;
  }
  off(event, fn) {
    if (this.listener[event]) {
      this.listener[event] = null;
      return true;
    }
    return false;
  }
  offAll() {
    this.listener = {};
  }
  dispatch(event, data) {
    if (this.listener[event])  {
      this.listener[event].forEach(cb => {
        cb.apply(null, [data]);
      })
      return true;
    }
    return false;
  }
}