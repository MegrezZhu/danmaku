import axios from 'axios';
import { promisify } from 'bluebird';
import * as $ from 'jquery';
// import 'source-map-support/register'; FIXME:
import { convertableToString, parseString } from 'xml2js';

console.log($('#bofqi').html());

async function initialize (): Promise<void> {
    console.log('danmaku started or url changed');
    // console.log($('#bofqi script').html());

    const cid = getCid();

    const [vLength, danmaku] = await Promise.all([
        getLength(),
        getDanmaku(cid)
    ]);

    console.log(`${danmaku.length} danmaku(s) fetched.`);
    console.log(`video length: ${vLength} second.`);
}

interface IDanmaku {
    timestamp: Date;
    offset: number;
    content: string;
}

interface IRawDanmaku {
    _: string;
    $: {
        p: string;
    };
}

function getCid (): string {
    return $('#link2').attr('value')!.match(/cid=(\d+)/)![1];
}

function parseVideoLength (str: string): number {
    return str.split(':').reduce((acc, x) => acc + 60 * Number(x), 0);
}

/**
 * get video length in seconds
 */
function getLength (): Promise<number> {
    return new Promise<number>(resolve => {
        const target = $('.bilibili-player-video-time-total')[0];
        const len = parseVideoLength($(target).text());
        if (len !== 0) {
            return resolve(len);
        }
        const observer = new MutationObserver((...mutations: any[]) => {
            for (const mute of mutations) {
                for (const rec of mute) {
                    if (rec.type === 'childList') {
                        const len = parseVideoLength($(target).text());
                        if (len !== 0) {
                            return resolve(len);
                        }
                    }
                }
            }
        });
        observer.observe(
            target,
            {
                characterData: false,
                attributes: false,
                childList: true,
                subtree: false
            }
        );
    });
}

const parseXML = promisify(parseString as ((xml: convertableToString, cb: (err: any, result?: any) => void) => void));

async function getDanmaku (cid: string): Promise<IDanmaku[]> {
    const { data } = await axios.get(`https://comment.bilibili.com/${cid}.xml`);
    const { i: { d } }: { i: {d: IRawDanmaku[]}} = await parseXML(data);
    return d.map(parseRawDanmaku);
}

function parseRawDanmaku (raw: IRawDanmaku): IDanmaku {
/*
    danmaku format ref: http://ju.outofmemory.cn/entry/146571
*/
    const res = {} as IDanmaku;

    res.content = raw._;
    const attrs = raw.$.p.split(',');
    res.offset = Number(attrs[0]);
    res.timestamp = new Date(Number(attrs[4]) * 1000);

    return res;
}

// $(initialize); // bind triggering

initialize();
