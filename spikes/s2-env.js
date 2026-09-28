import { launch } from './lib/launch.js';
const { context } = await launch({ clean: true, seed: true });
const p = await context.newPage();
await p.goto('chrome://version');
console.log((await p.innerText('#command_line')));
const v = await p.innerText('#variations-list').catch(() => '(none)'); console.log('variations lines:', v.split('\n').length);
await context.close();
