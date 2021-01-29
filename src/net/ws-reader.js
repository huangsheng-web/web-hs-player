
/**
 * 视频流ws服务管理
 * */
import Event from '../utils/event';
import VideoEvents from './video-event';
import * as debug from '../utils/debug';
export default class WSReader extends Event {

  constructor(url) {
    super('WSReader');
    this.TAG = '[WSReader]';
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = this._onWebSocketOpen.bind(this);
    this.ws.onerror = this._onWebSocketError.bind(this);
    this.ws.onmessage = this._onWebSocketMessage.bind(this);
    this.ws.onclose = this._onWebSocketClose.bind(this);

    this.isOpen = false;
    this.wsMethods = {
      open: 'open', // 请求mime
      play: 'play', // 请求推流
      pause: 'pause', // 停止推流
      close: 'close', // 关闭ws连接
      slow: 'slow', // 请求降低推流频率
      fast: 'fast', // 请求提高推流频率
      complete: 'complete', // 视频流已经全部发送完。
    };
    this.seq = 1;
    this.sendRate = 1; // 视频流传输频率，用来调整播放速度
    this.isFullPause = false;
  }

  // 发送play指令
  play() {
    if(this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      debug.error(this.TAG, 'play signal ws not ok');
      return false;
    }
    this.ws.send(JSON.stringify({method: this.wsMethods.play, seq: this.seq}))
  }

  // 发送pause指令 isFullPause 判断是否由于缓存区满了发送的指令
  pause(isFullPause) {
    if(this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      debug.error(this.TAG, 'pause signal ws not ok');
      return false;
    }
    this.isFullPause = isFullPause ? true : false;
    this.ws.send(JSON.stringify({method: this.wsMethods.pause, seq: this.seq}))
  }

  // 发送close指令
  close() {
    if(this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      debug.error(this.TAG, 'close signal ws not ok');
      return false;
    }
    this.ws.send(JSON.stringify({method: this.wsMethods.close, seq: this.seq}))
  }

  // 发送speed指令
  speed(rateObj) {
    if(this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      debug.error(this.TAG, 'speed signal ws not ok');
      return false;
    }
    this.sendRate = rateObj.value;
    // 如果rateObj下的value大于等于1发送fast,否则发送slow
    if (rateObj.value >= 1) {
      this.ws.send(JSON.stringify({method:'fast', seq: this.seq, speed: rateObj.speed}));
    } else {
      this.ws.send(JSON.stringify({method:'slow', seq: this.seq, speed: rateObj.speed}));
    }
  }

  // 监听ws的open事件, 准备接受媒体流数据
  _onWebSocketOpen(ev) {
    this.ws.send(JSON.stringify({method: this.wsMethods.open, seq: this.seq}));
    debug.log(`ws is ready ${ev}`)
    this.dispatch(VideoEvents.READY_EVENT, {tag: this.TAG, msg: 'ws is ready'})
  }
  // 监听ws的error事件
  _onWebSocketError(ev) {
    debug.error(`ws is error ${ev}`)
    this.dispatch(VideoEvents.ERROR_EVENT, {tag: this.TAG, msg: 'ws is error'})
  }
  // 处理websocket message
  _onWebSocketMessage(ev) {
    let {data} = ev;
    if (data instanceof ArrayBuffer) {
      this.dispatch(VideoEvents.VIDEO_EVENT, data);
    } else {
      this.wsMessageHandle(data)
    }
  }
  // 监听ws的close事件
  _onWebSocketClose(ev) {
    debug.log(`ws is close ${ev}`);
    this.dispatch(VideoEvents.CLOSE_EVENT, {tag: this.TAG, msg: 'ws is close'})
  }

  // 根据ws主体内容来分配事件
  wsMessageHandle(data) {
    let mes = JSON.parse(data);
    switch (mes.method) {
      case 'open':
        debug.log(`get mime ${mes.mime}`);
        this.openHandle(mes)
        break;
      case 'play':
        debug.log(`ws play signal`);
        this.playHandle(mes)
        break;
      case 'pause':
        debug.log(`ws pause signal`);
        this.pauseHandle(mes)
        break;
      case 'close':
        debug.log(`ws close signal`);
        this.closeHandle()
        break;
      case 'slow':
        debug.log(`ws slow signal`);
        this.speedHandle(mes)
        break;
      case 'fast':
        debug.log(`ws fast signal`);
        this.speedHandle(mes)
        break;
      case 'complete':
        debug.log(`ws complete signal`);
        this.completeHandle()
        break;
    }
  }
  // 处理ws open指令
  openHandle(data) {
    this.dispatch(VideoEvents.MIME_EVENT, data);
  }

  // 处理ws play指令
  playHandle(data) {
    this.dispatch(VideoEvents.PLAY_EVENT, Object.assign(data, {isFullPause: this.isFullPause}));
  }

  // 处理ws pause指令
  pauseHandle(data) {
    this.dispatch(VideoEvents.PAUSE_EVENT, Object.assign(data, {isFullPause: this.isFullPause}));
  }

  // 处理ws close指令
  closeHandle() {
    this.ws.close();
    this.ws = null;
  }

  // 处理ws fast slow指令
  speedHandle(data) {
    this.dispatch(VideoEvents.SPEED_EVENT, data);
  }

  // 处理ws complete指令
  completeHandle() {
    this.dispatch(VideoEvents.COMPLETE_EVENT);
  }

  // 销毁
  destroy() {
    this.close();
    this.ws.close();
    this.ws = null;
    this.offAll();
  }
}