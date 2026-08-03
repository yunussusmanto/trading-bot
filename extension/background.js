// Background service worker — handles alarms & persistent WS polling
chrome.alarms.create('poll', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async () => {
  const { vpsUrl } = await chrome.storage.local.get('vpsUrl');
  if (!vpsUrl) return;
  try {
    const res = await fetch(`${vpsUrl}/api/approvals`);
    const data = await res.json();
    if (data.length > 0) {
      chrome.action.setBadgeText({ text: String(data.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (_) {}
});
