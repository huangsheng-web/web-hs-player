/**
 * 视频流buffer管理
 * */
import Event from '../utils/event';
import * as debug from '../utils/debug';
export default class BufferController extends Event {

  static get ERROR_EVENT() {
    return 'ERROR_EVENT'
  }

  constructor(sourceBuffer, cleanOffset) {

    super('BufferController');

    this.TAG = '[BufferController]';

    this.sourceBuffer = sourceBuffer;


    this.sourceBuffer.addEventListener('updateend', this._onUpdateEnd.bind(this));
    this.sourceBuffer.addEventListener('onerror', this._onError.bind(this));

    this.queue = []; // buffer队列

    this.cleanRanges = []; // 可清除的buffer

    this.cleaning = false; // 是否正在清理buffer

    this.cleanOffset = cleanOffset; // 清除buf时剩余的时长，单位秒
  }

  // 收到媒体资源并已喂到播放器
  _onUpdateEnd() {

    if (this.cleanRanges.length) {
      this.doCleanup();
      return;
    }
    this.cleaning = false;

  }

  // sourceBuffer异常
  _onError() {
    this.dispatch(BufferController.ERROR_EVENT, { tag: this.TAG, msg: 'buffer error' })
  }

  doAppend() {
    if (this.sourceBuffer.updating || !this.queue.length) {
      return;
    }
    let data = this.queue.shift();

    try {
      this.sourceBuffer.appendBuffer(data);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        debug.log(`${this.type} buffer quota full`);
        this.dispatch(BufferController.ERROR_EVENT, { tag: this.TAG, msg: 'buffer error' });
        return;
      }
      debug.error(this.TAG,`Error occured while appending ${this.TAG} buffer`);
      this.dispatch(BufferController.ERROR_EVENT, { tag: this.TAG, msg: 'buffer update error' });
    }
  }

  // 整理需要清空的buffer
  initCleanBuf() {
    if (this.sourceBuffer.updating) {
      return false;
    }
    if (this.sourceBuffer.buffered && this.sourceBuffer.buffered.length && !this.cleaning) {
      for (let i = 0; i < this.sourceBuffer.buffered.length; ++i) {
        let start = this.sourceBuffer.buffered.start(i);
        let end = this.sourceBuffer.buffered.end(i);

        if ((end - start) > this.cleanOffset) {
          this.cleanRanges.push([start, end]);
        }
      }
      this.doCleanup();
    }
  }

  // 清除buffer
  doCleanup() {
    if (!this.cleanRanges.length) {
      this.cleaning = false;
      return;
    }
    while (this.cleanRanges.length > 0 && !this.sourceBuffer.updating) {
      let range = this.cleanRanges.shift();
      debug.log(this.TAG,`${this.type} remove range [${range[0]} - ${range[1]})`);
      this.cleaning = true;
      this.sourceBuffer.remove(range[0], range[1]);
    }
  }

  // 喂媒体片段到播放器
  feed(data) {
    this.queue.push(data);
    this.doAppend();
  }

  // 销毁buffer管理器
  destroy() {
    try {
      this.sourceBuffer.abort();
    } catch(e) {
      debug.log(this.TAG, e.message);
    }
    this.sourceBuffer.removeEventListener('updateend', this._onUpdateEnd.bind(this));
    this.sourceBuffer.removeEventListener('error', this._onError.bind(this));

    this.cleaning = false;
    this.cleanRanges = [];

    this.queue = [];
    this.sourceBuffer = null;
    this.offAll();
  }
}
