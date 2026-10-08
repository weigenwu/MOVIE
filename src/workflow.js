export function processingFrame(message) {
  const match=String(message).match(/\bframe=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}
export function failureMessage(error, phase) {
  const raw=String(error?.message || error), prefix={engine:'处理引擎加载失败',read:'视频读取失败',encode:'视频编码失败',package:'导出文件整理失败',save:'文件保存失败',prepare:'导出准备失败',preview:'播放预览失败'}[phase] || '处理失败';
  const advice=/memory|out of bounds|allocation/i.test(raw)?'浏览器内存不足，可缩短片段或减小裁剪范围后重试。':
    /fetch|network|下载|加载|Failed to fetch/i.test(raw)?'请检查网络后重试，剪辑设置仍保留。':
    phase==='save'?'请检查文件夹权限和磁盘空间；可重试保存或普通下载，无需重新编码。':
    '剪辑设置仍保留，可重试；若仍失败，请查看错误详情。';
  return {message:`${prefix}：${advice}`,detail:raw.slice(0,500)};
}
export function itemState(item) {
  const state=item.workflow?.state || (item.meta?'ready':'unprocessed');
  const names={unprocessed:'未处理',ready:'待导出',exporting:'导出中',saved:'已保存',downloaded:'已发起下载',failed:'失败',unsaved:'待保存'};
  return {state,label:`${item.workflow?.restored&&['saved','downloaded'].includes(state)?'上次':''}${names[state] || names.ready}`};
}
