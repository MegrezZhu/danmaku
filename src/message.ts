import { get } from 'lodash';

export type MessageType = 'getPageList' | 'getDanmaku';
const messageTypes = new Set(['getPageList', 'getDanmaku']);

export interface IMessage {
    type: MessageType;
    data: any;
}

export function validMessage (obj: any): boolean {
    if (typeof (obj) !== 'object') { return false; }
    if (!obj.type || !messageTypes.has(obj.type)) { return false; }
    switch (obj.type) {
        case 'getPageList':
            const av = get(obj.data, 'av', undefined);
            return typeof (av) === 'number';
        case 'getDanmaku':
            const cid = get(obj.data, 'cid', undefined);
            return typeof (cid) === 'number';
        default:
            return false;
    }
}
