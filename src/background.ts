const ports: Map<number, chrome.runtime.Port> = new Map();

console.log('init');
chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'danmaku') {
      console.log(`connection from ${port.sender!.tab!.title}`);
      const tabId = port.sender!.tab!.id;
      if (tabId) {
        ports.set(tabId, port);
        port.onDisconnect.addListener(() => {
          console.log(`disconnectd with ${port.sender!.tab!.title}`);
          ports.delete(tabId);
        });
      }
    }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(detail => {
    const port = ports.get(detail.tabId);
    if (port) {
      port.postMessage({
        type: 'HISTORY_STATE_UPDATED'
      });
    }
}, { url: [{ urlMatches: 'https://www.bilibili.com/' }] });
// }
