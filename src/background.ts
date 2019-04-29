import axios from 'axios';
import { IMessage, validMessage } from './message';

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (validMessage(message)) {
        const validMessage: IMessage = message;
        switch (validMessage.type) {
            case 'getPageList':
                const av = validMessage.data.av as number;
                sendPageList(av, sendResponse);
                return true;
            case 'getDanmaku':
                const cid = validMessage.data.cid as number;
                sendDanmaku(cid, sendResponse);
                return true;
        }
    } else {
        console.log('unrecognized message:');
        console.log(message);
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

async function sendPageList (av: number, sendResponse: (res: any) => void): Promise<any> {
    const { data } = await axios.get(
        `https://api.bilibili.com/x/player/pagelist?aid=${av}&jsonp=jsonp`
    );
    sendResponse(data);
}

async function sendDanmaku (cid: number, sendResponse: (res: any) => void): Promise<any> {
    const { data } = await axios.get(
        `https://comment.bilibili.com/${cid}.xml`
    );
    sendResponse(data);
}
