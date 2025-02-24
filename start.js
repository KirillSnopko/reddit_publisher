// NodeJS Dependencies
const fs = require('fs');
const { SOURCE, lastIndexDir } = require('./system.js');
const { useReddit } = require('./reddit.js');
const { useVk } = require('./vk.js');
const configChannel = require('./channels_config.json');

startScript();

async function startScript() {
    console.log('-----------------------------------> START <-----------------------------------');
    if (configChannel == null || configChannel.length == 0) {
        console.log('channel config is empty');
        return;
    }

    if (!fs.existsSync(lastIndexDir)) {
        fs.mkdirSync(lastIndexDir, { recursive: true });
    }

    for (const channel of configChannel) {
        console.log(`-----------------------------------> СHANNEL: ${channel.channel_name} <-----------------------------------`);

        var sources = channel.sources;

        if (sources == null || sources.length == 0) {
            console.log('The channel has no sources');
            continue;
        }

        for (const source of sources) {

            console.log(`---------------------------------------> SOURCE: ${source.name} | ${source.sub_source} |types: [${source.type}] | count: ${source.dailyPosts}`);

            if (source.dailyPosts <= 0) {
                console.log('Skip source');
                continue;
            }

            if (source.name == SOURCE.REDDIT) {
                await useReddit(channel, source);
            } else if (source.name == SOURCE.VK) {
                await useVk(channel, source);
            }
        }
    }
}
