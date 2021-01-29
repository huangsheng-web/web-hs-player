// 播放器自身的状态控制列表。
const VideoEvents = {
  MIME_EVENT: 'MIME_EVENT', // 获取到mime
  READY_EVENT: 'READY_EVENT', // ws连接成功
  CLOSE_EVENT: 'CLOSE_EVENT', // ws关闭
  ERROR_EVENT: 'ERROR_EVENT', // ws错误
  PLAY_EVENT: 'PLAY_EVENT',// 可以初始化source buffer
  PAUSE_EVENT: 'PAUSE_EVENT',// 暂停
  VIDEO_EVENT: 'VIDEO_EVENT',// 接受到媒体片段
  SEEK_EVENT: 'SEEK_EVENT',// video stream seek event
  SPEED_EVENT: 'SPEED_EVENT',// video stream send speed
  COMPLETE_EVENT: 'COMPLETE_EVENT', // 视频流已经全部发送完
};

export default VideoEvents;