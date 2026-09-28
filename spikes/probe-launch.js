import { launch } from './lib/launch.js';
const { context, sw, extId, version } = await launch();
console.log({ version, extId, url: sw.url(), settings: await sw.evaluate(() => spike.getSettings()) });
await context.close();
