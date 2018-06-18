import axios from 'axios';
import { promisify } from 'bluebird';
import echarts = require('echarts');
import * as $ from 'jquery';
import * as qs from 'qs';
import ResizeObserver from 'resize-observer-polyfill';
import { from, Observable, Observer } from 'rxjs';
import { concatMap, distinctUntilChanged, filter, tap } from 'rxjs/operators';
import { convertableToString, parseString } from 'xml2js';

function observeElement (faSelector: string, selector: string, ctx: IContext): Observable<IContext> {
    return Observable.create((observer: Observer<IContext>) => {
        setImmediate(() => {
            const parent = $(faSelector);
            const ele = parent.find(selector);
            if (ele.length !== 0) {
                observer.next(ctx);
                return observer.complete();
            }
            let toDisconnect: MutationObserver | null = null;
            const obs = toDisconnect = new MutationObserver((mutations: MutationRecord[]) => {
                const ele = parent.find(selector);
                if (ele.length !== 0) {
                    observer.next(ctx);
                    observer.complete();
                    return toDisconnect!.disconnect();
                }
            });
            obs.observe(parent[0], {
                subtree: true,
                childList: true
            });
        });
    });
}

function observeSize (node: HTMLElement): Observable<null> {
    return Observable.create((observer: Observer<null>) => {
        observer.next(null);
        const resizeObs = new ResizeObserver(() => observer.next(null));
        resizeObs.observe(node);
    });
}

function observeLocation (): Observable<string> {
    const observable = Observable.create((observer: Observer<string>) => {
        observer.next(location.href);
        $(window).on('hashchange', () => observer.next(location.href));
        $(window).on('popstate', () => observer.next(location.href));

        const port = chrome.runtime.connect({ name: 'danmaku' });
        port.onMessage.addListener((message: any) => {
            // console.log(message);
            if (message.type === 'HISTORY_STATE_UPDATED') {
                observer.next(location.href);
            }
        });
    });
    return observable.pipe(
        // tap(str => console.log(str)),
        distinctUntilChanged()
    );
}

async function initialize (): Promise<void> {
    console.log('danmaku: loaded');
    observeLocation()
        .pipe(
            concatMap(createContext),
            tap(ctx => console.log(`danmaku: context created, ${ctx.danmaku.length} danmaku loaded`)),
            concatMap(ctx => observeElement('body', '.bpui-slider-tracker-wrp', ctx))
        )
        .subscribe(render);
}

function createContext (): Observable<IContext> {
    return from(getVideoInfo())
        .pipe(
            filter(ctx => !isNaN(ctx.cid)),
            concatMap(async ctx => {
                return {
                    ...ctx,
                    danmaku: await getDanmaku(ctx.cid)
                };
            })
        );
}

async function getVideoInfo (): Promise<{ av: number; cid: number; length: number; page: number }> {
    const loc = getLocation(location.href);
    const { data: pageList } = await axios.get(`https://api.bilibili.com/x/player/pagelist?aid=${loc.av}&jsonp=jsonp`);
    const { cid, duration: length } = pageList.data[loc.page - 1];
    return {
        cid, length,
        av: loc.av,
        page: loc.page
    };
}

function getLocation (url: string): { av: number; page: number } {
    let match = url.match(/\/video\/av(\d+)/);
    if (match) {
        // /video/avXXXXX
        const av = Number(match[1]);
        const {p} = parseQuery(url); // ?p=XX
        if (!isNaN(p)) {
            return { av, page: Number(p) };
        }
        const match1 = url.match(/\/index_(\d+)\.html(?:#page=(\d+))?/); // /index_XX.html
        if (match1) {
            return { av, page: Number(match1[2] || match1[1]) };
        } else {
            return { av, page: 1 };
        }
    }
    match = url.match(/watchlater\/#\/av(\d+)(?:\/p(\d+))?/);
    if (match) {
        return {
            av: Number(match[1]),
            page: isNaN(Number(match[2])) ? 1 : Number(match[2])
        };
    }
    match = url.match(/\/bangumi\/play/);
    if (match) {
        const av = $('a.info-sec-av').text().slice(2);
        return { av: Number(av), page: 1 };
    }

    console.warn(`danmaku: unparsable url ${url}`);
    return { av: NaN, page: NaN };
}

function parseQuery (url: string): {[k: string]: any} {
    const match = url.match(/\?(.+)$/);
    if (!match) {
        return {};
    }
    return qs.parse(match[1]) || {};
}

function render (context: IContext) {
    $('#megrez-danmaku').remove();
    $('<div id="megrez-danmaku" />').prependTo('.bpui-slider-tracker-wrp');
    // console.log($('.bpui-slider-tracker-wrp'));
    const chart = echarts.init($('#megrez-danmaku').get(0) as HTMLCanvasElement);
    const hist = divideBins(context.danmaku.map(d => d.offset), context.length, 50);
    chart.setOption({
        xAxis: { show: false, data: hist.keys() },
        yAxis: { show: false },
        series: [{
            type: 'line',
            data: hist.map(x => x ** 0.8),
            smooth: true,
            symbol: 'none',
            areaStyle: {
                color: '#fff',
                opacity: .3
            },
            lineStyle: {
                show: false,
                color: '#fff',
                opacity: .3
            }
        }],
        grid: {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
        }
    });

    observeSize($('.bpui-slider-tracker-wrp').get(0))
        .subscribe(() => {
            chart.resize();
        });
    console.log('danmaku: render finished.');
}

interface IContext {
    danmaku: IDanmaku[];
    length: number;
    av: number;
    page: number;
    cid: number;
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

async function getDanmaku (cid: number): Promise<IDanmaku[]> {
    const { data } = await axios.get(`https://comment.bilibili.com/${cid}.xml`);
    const { i: { d } }: { i: { d: IRawDanmaku[] } } = await parseXML(data);
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

function divideBins (data: number[], totalLength: number, bins: number): number[] {
    const width = totalLength / bins;
    const res = Array(bins).fill(0);
    for (const x of data) {
        const into = Math.floor(Math.min(x / width, bins - 1));
        res[into]++;
    }
    return [0, ...res, 0];
}

initialize();
