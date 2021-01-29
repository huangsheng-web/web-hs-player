import Event from './utils/event';
import VideoEvents from './net/video-event';
import { setLogger } from './utils/debug';
import BufferController from './buffer/buffer';
import WSReader from './net/ws-reader';
import * as debug from './utils/debug';
window.MediaSource = window.MediaSource || window.WebKitMediaSource;

export default class HSPlayer extends Event {

  // 向外开放的监听事件类型。
  static get Events() {
    return{

      // 请求播放视频失败
      SERVER_PLAY_ERR: 'SERVER_PLAY_ERR',

      // 请求暂停视频失败
      SERVER_PAUSE_ERR: 'SERVER_PAUSE_ERR',

      // 请求变速失败
      SERVER_SPEED_ERR: 'SERVER_SPEED_ERR',

      // 服务器的连接出现错误
      SERVER_NET_ERR: 'SERVER_NET_ERR',

      // 由于网络异常导致到连接中断
      ABNORMAL_DISCONNECT: 'ABNORMAL_DISCONNECT',

      // 浏览器不支持当前视频的格式
      CHROME_CODEC_UNSUPPORT: 'CHROME_CODEC_UNSUPPORT',

      // 视频有缺失或被污染
      VIDEO_STREAM_INCORRECT: 'VIDEO_STREAM_INCORRECT',

      // 实时视频流缓冲太长，需要seek到最新点
      VIDEO_LIVE_STREAM_TOO_LOOG: 'VIDEO_LIVE_STREAM_TOO_LOOG',

      // 通知前端播放成功
      VIDEO_PLAY_SUCESS: 'VIDEO_PLAY_SUCESS'

    };
  }
  static isSupported(mimeCode) {
    return (window.MediaSource && window.MediaSource.isTypeSupported(mimeCode));
  }

  constructor(options) {
    super('HSPlayer');
    this.TAG = '[HSPlayer]';
    let defaults = {
      node: '', // video 节点
      cacheBufferTime: 30, // 回放最大缓存时长 单位秒
      cacheBufferMinTime: 16, // 回放缓存小于cacheBufferMinTime时，重新获取流
      cleanOffset: 2, // 清除buf时剩余的时长，单位秒
      debug: false, // 是否打印出控制台信息
      delayPlay: 0, // 获取实时视频流可以设置延时播放,单位ms
      type: 'live', // live 直播， playback 回放
      wsUrl: null, // websocket 地址，目前项目信令跟视频流都用同一个地址
      flushTime: 3 * 1000, // 清空buffer的间隔，用于直播
    };
    this.options = Object.assign({}, defaults, options); //初始化的配置
    if(this.options.debug) {
      setLogger();
    }
    if (typeof this.options.node === 'string' && this.options.node == '') {
      debug.error(this.TAG, 'no video element were found to render, provide a valid video element');
    }
    this.node = typeof this.options.node === 'string' ? document.getElementById(this.options.node) : this.options.node;

    this.ev = {
      _onSeek: this._onSeek.bind(this),
      _onMSEOpen: this._onMSEOpen.bind(this),
      _onMSEClose: this._onMSEClose.bind(this),
      _onCanPlay: this._onCanPlay.bind(this),
    };

    this.node.addEventListener('seeking', this.ev._onSeek);
    this.node.addEventListener('canplay', this.ev._onCanPlay);

    document.addEventListener('visibilitychange', this._onVisibilityChange.bind(this));
    // 当前页面窗口最小化或者被切换
    this.isHidden = false;

    this.videoInfo = {
      mime: '', // 暂时只有mime类型字段，
    };
    this.sendRateList = [
      {label: '8倍速', value: 8, speed: 8},
      {label: '4倍速', value: 4, speed: 4},
      {label: '2倍速', value: 2, speed: 2},
      {label: '原速', value: 1, speed: 1},
      {label: '2慢速', value: 0.5, speed: 2},
      {label: '4慢速', value: 0.25, speed: 4},
      {label: '8慢速', value: 0.125, speed: 8},
    ]; // 支持的倍速列表
    this.mediaSource = null; // MSE实例
    this.mseReady = false; // MSE是否open
    this.initMSE();
    this.bufferController = null; // buffer控制器
    this.sourceBuffer = null; // sourceBuffer 传入到mediaSource里的媒体资源;

    this.pendingBufs = []; // 等待feed的媒体资源

    this.videoReader = new WSReader(this.options.wsUrl);

    this.videoReader.on(VideoEvents.READY_EVENT, this._onWsReady.bind(this));
    this.videoReader.on(VideoEvents.CLOSE_EVENT, this._onWsClosed.bind(this));
    this.videoReader.on(VideoEvents.ERROR_EVENT, this._onWsError.bind(this));
    this.videoReader.on(VideoEvents.MIME_EVENT, this._onWsGetMime.bind(this));
    this.videoReader.on(VideoEvents.PLAY_EVENT, this._onWsVideoPlay.bind(this));
    this.videoReader.on(VideoEvents.PAUSE_EVENT, this._onWsVideoPause.bind(this));
    this.videoReader.on(VideoEvents.SPEED_EVENT, this._onWsVideoSpeed.bind(this));
    this.videoReader.on(VideoEvents.COMPLETE_EVENT, this._onWsVideoComplete.bind(this));
    this.videoReader.on(VideoEvents.VIDEO_EVENT, this._onWsVideoBuffer.bind(this));

    this.checkBufferTimer = null;
    // 定时器清除buffer
    this.startInterval();

  }

  startInterval() {
    this.checkBufferTimer = setInterval(() => {
      this.clearBuffer();
    }, this.options.flushTime)
  }

  stopInterval() {
    if (this.checkBufferTimer) {
      clearInterval(this.checkBufferTimer);
    }
  }

  // 清理buffer
  clearBuffer() {
    if (!this.bufferController) return;
    let maxTime = this.getLiveStreamNewest();
    if (this.options.type == 'live') {
      if (this.node.currentTime < maxTime) {
        this.node.currentTime = maxTime;
      }
      this.bufferController.initCleanBuf();
    } else {
      // 检查回放缓存的时长
      if ((maxTime - this.options.cacheBufferTime) >= this.node.currentTime) {
        debug.log(this.TAG, `playback cache is full`);
        if (!this.videoReader.isFullPause) {
          // 说明是第一次因为满了而发送暂停指令
          this.videoReader.pause(true);
        }
      } else if ((maxTime - this.node.currentTime) <= this.options.cacheBufferMinTime) {
        if (this.videoReader.isFullPause) {
          debug.log(this.TAG, `palyback cache is empty`);
          this.videoReader.isFullPause = false;
          this.videoReader.play();
        }
      }
    }
  }

  // 获取当前直播的最新可以播放时间
  getLiveStreamNewest() {
    let buffered = this.node.buffered;
    let maxEnd = -1;
    for (let i = 0; i < buffered.length; i++) {
      let from = buffered.start(i);
      let end = buffered.end(i);
      if(from > maxEnd) {
        if((end - this.options.cleanOffset) > from) {
          maxEnd = end - this.options.cleanOffset;
        } else {
          maxEnd = from;
        }
      }
    }
    return maxEnd;
  }

  // 初始化mediaSource
  initMSE() {
    this.mediaSource = new MediaSource();
    this.node.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', this.ev._onMSEOpen);
    this.mediaSource.addEventListener('sourceclose', this.ev._onMSEClose);
  }

  // _onWsReady
  _onWsReady(ev) {
    debug.log(ev)
  }

  // _onWsClosed
  _onWsClosed(ev) {
    // 判断是正常关闭，还是由于网络原因异常断开
    if (this.mediaSource && this.node && this.bufferController) {
      this.dispatch(HSPlayer.Events.ABNORMAL_DISCONNECT, {tag: this.TAG, mes: 'ws is abnormal disconnect'})
    } else {
      this.dispatch(HSPlayer.Events.SERVER_NET_ERR, ev)
    }
  }

  // _onWsError
  _onWsError(err) {
    this.dispatch(HSPlayer.Events.SERVER_NET_ERR, err)
  }
  // 获取到MIME
  _onWsGetMime(data) {
    if (data.ret == 0) {
      this.videoInfo.mime = data.mime;
      this.createBuffer();
      // 成功获取到mime， 接下来发送play指令。
      this.videoReader.play();
    } else {
      debug.log(this.TAG, `get mime type failed`);
      this.dispatch(HSPlayer.Events.SERVER_PLAY_ERR, {msg: 'get mime type failed'})
    }
  }

  // _onWsVideoPlay
  _onWsVideoPlay(data) {
    if (data.ret == 0) {
      // 请求视频流成功
      this.node.play();
      this.dispatch(HSPlayer.Events.VIDEO_PLAY_SUCESS, {msg: 'video play success'})
    } else {
      debug.log(this.TAG, `open stream failed`);
      this.dispatch(HSPlayer.Events.SERVER_PLAY_ERR, {msg: 'open stream failed'})
    }
  }

  // _onWsVideoPause
  _onWsVideoPause(data) {
    if (data.ret == 0) {
      // 请求暂停成功
      if (!data.isFullPause) {
        this.node.pause();
        debug.log(this.TAG, `video pause success`);
      }
    } else {
      debug.error(this.TAG, `video pause failed`);
      this.dispatch(HSPlayer.Events.SERVER_PAUSE_ERR, {msg: 'video pause failed'})
    }
  }

  // _onWsVideoSpeed
  _onWsVideoSpeed(data) {
    if (data.ret == 0) {
      // 请求变速成功
      this.node.playbackRate = this.videoReader.sendRate;
      debug.log(this.TAG, `video speed control success`);
    } else {
      debug.error(this.TAG, `video speed control failed`);
      this.dispatch(HSPlayer.Events.SERVER_SPEED_ERR, {msg: 'video speed control failed'})
    }
  }

  // _onWsVideoComplete
  _onWsVideoComplete() {
    // 视频流已经全部发送完，
    this.mediaSource.endOfStream();
    this.videoReader.destroy();
  }

  // _onWsVideoBuffer
  _onWsVideoBuffer(data) {

    while (this.pendingBufs.length > 0 && this.bufferController) {
      let buf = this.pendingBufs.shift();
      this.bufferController.feed(buf);
    }

    if(this.bufferController) {
      this.bufferController.feed(data);
    } else {
      this.pendingBufs.push(data);
    }
  }
  // 播放
  play() {
    this.videoReader.play();
  }
  // 暂停
  pause() {
    if (this.options.type == 'live') {
      this.videoReader.pause();
    } else {
      this.node.pause();
    }
  }
  // 关闭
  close() {
    this.stopInterval();
    this.videoReader.close();
  }
  // 调速 8,4,2,1,0.5,0.25,0.125
  speed(sendRate) {
    // 直播不能调速
    if (this.options.type == 'live') {
      debug.log(`${this.TAG} You cannot change the playback speed of the live stream`);
      return false;
    }
    let rate = this.sendRateList.find(x => x.value === sendRate);
    this.videoReader.speed(rate);
  }

  // 调整当前播放时间，原生video的seeking事件，在目前项目中不会用到，都是重新初始化实现。
  _onSeek() {

  }
  // 打开mediaSource
  _onMSEOpen() {
    this.mseReady = true;
    // MSE已经打开，开始初始化buffer
    // 这里初始化buffer只是特殊情况下（传输异常导致mse重新open）
    this.createBuffer();
  }
  // mediaSource关闭
  _onMSEClose() {
    this.mseReady = false;
  }
  // video已经准备好，随时播放
  _onCanPlay() {
    debug.log('video is ready to play');
  }
  // 当前浏览器标签页触发hidden事件。
  _onVisibilityChange() {
    if(document.hidden) {
      this.isHidden = true;
      if (this.options.type == 'live') {
        this.videoReader.pause();
      }
    } else {
      // 如果是直播切换为播放状态,如果是回放保持暂停状态
      if (this.options.type == 'live') {
        this.clearBuffer();
        this.play();
      }
      this.isHidden = false;
    }
  }
  // sourceBuffer异常捕获
  _onBufferCtrlError(e) {
    debug.error(e)
    this.dispatch(HSPlyaer.Events.VIDEO_STREAM_INCORRECT, e)
  }

  // 销毁播放器
  destroy() {
    this.offAll();
    this.stopInterval();
    document.removeEventListener('visibilitychange', () => {});
    if(this.node) {
      this.node.pause();
    }

    if(this.videoReader) {
      this.videoReader.destroy();
      this.videoReader = null;
    }

    if (this.mediaSource) {
      try {
        this.mediaSource.removeEventListener('sourceopen', this.ev._onMSEOpen);
        this.mediaSource.removeEventListener('sourceclose', this.ev._onMSEClose);
        if (this.bufferController) {
          if (this.mediaSource.readyState != 'ended')
            this.mediaSource.endOfStream();
          this.mediaSource.removeSourceBuffer(this.sourceBuffer);
        }
      } catch (e) {
        debug.error(`mediasource is not available to end ${e.message}`);
      }
      this.mediaSource = null;
    }

    if (this.bufferController) {

      this.bufferController.destroy();

      this.bufferController = null;
    }

    if(this.node) {
      this.node.removeEventListener('seeking', this.ev._onSeek);
      this.node.removeEventListener('canplay', this.ev._onCanPlay);
      this.node.removeAttribute('src');
      this.node.load();
      this.node = null;
    }

    this.options.node = null;

    this.options = null;

    this.mseReady = false;
    this.ev = {};


    this.videoInfo = {
        mime:''
      };

    return true;
  }


  createBuffer() {
    // sourceBuffer只能存在一个，bufferController已存在则返回，
    if (!this.mseReady || this.bufferController || this.videoInfo.mime == '') return false;

    if (!HSPlayer.isSupported(this.videoInfo.mime)) {
      debug.error(this.TAG, `Browser does not support codec: ${this.videoInfo.mime}`);
      this.dispatch(HSPlayer.Events.CHROME_CODEC_UNSUPPORT, {errMsg:`Browser does not support codec: ${this.videoInfo.mime}`});
      return false;
    }
    debug.log(this.TAG, `${this.videoInfo.mime}`);
    let sb = this.mediaSource.addSourceBuffer(this.videoInfo.mime);
    sb.mode = 'sequence';

    this.bufferController = new BufferController(sb, this.cleanOffset);
    this.sourceBuffer = sb;

    this.bufferController.on(BufferController.ERROR_EVENT, this._onBufferCtrlError.bind(this));

  }
}