import 'arrive';
import axios from 'axios';
import { promisify } from 'bluebird';
import * as $ from 'jquery';
import { combineLatest, from, Observable, Observer } from 'rxjs';
import { distinctUntilChanged, exhaustMap, filter, map, tap } from 'rxjs/operators';
// import 'source-map-support/register'; FIXME:
import { convertableToString, parseString } from 'xml2js';

function observeElement (faSelector: string, selector: string): Observable<HTMLElement> {
    return Observable.create((observer: Observer<HTMLElement>) => {
        const parent = $(faSelector);
        const ele = parent.find(selector);
        if (ele.length !== 0) {
            observer.next(ele[0]);
            return observer.complete();
        }
        let toDisconnect: MutationObserver|null = null;
        const obs = toDisconnect = new MutationObserver((mutations: MutationRecord[]) => {
            const ele = parent.find(selector);
            if (ele.length !== 0) {
                observer.next(ele[0]);
                observer.complete();
                return toDisconnect!.disconnect();
            }
        });
        obs.observe(parent[0], {
            subtree: true,
            childList: true
        });

    });
}

function observeContent (node: HTMLElement): Observable<string> {
    return Observable.create((observer: Observer<string>) => {
        observer.next($(node).text());
        const mutationObs = new MutationObserver((mutations: any[]) => {
            for (const rec of mutations) {
                if (rec.type === 'childList') {
                    observer.next($(node).text());
                }
            }
        });
        mutationObs.observe(
            node,
            {
                characterData: false,
                attributes: false,
                childList: true,
                subtree: false
            }
        );
    });
}

async function initialize (): Promise<void> {
    console.log('danmaku started.');

    // TODO: detect sub-video changes
    const obContext = observeContent($('#viewbox_report h1')[0])
        .pipe(
            distinctUntilChanged(),
            tap(title => console.log(`titled: ${title}`))
        )
        .pipe(exhaustMap(createContext));
    obContext.subscribe(render);
}

function createContext (): Observable<IContext> {
    const obLength = observeElement('body', '.bilibili-player-video-time-total')
        .pipe(
            exhaustMap(observeContent),
            map(str => str.split(':').reduce((acc, x) => acc + 60 * Number(x), 0)), // parse video length
            filter(vLength => vLength !== 0),
            distinctUntilChanged()
        );

    const obCid = observeElement('body', '#link2')
        .pipe(
            map(link2 => $(link2).attr('value')!.match(/cid=(\d+)/)![1]),
            exhaustMap(cid => from(getDanmaku(cid)))
        );

    return combineLatest(obLength, obCid)
        .pipe(
            tap(([vLen, danmaku]) => {
                console.log(`video length: ${vLen} second.`);
                console.log(`${danmaku.length} danmaku fetched.`);
            }),
            map(([vLen, danmaku]) => ({
                danmaku,
                length: vLen
            }))
        );
}

function render (context: IContext) {

}

interface IContext {
    danmaku: IDanmaku[];
    length: number;
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
